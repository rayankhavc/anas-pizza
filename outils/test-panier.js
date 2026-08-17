/* ==========================================================================
   Contrôles du calcul de panier.
   Lancer : node outils/test-panier.js
   ========================================================================== */
'use strict';

const { calculer, verifierAdresse, carte, euros, libelle } = require('../api/_panier');

// Les conditions de livraison changent au gré du restaurant : minimum, frais,
// délai. On les lit dans la carte au lieu de les figer ici, sinon chaque
// décision du client fait échouer des contrôles qui pourtant marchent.
const MINIMUM = carte().livraison.minimum;
const FRAIS = carte().livraison.frais;

// La livraison ferme à minuit. Les contrôles de tarif ne parlent pas
// d'horaires : on ouvre le créneau en grand pour eux, sinon la suite
// échouerait selon l'heure à laquelle on la lance. Le créneau lui-même est
// éprouvé plus bas, avec des heures fixes.
const CRENEAUX_REELS = carte().livraison.creneaux;
const TOUJOURS = { livraison: { debut: '00:00', fin: '23:59' },
                   emporter: { debut: '00:00', fin: '23:59' } };
carte().livraison.creneaux = TOUJOURS;

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
r = calculer([{ plat: 'tikka', taille: 'large', quantite: 2 },
              { plat: 'coca-cola', quantite: 1 }], 'livraison');
ok(r.sousTotal === 2380 && r.sousTotal >= MINIMUM && r.frais === FRAIS &&
   r.total === r.sousTotal + FRAIS,
   'livraison : sous-total + ' + euros(FRAIS) + ' de frais, une seule fois', euros(r.total));

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

console.log('\n── remises ────────────────────────────');
const { offreDuMoment, jourDeService } = require('../api/_panier');

// Le restaurant a renoncé à l'offre du mardi en ligne : la carte livrée n'en
// contient aucune, et c'est bien ce qu'on vérifie d'abord. Le mécanisme, lui,
// reste en place — on le remet sous tension avec une offre de laboratoire,
// pour qu'il soit encore éprouvé le jour où le restaurant en veut une.
ok((carte().offres || []).length === 0,
   'aucune remise configurée : le site facture plein tarif',
   JSON.stringify(carte().offres));
r = calculer([{ plat: 'tikka', taille: 'medium', quantite: 1 }], 'emporter',
             new Date('2026-08-11T12:00:00+02:00'));
ok(r.total === 790 && !r.offre, 'un mardi midi, la pizza reste à 7,90 €', euros(r.total));

carte().offres = [{ id: 'mardi', nom: 'Offre du mardi', jour: 2, finService: 2,
                    taille: 'medium', prix: 590 }];
const MARDI_MIDI   = new Date('2026-08-11T12:00:00+02:00');
const MERCREDI_1H  = new Date('2026-08-12T01:00:00+02:00');
const MERCREDI_MIDI= new Date('2026-08-12T12:00:00+02:00');
const LUNDI_23H    = new Date('2026-08-10T23:00:00+02:00');

ok((offreDuMoment(MARDI_MIDI) || {}).id === 'mardi', 'active le mardi à midi');
ok((offreDuMoment(MERCREDI_1H) || {}).id === 'mardi',
   'encore active le mercredi à 1h — le service du mardi court jusqu’à 2h');
ok(offreDuMoment(MERCREDI_MIDI) === null, 'terminée le mercredi à midi');
ok(offreDuMoment(LUNDI_23H) === null, 'pas encore le lundi soir');

r = calculer([{ plat: 'tikka', taille: 'medium', quantite: 2 }], 'emporter', MARDI_MIDI);
ok(r.total === 1180, 'medium × 2 le mardi : 5,90 € pièce', euros(r.total));
ok(r.offre && r.offre.economie === 400, 'économie annoncée', r.offre ? euros(r.offre.economie) : '—');

r = calculer([{ plat: 'tikka', taille: 'large', quantite: 1 }], 'emporter', MARDI_MIDI);
ok(r.total === 1090, 'la large garde son prix le mardi', euros(r.total));

r = calculer([{ plat: 'tikka', taille: 'medium', quantite: 1 }], 'emporter', MERCREDI_MIDI);
ok(r.total === 790, 'plein tarif le mercredi', euros(r.total));

// une rubrique déjà à 6,90 € : la remise doit encore s'appliquer
r = calculer([{ plat: 'margherita', taille: 'medium', quantite: 1 }], 'emporter', MARDI_MIDI);
ok(r.total === 590, 'les pizzas traditionnelles aussi', euros(r.total));

// les suppléments restent au tarif normal
r = calculer([{ plat: 'tikka', taille: 'medium', quantite: 1,
                supplements: [{ groupe: 'supplement-viande', choix: 'merguez' }] }], 'emporter', MARDI_MIDI);
ok(r.total === 690, 'le supplément n’est pas remisé', euros(r.total));

// les boissons ne sont pas concernées
r = calculer([{ plat: 'coca-cola', quantite: 1 }], 'emporter', MARDI_MIDI);
ok(r.total === 200 && !r.offre, 'une boisson n’entre pas dans l’offre', euros(r.total));

// le minimum de livraison se juge sur le prix réellement payé, pas sur le
// prix affiché : une pizza remisée ne doit pas ouvrir la livraison
refuse(() => calculer([{ plat: 'tikka', taille: 'medium', quantite: 1 }], 'livraison', MARDI_MIDI),
       'une pizza remisée seule reste sous le minimum de livraison');

carte().offres = [];   // on repose l'offre de laboratoire

console.log('\n── créneau de livraison ──');
carte().livraison.creneaux = CRENEAUX_REELS;
const { modeOuvert, enEssai } = require('../api/_panier');

// Une fenêtre d'essai ouverte rendrait vrais tous les contrôles ci-dessous.
// Ils portent sur l'horaire : on la met de côté et on l'éprouve à part.
const ESSAI_REEL = carte().livraison.essaiJusqua;
carte().livraison.essaiJusqua = null;

// Heures d'été à Paris : UTC+2. 20h00 locales = 18:00Z, 00h30 = 22:30Z la veille.
const aParis = (jour, h, m) => new Date(Date.UTC(2026, 7, jour, h - 2, m || 0));

ok(modeOuvert('livraison', aParis(12, 20, 0)) === true, 'on livre à 20h');
ok(modeOuvert('livraison', aParis(12, 23, 59)) === true, 'on livre à 23h59');
ok(modeOuvert('livraison', aParis(12, 0, 30)) === false, 'on ne livre plus à 0h30');
ok(modeOuvert('livraison', aParis(12, 11, 0)) === false, 'on ne livre pas à 11h, avant l’ouverture');
ok(modeOuvert('livraison', aParis(12, 11, 30)) === true, 'on livre dès 11h30 pile');

ok(modeOuvert('emporter', aParis(12, 0, 30)) === true, 'on prépare encore à emporter à 0h30');
ok(modeOuvert('emporter', aParis(12, 1, 29)) === true, 'à emporter jusqu’à 1h29');
ok(modeOuvert('emporter', aParis(12, 1, 30)) === false, 'plus rien à emporter à 1h30 pile');
ok(modeOuvert('emporter', aParis(12, 3, 0)) === false, 'rien à 3h du matin');
ok(modeOuvert('emporter', aParis(12, 11, 30)) === true, 'à emporter dès 11h30');

// et les refus passent bien par le calcul du panier
refuse(() => calculer([{ plat: 'tikka', taille: 'large', quantite: 2 }], 'livraison', aParis(12, 1, 0)),
       'à 1h, la livraison est refusée');
r = calculer([{ plat: 'tikka', taille: 'large', quantite: 2 }], 'emporter', aParis(12, 1, 0));
ok(r.total === 2180, 'à 1h, le retrait reste possible', euros(r.total));
refuse(() => calculer([{ plat: 'tikka', taille: 'large', quantite: 2 }], 'emporter', aParis(12, 3, 0)),
       'à 3h, plus rien n’est accepté');

/* --- fenêtre d'essai ---------------------------------------------------- */
// Elle sert à essayer une commande hors des heures d'ouverture. Ce qui compte
// n'est pas qu'elle ouvre — c'est qu'elle se referme toute seule. Une
// boutique laissée ouverte la nuit prend de vraies commandes que personne ne
// prépare, et ça se paie en remboursements.
console.log('\n── fenêtre d’essai ───────────────────');

carte().livraison.essaiJusqua = '2026-08-12T09:30:00Z';   // 11h30 à Paris

ok(enEssai(aParis(12, 3, 0)) === true, 'à 3h du matin, l’essai court encore');
ok(modeOuvert('livraison', aParis(12, 3, 0)) === true,
   'et la livraison s’ouvre à une heure où elle est normalement fermée');
r = calculer([{ plat: 'tikka', taille: 'large', quantite: 2 }], 'livraison', aParis(12, 3, 0));
ok(r.total === 2180 + FRAIS, 'la commande passe le calcul', euros(r.total));

ok(enEssai(aParis(12, 11, 31)) === false, 'passé l’heure dite, l’essai est fini');
ok(modeOuvert('livraison', aParis(12, 11, 31)) === true,
   'l’horaire normal prend le relais sans trou');
refuse(() => calculer([{ plat: 'tikka', taille: 'large', quantite: 2 }], 'livraison', aParis(13, 1, 0)),
       'et la nuit suivante, la livraison est de nouveau refusée');

ok(enEssai(aParis(12, 3, 0)) === true && (function () {
  carte().livraison.essaiJusqua = null;
  return enEssai(aParis(12, 3, 0)) === false;
})(), 'sans date d’essai, rien n’est ouvert hors créneau');

carte().livraison.essaiJusqua = ESSAI_REEL;

// rouvert pour la suite, qui parle de tickets et non d'horaires
carte().livraison.creneaux = TOUJOURS;
carte().livraison.essaiJusqua = null;

console.log('\n── ticket transporté par le prestataire ──');
const { ticket, lireTicket, reference } = require('../api/_paiement');
const cmd = calculer([
  { plat: 'tikka', taille: 'large', quantite: 2,
    supplements: [{ groupe: 'supplement-viande', choix: 'merguez' }] },
  { plat: 'coca-cola', quantite: 1 }
], 'livraison');
const cli = verifierAdresse({ nom: 'Dupont', telephone: '0612345678',
  rue: '3 rue des Olivettes', codePostal: '44000', commentaire: 'Sans olives' });
const t = ticket(cmd, cli, 'livraison');
ok(t.length <= 380, 'ticket sous la limite du champ description', t.length + ' caractères');

const relu = lireTicket({ id: 'A7F3-K2', horodatage: 1786000000, description: t, montant: cmd.total });
ok(relu.mode === 'livraison', 'mode relu', relu.mode);
ok(relu.nom === 'Dupont', 'nom relu', relu.nom);
ok(relu.telephone === '0612345678', 'téléphone relu', relu.telephone);
ok(relu.adresse.indexOf('Olivettes') !== -1, 'adresse relue', relu.adresse);
ok(relu.commentaire === 'Sans olives', 'commentaire relu', relu.commentaire);
ok(relu.articles.length === 2 && relu.articles[0].n === 2, 'articles relus',
   relu.articles.map(function (a) { return a.n + '× ' + a.texte; }).join(' ; '));
ok(relu.total === euros(cmd.total), 'total relu', relu.total);

// une référence dictée au téléphone ne doit pas prêter à confusion
const refs = new Set();
for (let i = 0; i < 500; i++) refs.add(reference());
ok(refs.size > 495, 'références distinctes', refs.size + '/500');
ok(!/[IO01]/.test(Array.from(refs).join('')), 'aucun caractère ambigu (I, O, 0, 1)');

// La référence porte le mode en tête pour être lisible d'un coup d'œil dans
// l'application d'encaissement — c'est le seul endroit où le restaurateur
// regarde quand l'argent tombe.
const { referenceCourte } = require('../api/_paiement');
ok(/^LIVRAISON-[A-Z2-9]{4}-[A-Z2-9]{2}$/.test(reference('livraison')),
   'une livraison se reconnaît sans rien ouvrir', reference('livraison'));
ok(/^EMPORTER-[A-Z2-9]{4}-[A-Z2-9]{2}$/.test(reference('emporter')),
   'un retrait aussi', reference('emporter'));
const nue = reference();
ok(nue === referenceCourte(nue), 'sans mode, la référence reste nue', nue);
ok(referenceCourte('LIVRAISON-A7F3-K2') === 'A7F3-K2' &&
   referenceCourte('EMPORTER-A7F3-K2') === 'A7F3-K2',
   'et le client ne dicte que les six caractères');

const prefixees = new Set();
for (let i = 0; i < 500; i++) prefixees.add(reference('livraison'));
ok(prefixees.size > 495, 'le préfixe ne casse pas l’unicité', prefixees.size + '/500');

console.log('\n── allergènes ─────────────────────────');
const { allergenes } = require('./carte');
const dit = (ing, nom, type) => allergenes(ing, type || 'pizza', nom || '');
ok(!dit(['champignons', 'olives']).includes('fruits à coque'),
   '« champignons » ne déclare pas de fruits à coque');
ok(dit(['amandes', 'Daim'], 'Gâteau amandes & Daim', 'unite').includes('fruits à coque'),
   'les amandes en déclarent bien');
ok(dit(['sauce tomate', 'mozzarella']).join() === 'gluten,lait', 'margherita : gluten et lait',
   dit(['sauce tomate', 'mozzarella']).join(', '));
ok(dit(['sauce tomate', 'mozzarella', 'anchois', 'câpres']).includes('poissons'),
   'les anchois déclarent le poisson');
ok(dit(['crème fraîche', 'mozzarella', 'jambon de dinde', 'miel']).join() === 'gluten,lait',
   'le miel ne déclare rien de plus', dit(['crème fraîche', 'mozzarella', 'miel']).join(', '));
ok(dit([], 'Tiramisu', 'unite').join() === 'gluten,lait,oeufs', 'un dessert sans ingrédients listé se déduit du nom',
   dit([], 'Tiramisu', 'unite').join(', '));
ok(dit(['Eau plate', '50 cl'], 'Bouteille d’eau', 'unite').length === 0, 'l’eau ne déclare rien');

console.log('\n── début de service ───────────────────');
const { debutService } = require('../api/cuisine');
const h18 = debutService(new Date('2026-08-08T18:00:00+02:00'));
const h01 = debutService(new Date('2026-08-09T01:00:00+02:00'));
ok(h18 === h01, 'une commande de 1h du matin appartient au service de la veille');

console.log('\n' + (ko ? ko + ' contrôle(s) en échec' : 'Tout est vert.'));
process.exit(ko ? 1 : 0);
