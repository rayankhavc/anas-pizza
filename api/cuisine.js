/* ==========================================================================
   GET /api/cuisine — les commandes payées du service en cours.
   --------------------------------------------------------------------------
   Aucune base de données : Stripe conserve déjà chaque commande payée, avec
   son détail dans les métadonnées. On la relit directement. Une base de plus
   serait une base à sauvegarder, à sécuriser et à payer, pour stocker ce qui
   existe déjà ailleurs.

   Protection : un mot de passe partagé (CUISINE_CODE), passé en en-tête ou en
   paramètre. C'est un écran de comptoir, pas un compte utilisateur — mais sans
   ce garde-fou, les nom, téléphone et adresse des clients seraient publics.
   ========================================================================== */
'use strict';

const { euros } = require('./_panier');

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

  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) return json(res, 200, { commandes: [], note: 'Paiement en ligne pas encore activé.' });

  const stripe = require('stripe')(cle);

  // Service en cours : depuis 11h ce matin, ou depuis hier 11h si l'on est
  // entre minuit et 3h — la nuit appartient au service de la veille.
  const maintenant = new Date();
  const paris = new Date(maintenant.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const debut = new Date(paris);
  debut.setHours(11, 0, 0, 0);
  if (paris.getHours() < 3) debut.setDate(debut.getDate() - 1);
  const depuis = Math.floor(debut.getTime() / 1000);

  try {
    const liste = await stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: depuis },
      expand: ['data.payment_intent']
    });

    const commandes = liste.data
      .filter((s) => s.payment_status === 'paid')
      .map((s) => {
        const m = s.metadata || {};
        let articles = [];
        try { articles = JSON.parse(m.panier || '[]'); } catch (e) { /* métadonnée tronquée */ }
        return {
          id: s.id.slice(-8).toUpperCase(),
          heure: new Date(s.created * 1000).toLocaleTimeString('fr-FR',
            { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }),
          horodatage: s.created,
          mode: m.mode || 'emporter',
          nom: m.nom || '',
          telephone: m.telephone || '',
          adresse: m.adresse || '',
          commentaire: m.commentaire || '',
          articles: articles.map((a) => ({ n: a.n, texte: a.t, prix: euros(a.p) })),
          total: euros(Number(m.total || s.amount_total || 0))
        };
      })
      .sort((a, b) => b.horodatage - a.horodatage);

    return json(res, 200, { commandes, service: debut.toISOString() });
  } catch (e) {
    console.error('[cuisine] Stripe :', e.message);
    return json(res, 502, { erreur: 'Impossible de joindre Stripe.' });
  }
};
