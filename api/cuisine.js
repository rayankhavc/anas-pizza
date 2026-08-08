/* ==========================================================================
   GET /api/cuisine — les commandes payées du service en cours.
   --------------------------------------------------------------------------
   Aucune base de données : le prestataire de paiement conserve déjà chaque
   commande, avec son ticket. On la relit directement. Une base de plus serait
   une base à sauvegarder, à sécuriser et à payer, pour stocker ce qui existe
   déjà ailleurs.

   Protection : un mot de passe partagé (CUISINE_CODE). C'est un écran de
   comptoir, pas un compte utilisateur — mais sans ce garde-fou, les nom,
   téléphone et adresse des clients seraient publics.
   ========================================================================== */
'use strict';

const { commandesPayees, prestataire } = require('./_paiement');

function json(res, code, corps) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corps));
}

// Comparaison à durée constante : une comparaison naïve laisse deviner le
// code caractère par caractère en mesurant le temps de réponse.
function memeCode(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Début du service en cours, en secondes.
 * Le restaurant sert de 11h30 à 2h du matin : entre minuit et 3h, la nuit
 * appartient encore au service de la veille.
 */
function debutService(maintenant) {
  const paris = new Date((maintenant || new Date())
    .toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const d = new Date(paris);
  d.setHours(11, 0, 0, 0);
  if (paris.getHours() < 3) d.setDate(d.getDate() - 1);
  return Math.floor(d.getTime() / 1000);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { erreur: 'Méthode non autorisée.' });
  }

  const attendu = process.env.CUISINE_CODE;
  if (!attendu) {
    return json(res, 503, { erreur: 'Écran cuisine non configuré (CUISINE_CODE absent).' });
  }
  const url = new URL(req.url, 'http://x');
  const fourni = req.headers['x-cuisine-code'] || url.searchParams.get('code') || '';
  if (!memeCode(String(fourni), attendu)) {
    return json(res, 401, { erreur: 'Code incorrect.' });
  }

  if (!prestataire()) {
    return json(res, 200, { commandes: [], note: 'Paiement en ligne pas encore activé.' });
  }

  const depuis = debutService();
  try {
    const commandes = (await commandesPayees(depuis))
      .filter((c) => c.horodatage >= depuis)
      .sort((a, b) => b.horodatage - a.horodatage);
    return json(res, 200, { commandes, service: new Date(depuis * 1000).toISOString() });
  } catch (e) {
    console.error('[cuisine] ' + e.message);
    return json(res, 502, { erreur: 'Impossible de joindre le prestataire de paiement.' });
  }
};

module.exports.debutService = debutService;
