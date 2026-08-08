/* ==========================================================================
   POST /api/commande
   --------------------------------------------------------------------------
   Reçoit un panier (identifiants et quantités, jamais de montants), le
   recalcule intégralement, vérifie l'adresse, puis ouvre une page de paiement
   chez le prestataire configuré. Renvoie l'URL vers laquelle rediriger.

   Rien n'est enregistré ici : la commande n'existe que lorsque le paiement
   est confirmé. Une commande créée avant paiement, c'est une pizza préparée
   pour quelqu'un qui a fermé l'onglet.
   ========================================================================== */
'use strict';

const { calculer, verifierAdresse, euros, libelle } = require('./_panier');
const { ouvrirPaiement } = require('./_paiement');

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
      : verifierAdresse({
          nom: (corps.client || {}).nom,
          telephone: (corps.client || {}).telephone,
          commentaire: (corps.client || {}).commentaire,
          rue: 'Retrait sur place — 10 allée Duguay Trouin',
          codePostal: '44000'
        });
  } catch (e) {
    if (e.refus) return json(res, 422, { erreur: e.message, champ: e.champ });
    throw e;
  }

  // ── paiement ────────────────────────────────────────────────────────────
  let paiement;
  try {
    paiement = await ouvrirPaiement(total, client, mode, origine(req));
  } catch (e) {
    console.error('[commande] paiement :', e.message);
    return json(res, 502, {
      erreur: 'Le paiement est momentanément indisponible. ' +
              'Commandez par téléphone au 02 59 10 01 98.'
    });
  }

  if (!paiement) {
    // Aucun prestataire branché : on le dit franchement plutôt que de laisser
    // un bouton tourner dans le vide.
    return json(res, 503, {
      erreur: 'Le paiement en ligne n’est pas encore activé. ' +
              'Commandez par téléphone au 02 59 10 01 98.',
      recap: { lignes: total.lignes.map(libelle), total: euros(total.total) }
    });
  }

  return json(res, 200, {
    url: paiement.url,
    reference: paiement.reference,
    total: total.total
  });
};
