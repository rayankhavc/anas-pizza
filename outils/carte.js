/* ==========================================================================
   Génère assets/data/carte.json à partir d'index.html.
   --------------------------------------------------------------------------
   La carte n'est écrite qu'à un seul endroit : index.html. Ce script en tire
   un catalogue lisible par machine, utilisé à la fois par la page de commande
   (affichage) et par la fonction serveur (calcul du prix). Une pizza modifiée
   dans index.html se répercute partout après « node outils/carte.js ».

   Les prix sont en centimes, jamais en euros flottants : 7,90 € vaut 790.
   Un centime perdu dans un arrondi, c'est un paiement qui ne tombe pas juste.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SORTIE = path.join(RACINE, 'assets/data/carte.json');

// ── conditions de livraison ────────────────────────────────────────────────
// Communes desservies, code postal exigé à la commande. À compléter avec le
// restaurant : toute commune absente d'ici est refusée par le serveur.
// Conditions confirmées par le restaurant le 10 août 2026.
const LIVRAISON = {
  minimum: 1380,          // 13,80 € de commande minimum
  frais: 299,             // 2,99 € de frais de livraison
  delai: '30 min',
  // Un créneau par mode de retrait : le restaurant sert jusqu'à 2h, mais il
  // ne livre que jusqu'à minuit, et il arrête de prendre des commandes à
  // emporter à 1h30 pour avoir le temps de les préparer avant la fermeture.
  // Hors créneau, le serveur refuse — mieux vaut un refus clair qu'une
  // pizza payée que personne ne prépare.
  creneaux: {
    livraison: { debut: '11:30', fin: '00:00' },
    emporter: { debut: '11:30', fin: '01:30' }
  },
  // Fenêtre d'essai. Tant que cette date n'est pas passée, les deux créneaux
  // sont considérés ouverts, à n'importe quelle heure — c'est le seul moyen
  // d'essayer une livraison à quatre heures du matin.
  //
  // Elle porte une date de fin, et pas un interrupteur, pour une raison
  // précise : un interrupteur s'oublie. Une boutique laissée ouverte la nuit
  // prend de vraies commandes que personne ne prépare, et ça se paie en
  // remboursements et en avis. La date choisie est l'heure d'ouverture
  // normale suivante : à partir de là, l'essai ne donne plus rien que
  // l'horaire ne donnait déjà.
  //
  // Mettre null pour revenir au fonctionnement normal sans attendre.
  essaiJusqua: '2026-08-13T09:30:00Z',   // 11h30 à Paris
  communes: [
    { cp: '44000', nom: 'Nantes' },
    { cp: '44100', nom: 'Nantes' },
    { cp: '44200', nom: 'Nantes' },
    { cp: '44300', nom: 'Nantes' },
    { cp: '44800', nom: 'Saint-Herblain' },
    { cp: '44230', nom: 'Saint-Sébastien-sur-Loire' },
    { cp: '44400', nom: 'Rezé' },
    { cp: '44700', nom: 'Orvault' }
  ]
};

// ── offres ────────────────────────────────────────────────────────────────
// Le restaurant a renoncé à l'offre du mardi en ligne : la liste est vide, et
// le site n'affiche donc aucune remise. Le mécanisme reste en place et sous
// contrôles — pour le rallumer un jour, il suffit de remettre une entrée :
//
//   { id: 'mardi', nom: 'Offre du mardi', jour: 2, finService: 2,
//     taille: 'medium', prix: 590 }
//
// jour : 0 = dimanche … 6 = samedi. taille : null pour toutes les tailles.
// finService : l'heure jusqu'à laquelle la nuit compte pour la veille.
const OFFRES = [];

const sansBalises = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
// \u00ab L\u00e9gumes & \u0153uf \u00bb \u2192 \u00ab legumes-oeuf \u00bb. NFD ne d\u00e9compose pas les ligatures :
// \u0153 et \u00e6 sont traduits \u00e0 la main, sinon l'identifiant perd une lettre.
const slug = (s) => s.replace(/\u0153/g, 'oe').replace(/\u0152/g, 'OE')
  .replace(/\u00e6/g, 'ae').replace(/\u00c6/g, 'AE')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// « 7,90 € » → 790
function centimes(txt) {
  const m = decode(txt).replace(/\s/g, '').match(/(\d+)[,.](\d{2})/);
  if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  const e = decode(txt).match(/(\d+)/);
  if (!e) throw new Error('prix illisible : ' + txt);
  return parseInt(e[1], 10) * 100;
}

// ── allergènes ─────────────────────────────────────────────────────────────
// Les 14 allergènes à déclaration obligatoire (règlement UE 1169/2011),
// rattachés aux ingrédients tels qu'ils sont écrits sur la carte. La pâte
// apporte le gluten à toutes les pizzas ; le reste vient de la garniture.
//
// Cette table est une aide à la lecture, jamais une garantie : la cuisine est
// unique, les traces sont possibles partout, et c'est écrit sur la page.
const ALLERGENES = {
  gluten: ['pate', 'pain', 'cordon bleu', 'tenders', 'nuggets', 'sticks', 'brownie',
           'tiramisu', 'gateau', 'tarte', 'kebab', 'pizza', 'calzone',
           'croustillantes', 'croustillant', 'panees', 'panee', 'pane', 'beignet'],
  lait: ['mozzarella', 'chevre', 'parmesan', 'cheddar', 'boursin', 'reblochon', 'creme',
         'fromage', 'fromages', 'burrata', 'beurre', 'tiramisu', 'brownie', 'gateau',
         'raclette'],
  oeufs: ['oeuf', 'mayonnaise', 'tiramisu', 'gateau', 'brownie', 'cordon bleu'],
  poissons: ['saumon', 'thon', 'anchois'],
  'fruits à coque': ['amande', 'amandes', 'noix', 'noisette', 'noisettes', 'daim',
                     'pignon', 'pignons', 'pistache', 'pistaches'],
  soja: ['soja'],
  moutarde: ['moutarde', 'sauce algerienne', 'sauce barbecue'],
  sesame: ['sesame'],
  celeri: ['celeri'],
  sulfites: ['vinaigre', 'vinaigre balsamique', 'capres']
};

// Sans accent ni majuscule, pour comparer « Câpres » et « capres ».
const aplati = (s) => s.replace(/œ/g, 'oe').replace(/æ/g, 'ae')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Un ingrédient déclenche un allergène s'il contient le mot entier.
 * La recherche par sous-chaîne se trompait : « champignons » contient
 * « pignon », ce qui déclarait des fruits à coque sur toutes les pizzas aux
 * champignons. Une déclaration fausse est inutile même quand elle penche du
 * côté prudent : elle écarte un client de plats qu'il pouvait manger.
 */
function contientMot(texte, expression) {
  const mots = aplati(texte).split(/[^a-z0-9]+/).filter(Boolean);
  const cible = aplati(expression).split(/[^a-z0-9]+/).filter(Boolean);
  if (cible.length === 1) return mots.includes(cible[0]);
  // expression de plusieurs mots : on la cherche telle quelle
  return (' ' + mots.join(' ') + ' ').includes(' ' + cible.join(' ') + ' ');
}

function allergenes(ingredients, type, nom) {
  // le nom compte autant que la description : « Tiramisu » et « Brownie »
  // n'ont pas de liste d'ingrédients, mais disent déjà ce qu'ils contiennent
  const txt = (nom || '') + ', ' + ingredients.join(', ');
  const out = new Set();
  if (type === 'pizza') out.add('gluten');   // la pâte
  for (const [allergene, mots] of Object.entries(ALLERGENES)) {
    if (mots.some((m) => contientMot(txt, m))) out.add(allergene);
  }
  return Array.from(out).sort();
}

function plats(corps) {
  const out = [];
  const re = /<article class="item">([\s\S]*?)<\/article>/g;
  let a;
  while ((a = re.exec(corps))) {
    const bloc = a[1];
    const img = (bloc.match(/class="item__img" src="([^"]+)"/) || [])[1] || '';
    const nom = (bloc.match(/class="item__name">([\s\S]*?)<\/span>/) || [])[1];
    const desc = (bloc.match(/class="item__desc">([\s\S]*?)<\/p>/) || [])[1] || '';
    const prix = (bloc.match(/class="item__price">([\s\S]*?)<\/span>/) || [])[1];
    if (!nom) continue;
    const badges = [];
    let b;
    const reb = /class="badge badge--([a-z]+)">([\s\S]*?)<\/span>/g;
    while ((b = reb.exec(bloc))) badges.push({ type: b[1], texte: decode(sansBalises(b[2])) });

    const nomClair = decode(sansBalises(nom));
    const plat = {
      // l'identifiant vient du nom du visuel ; les produits sans visuel
      // (les suppléments) le tirent de leur nom
      // « plats/tikka.svg » comme « plats/opt/tikka-256.webp » donnent « tikka » :
      // le catalogue est généré après la construction, quand les visuels ont
      // déjà été remplacés par les photos optimisées.
      id: path.basename(img).replace(/\.[a-z0-9]+$/i, '').replace(/-(?:256|720)$/, '') || slug(nomClair),
      nom: nomClair,
      description: decode(sansBalises(desc)),
      photo: img || null,
      badges
    };
    // les ingrédients servent aux allergènes et à la fiche détaillée
    plat.ingredients = plat.description.replace(/\.$/, '')
      .split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
    if (prix) plat.prix = centimes(prix);
    if (!plat.id) throw new Error('plat sans identifiant : ' + plat.nom);
    out.push(plat);
  }
  return out;
}

function main() {
  const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  const carte = html.match(/id="carte"([\s\S]*?)<p class="menu-foot"/);
  if (!carte) throw new Error('section carte introuvable dans index.html');

  const categories = [];
  const re = /<div class="menu-cat" data-cat="([a-z-]+)">([\s\S]*?)(?=<div class="menu-cat" data-cat=|$)/g;
  let c;
  while ((c = re.exec(carte[1]))) {
    const id = c[1];
    const corps = c[2];
    const titre = decode(sansBalises((corps.match(/menu-cat__title">([\s\S]*?)<\/h3>/) || [])[1] || id));

    // tailles de la rubrique (Medium / Large) — absentes pour les rubriques
    // vendues à l'unité
    const tailles = [];
    let t;
    const ret = /price-tag"><span>([^<]*)<\/span><b>([^<]*)<\/b>/g;
    while ((t = ret.exec(corps))) {
      tailles.push({
        id: decode(sansBalises(t[1])).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        nom: decode(sansBalises(t[1])),
        prix: centimes(t[2])
      });
    }

    const liste = plats(corps);
    const aPrixUnitaire = liste.every((p) => typeof p.prix === 'number');

    categories.push({
      id,
      nom: titre,
      // « pizza » = prix porté par la rubrique et choix d'une taille ;
      // « unite » = chaque produit a son propre prix.
      type: aPrixUnitaire ? 'unite' : 'pizza',
      tailles: aPrixUnitaire ? [] : tailles,
      plats: liste
    });
  }

  for (const cat of categories) {
    for (const p of cat.plats) p.allergenes = allergenes(p.ingredients, cat.type, p.nom);
  }

  const supp = categories.find((x) => x.id === 'supplements');
  const carteFinale = {
    genere: new Date().toISOString().slice(0, 10),
    source: 'index.html',
    livraison: LIVRAISON,
    offres: OFFRES,
    // Un supplément se choisit en deux temps : le groupe fixe le prix
    // (fromage 0,50 €, viande 1,00 €…), la liste donne l'ingrédient exact.
    supplements: supp ? supp.plats.map((p) => ({
      id: p.id,
      nom: p.nom,
      prix: p.prix,
      choix: p.ingredients.map((i) => ({ id: slug(i), nom: i.charAt(0).toUpperCase() + i.slice(1) }))
    })) : [],
    categories: categories.filter((x) => x.id !== 'supplements')
  };

  // ── garde-fous : mieux vaut échouer ici qu'encaisser un mauvais montant ──
  const vus = new Set();
  for (const cat of carteFinale.categories) {
    if (cat.type === 'pizza' && cat.tailles.length === 0) {
      throw new Error('rubrique « ' + cat.id + ' » sans taille ni prix unitaire');
    }
    for (const p of cat.plats) {
      if (vus.has(p.id)) throw new Error('identifiant en double : ' + p.id);
      vus.add(p.id);
      if (cat.type === 'unite' && !(p.prix > 0)) throw new Error('prix manquant : ' + p.id);
    }
  }
  if (!carteFinale.supplements.length) throw new Error('aucun supplément trouvé');
  for (const o of carteFinale.offres) {
    if (!(o.prix > 0)) throw new Error('offre sans prix : ' + o.id);
    // une « remise » plus chère que le tarif courant serait un piège
    const concernees = carteFinale.categories
      .filter((c) => c.type === 'pizza')
      .flatMap((c) => c.tailles.filter((t) => !o.taille || t.id === o.taille));
    if (!concernees.length) throw new Error('offre « ' + o.id + ' » ne vise aucune taille');
    if (concernees.every((t) => t.prix <= o.prix)) {
      throw new Error('offre « ' + o.id + ' » plus chère que la carte');
    }
  }
  for (const s of carteFinale.supplements) {
    if (!(s.prix > 0) || !s.choix.length) throw new Error('supplément incomplet : ' + s.id);
  }

  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, JSON.stringify(carteFinale, null, 1) + '\n');

  const n = carteFinale.categories.reduce((s, c) => s + c.plats.length, 0);
  console.log('[carte] ' + n + ' produits, ' + carteFinale.categories.length +
    ' rubriques, ' + carteFinale.supplements.length + ' suppléments → ' +
    path.relative(RACINE, SORTIE));
  return carteFinale;
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('[carte] ' + e.message);
    process.exit(1);
  }
}

module.exports = { main, centimes, allergenes, ALLERGENES, OFFRES };
