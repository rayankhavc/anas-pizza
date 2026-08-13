/* ==========================================================================
   GET /api/pilotage — ce que la page de commande doit savoir de l'instant.
   --------------------------------------------------------------------------
   Public et sans secret : ruptures du soir, prix modifiés, boutique ouverte
   ou fermée. Rien ici qui ne soit déjà visible sur la carte affichée.

   Le serveur refuserait de toute façon une commande contenant un plat en
   rupture — c'est api/_panier.js qui fait foi. Cet appel ne sert qu'à
   l'honnêteté de l'affichage : mieux vaut griser un plat parti que le laisser
   choisir pour le refuser trois écrans plus loin.
   ========================================================================== */
'use strict';

const { lire } = require('./_pilotage');
const { carte } = require('./_panier');
const { livraisonPilotee } = require('./_pilotage');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    return res.end(JSON.stringify({ erreur: 'Méthode non autorisée.' }));
  }

  let p;
  try {
    p = await lire();
  } catch (e) {
    // Indisponible n'est pas fermé : la page de commande continue avec la
    // carte telle qu'elle est déployée.
    console.warn('[pilotage] ' + e.message);
    p = { service: { ouvert: true, motif: '' }, ruptures: [], prix: {}, livraison: {} };
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Dix secondes de cache : assez pour absorber une rafale de visiteurs,
  // assez peu pour qu'une rupture soit visible presque tout de suite.
  res.setHeader('Cache-Control', 'public, max-age=10');
  res.end(JSON.stringify({
    service: p.service,
    ruptures: p.ruptures,
    prix: p.prix,
    livraison: livraisonPilotee(p, carte().livraison)
  }));
};
