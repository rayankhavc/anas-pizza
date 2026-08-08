/* ==========================================================================
   POST /api/commande
   --------------------------------------------------------------------------
   Reçoit un panier (identifiants et quantités, jamais de montants), le
   recalcule intégralement, vérifie l'adresse, puis ouvre une session de
   paiement Stripe. Renvoie l'URL vers laquelle rediriger le client.

   Rien n'est enregistré ici : la commande n'existe que lorsque Stripe
   confirme l'encaissement, dans api/stripe-webhook.js. Une commande créée
   avant paiement, c'est une pizza préparée pour quelqu'un qui a fermé
   l'onglet.
   ========================================================================== */
'use strict';

const { calculer, verifierAdresse, carte, euros, libelle } = require('./_panier');

const TVA = 'txcd_40060003'; // restauration à emporter / livrée — 10 % en France

function json(res, code, corps) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corps));
}

async function lireCorps(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const morceaux = [];
  let taille = 0;
  for await (const c of req) {
    taille += c.length;
    if (taille > 64 * 1024) throw new Error('corps trop volumineux');
    morceaux.push(c);
  }
  return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}');
}

function origine(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const hote = req.headers['x-forwarded-host'] || req.headers.host;
  return proto + '://' + hote;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { erreur: 'Méthode non autorisée.' });
  }

  let corps;
  try {
    corps = await lireCorps(req);
  } catch (e) {
    return json(res, 400, { erreur: 'Requête illisible.' });
  }

  // ── recalcul et vérifications ───────────────────────────────────────────
  let total, client;
  const mode = corps.mode === 'livraison' ? 'livraison' : 'emporter';
  try {
    total = calculer(corps.panier, mode);
    client = mode === 'livraison'
      ? verifierAdresse(corps.client)
      : verifierAdresse(Object.assign({ rue: 'Retrait sur place — 10 allée Duguay Trouin', codePostal: '44000' },
          { nom: (corps.client || {}).nom, telephone: (corps.client || {}).telephone,
            commentaire: (corps.client || {}).commentaire }));
  } catch (e) {
    if (e.refus) return json(res, 422, { erreur: e.message, champ: e.champ });
    throw e;
  }

  // ── paiement ────────────────────────────────────────────────────────────
  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) {
    // Le compte Stripe du restaurant n'est pas encore branché : on le dit
    // franchement plutôt que de laisser un bouton tourner dans le vide.
    return json(res, 503, {
      erreur: 'Le paiement en ligne n’est pas encore activé. ' +
              'Commandez par téléphone au 02 59 10 01 98.',
      recap: { lignes: total.lignes.map(libelle), total: euros(total.total) }
    });
  }

  const stripe = require('stripe')(cle);
  const base = origine(req);

  const articles = total.lignes.map((l) => ({
    quantity: l.quantite,
    price_data: {
      currency: 'eur',
      unit_amount: l.unitaire,
      tax_behavior: 'inclusive',       // les prix affichés sont TTC
      product_data: { name: libelle(l), tax_code: TVA }
    }
  }));

  if (total.frais) {
    articles.push({
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: total.frais,
        tax_behavior: 'inclusive',
        product_data: { name: 'Frais de livraison', tax_code: TVA }
      }
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: articles,
      locale: 'fr',
      customer_creation: 'if_required',
      phone_number_collection: { enabled: false }, // déjà saisi et vérifié
      success_url: base + '/commande-confirmee?session={CHECKOUT_SESSION_ID}',
      cancel_url: base + '/commander?annule=1',
      // 30 minutes : au-delà, la cuisine ne peut plus tenir le créneau
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      submit_type: 'pay',
      metadata: {
        mode,
        nom: client.nom,
        telephone: client.telephone,
        adresse: mode === 'livraison'
          ? [client.rue, client.complement, client.codePostal + ' ' + client.ville]
              .filter(Boolean).join(', ')
          : 'Retrait sur place',
        commentaire: client.commentaire || '',
        // le détail complet sert à reconstituer le ticket de cuisine
        panier: JSON.stringify(total.lignes.map((l) => ({
          n: l.quantite, t: libelle(l), p: l.total
        }))).slice(0, 480),
        sousTotal: String(total.sousTotal),
        frais: String(total.frais),
        total: String(total.total)
      }
    });

    return json(res, 200, { url: session.url, total: total.total });
  } catch (e) {
    console.error('[commande] Stripe :', e.message);
    return json(res, 502, {
      erreur: 'Le paiement est momentanément indisponible. ' +
              'Commandez par téléphone au 02 59 10 01 98.'
    });
  }
};

// exposé pour les tests
module.exports.TVA = TVA;
