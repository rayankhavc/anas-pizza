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
  const ref = String(corps.reference || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{2}$/.test(ref)) {
    return json(res, 200, { fait: false });
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

  // Référence inconnue, ou paiement pas abouti : même réponse muette.
  if (!commande) return json(res, 200, { fait: false });

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
