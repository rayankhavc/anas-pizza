/* ==========================================================================
   POST /api/confirmation — prévenir par courriel une commande payée.
   --------------------------------------------------------------------------
   Appelé par la page de retour de paiement. Il reçoit une référence, et
   éventuellement l'adresse du client.

   Rien n'est cru sur parole : la référence est vérifiée auprès de SumUp, et
   seul un paiement au statut PAID déclenche un envoi. Sans ce contrôle,
   n'importe qui pourrait faire expédier des courriels en inventant des
   références — et le restaurant recevrait de fausses commandes.

   La réponse est volontairement pauvre : elle dit qu'on a fini, pas ce qu'on
   a trouvé. Une référence inconnue et une référence impayée se répondent
   pareil, sinon l'endpoint devient un moyen de deviner les références des
   autres.
   ========================================================================== */
'use strict';

const { commandeParReference, prestataire } = require('./_paiement');
const { prevenir, courrielActif, adresseValide } = require('./_courriel');
const garde = require('./_garde');

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
    if (taille > 8 * 1024) throw new Error('corps trop volumineux');
    morceaux.push(c);
  }
  return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}');
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

  // Format imposé : « A7F3-K2 ». Une référence qui n'y ressemble pas ne part
  // même pas chez SumUp.
  // La référence porte désormais le mode en tête — LIVRAISON-A7F3-K2 — pour
  // être lisible d'un coup d'œil dans l'application du prestataire de
  // paiement. Le préfixe est facultatif ici : une commande passée avant ce
  // changement n'en a pas, et doit rester consultable.
  const ref = String(corps.reference || '').trim().toUpperCase();
  if (!/^(?:(?:LIVRAISON|EMPORTER)-)?[A-Z2-9]{4}-[A-Z2-9]{2}$/.test(ref)) {
    return json(res, 200, { fait: false });
  }

  /* Cet appel n'est protégé par aucun code : c'est la page de retour de
     paiement qui le déclenche, et elle n'a pas de secret à présenter. Deux
     raisons de le rationner tout de même :

     - il réexpédie le détail d'une commande — nom, téléphone, adresse — à
       l'adresse que l'appelant indique. Une référence inconnue répond
       aujourd'hui la même chose qu'une référence impayée, ce qui empêche de
       les distinguer une par une ; le garde empêche d'en essayer beaucoup ;
     - chaque appel déclenche une requête chez le prestataire de paiement.
       Sans limite, un tiers peut consommer notre quota gratuitement.

     Un client normal appelle une fois, avec une référence valide : il ne
     rencontre jamais ce garde. */
  const feu = garde.autorise(req);
  if (!feu.ok) {
    res.setHeader('Retry-After', String(feu.attente));
    return json(res, 429, { erreur: 'Trop de demandes. Réessayez dans ' +
      feu.attente + ' secondes.' });
  }

  const email = adresseValide(corps.email) ? String(corps.email).trim() : null;

  if (!prestataire() || !courrielActif()) {
    return json(res, 200, { fait: false });
  }

  let commande;
  try {
    commande = await commandeParReference(ref);
  } catch (e) {
    console.error('[confirmation] lecture : ' + e.message);
    return json(res, 200, { fait: false });
  }

  // Référence inconnue, ou paiement pas abouti : même réponse muette, et le
  // garde retient l'échec — c'est ce qui rend l'essai en série impraticable.
  if (!commande) {
    await garde.echec(req);
    return json(res, 200, { fait: false });
  }
  garde.succes(req);

  const bilan = await prevenir(commande, email);
  if (bilan.motifs.length) {
    console.warn('[confirmation] ' + ref + ' — ' + bilan.motifs.join(' | '));
  }
  console.log('[confirmation] ' + ref + ' — restaurant : ' +
    (bilan.restaurant ? 'envoyé' : 'non') + ', client : ' +
    (bilan.client ? 'envoyé' : email ? 'échec' : 'pas d’adresse'));

  return json(res, 200, {
    fait: bilan.restaurant || bilan.client,
    client: bilan.client
  });
};
