/* ==========================================================================
   Contrôles du calcul de panier.
   Lancer : node outils/test-panier.js
   ========================================================================== */
'use strict';

const { calculer, verifierAdresse, carte, euros, libelle } = require('../api/_panier');

let ko = 0;
function ok(condition, titre, detail) {
  if (!condition) ko++;
  console.log((condition ? '  ok  ' : ' ÉCHEC ') + titre + (detail ? ' — ' + detail : ''));
}
function refuse(fn, titre) {
  try {
    fn();
    ko++;
    console.log(' ÉCHEC ' + titre + ' — accepté alors qu’il fallait refuser');
  } catch (e) {
    ok(e.refus === true, titre, e.message);
  }
}

console.log('\n── prix ───────────────────────────────');

// Tikka large (rubrique tomate : 10,90 €) × 2 = 21,80 €
let r = calculer([{ plat: 'tikka', taille: 'large', quantite: 2 }], 'emporter');
ok(r.total === 2180, 'Tikka large × 2', euros(r.total));

// + supplément viande (1,00 €) et fromage (0,50 €) → (10,90 + 1,50) × 2
r = calculer([{
  plat: 'tikka', taille: 'large', quantite: 2,
  supplements: [{ groupe: 'supplement-viande', choix: 'merguez' },
                { groupe: 'supplement-fromage', choix: 'cheddar' }]
}], 'emporter');
ok(r.total === 2480, 'Tikka large × 2 + merguez + cheddar', euros(r.total));
ok(libelle(r.lignes[0]) === 'Tikka — Large + Merguez, Cheddar', 'libellé de ligne', libelle(r.lignes[0]));

// produit vendu à l'unité
r = calculer([{ plat: 'coca-cola', quantite: 3 }], 'emporter');
ok(r.total === 600, 'Coca-Cola × 3', euros(r.total));

// frais de livraison ajoutés une seule fois, au-dessus du minimum
r = calculer([{ plat: 'tikka', taille: 'large', quantite: 1 },
              { plat: 'coca-cola', quantite: 1 }], 'livraison');
ok(r.sousTotal === 1290 && r.frais === 100 && r.total === 1390,
   'livraison : sous-total + 1,00 € de frais', euros(r.total));

// à emporter, aucun frais et aucun minimum
r = calculer([{ plat: 'coca-cola', quantite: 1 }], 'emporter');
ok(r.frais === 0 && r.total === 200, 'à emporter : ni frais ni minimum', euros(r.total));

console.log('\n── refus attendus ─────────────────────');
refuse(() => calculer([], 'emporter'), 'panier vide');
refuse(() => calculer([{ plat: 'pizza-fantome', taille: 'large', quantite: 1 }], 'emporter'), 'produit inexistant');
refuse(() => calculer([{ plat: 'tikka', quantite: 1 }], 'emporter'), 'pizza sans taille');
refuse(() => calculer([{ plat: 'tikka', taille: 'geante', quantite: 1 }], 'emporter'), 'taille inventée');
refuse(() => calculer([{ plat: 'coca-cola', taille: 'large', quantite: 1 }], 'emporter'), 'taille sur une boisson');
refuse(() => calculer([{ plat: 'tikka', taille: 'large', quantite: 0 }], 'emporter'), 'quantité nulle');
refuse(() => calculer([{ plat: 'tikka', taille: 'large', quantite: 999 }], 'emporter'), 'quantité démesurée');
refuse(() => calculer([{ plat: 'tikka', taille: 'large', quantite: 1.5 }], 'emporter'), 'quantité fractionnaire');
refuse(() => calculer([{ plat: 'tikka', taille: 'large', quantite: 1, supplements: [{ groupe: 'gratuit', choix: 'truffe' }] }], 'emporter'), 'supplément inventé');
refuse(() => calculer([{ plat: 'coca-cola', quantite: 1, supplements: [{ groupe: 'supplement-fromage', choix: 'cheddar' }] }], 'emporter'), 'supplément sur une boisson');
refuse(() => calculer([{ plat: 'coca-cola', quantite: 1 }], 'livraison'), 'livraison sous le minimum');
refuse(() => calculer([{ plat: 'tikka', taille: 'large', quantite: 1 }], 'teleportation'), 'mode de retrait inconnu');

console.log('\n── le prix envoyé par le client est ignoré ──');
r = calculer([{ plat: 'tikka', taille: 'large', quantite: 1, prix: 1, unitaire: 1, total: 1 }], 'emporter');
ok(r.total === 1090, 'montants du client écrasés', euros(r.total));

console.log('\n── adresse ────────────────────────────');
const bonne = { nom: 'Dupont', telephone: '06 12 34 56 78', rue: '3 rue des Olivettes', codePostal: '44000' };
const a = verifierAdresse(bonne);
ok(a.telephone === '0612345678' && a.ville === 'Nantes', 'adresse nantaise acceptée', a.ville);
refuse(() => verifierAdresse({ ...bonne, codePostal: '75001' }), 'hors zone de livraison');
refuse(() => verifierAdresse({ ...bonne, telephone: '12' }), 'téléphone trop court');
refuse(() => verifierAdresse({ ...bonne, nom: '' }), 'nom manquant');
refuse(() => verifierAdresse({ ...bonne, rue: 'x' }), 'adresse trop courte');

console.log('\n── cohérence de la carte ──────────────');
const c = carte();
const n = c.categories.reduce((s, x) => s + x.plats.length, 0);
ok(n === 58, '58 produits au catalogue', String(n));
ok(c.categories.every((x) => x.type !== 'pizza' || x.tailles.length === 2),
   'chaque rubrique de pizzas a deux tailles');
ok(c.supplements.every((s) => s.prix > 0 && s.choix.length > 0), 'suppléments complets');

console.log('\n' + (ko ? ko + ' contrôle(s) en échec' : 'Tout est vert.'));
process.exit(ko ? 1 : 0);
