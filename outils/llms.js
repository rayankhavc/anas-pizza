/* ==========================================================================
   /llms.txt — le site résumé pour les moteurs de réponse.
   --------------------------------------------------------------------------
   On ne cherche plus un restaurant seulement en tapant des mots-clés : on
   pose une question. « Une pizzeria ouverte après minuit à Nantes », « qui
   livre à Rezé », « une pizza sans porc ». Ce sont ChatGPT, Perplexity,
   Copilot et les aperçus IA de Google qui répondent, et ils répondent avec
   ce qu'ils arrivent à lire.

   Une page HTML pleine de balises, de scripts et de menus déroulants se lit
   mal. Un fichier texte qui énonce les faits se lit bien. D'où ce fichier :
   l'adresse, les horaires, la zone de livraison, les prix, la façon de
   commander, et la carte entière — en clair.

   Il est fabriqué depuis assets/data/carte.json, jamais à la main : une
   carte qui change sans que ce fichier suive serait pire que pas de fichier
   du tout, puisqu'un moteur affirmerait des prix faux avec aplomb.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SITE = (process.env.SITE_URL || 'https://anas-pizza.vercel.app')
  .trim().replace(/\/+$/, '');

const euros = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';

function main() {
  const carte = JSON.parse(
    fs.readFileSync(path.join(RACINE, 'assets/data/carte.json'), 'utf8'));

  const l = [];
  const ligne = (s) => l.push(s === undefined ? '' : s);

  ligne('# Anas Pizza Original');
  ligne('');
  ligne('> Pizzeria artisanale à Nantes centre. Plus de 40 pizzas cuites à la ' +
        'commande, sur place, à emporter ou en livraison. Commande et paiement ' +
        'en ligne sur ' + SITE + '.');
  ligne('');

  ligne('## L\'essentiel');
  ligne('');
  ligne('- **Adresse** : 10 allée Duguay Trouin, 44000 Nantes, France');
  ligne('- **Téléphone** : 02 59 10 01 98');
  ligne('- **E-mail** : anas.pizza.original@gmail.com');
  ligne('- **Horaires** : 7 jours sur 7, de 11h30 à 2h du matin. Service continu, midi et soir.');
  ligne('- **Commander en ligne** : ' + SITE + '/commander');
  ligne('- **Modes** : sur place, à emporter, livraison');
  ligne('- **Paiement** : carte bancaire en ligne, ou sur place');
  ligne('');

  const liv = carte.livraison || {};
  ligne('## Livraison');
  ligne('');
  ligne('- **Minimum de commande** : ' + euros(liv.minimum));
  ligne('- **Frais de livraison** : ' + euros(liv.frais));
  ligne('- **Délai estimé** : ' + liv.delai);
  ligne('- **Communes desservies** :');
  const vues = new Set();
  (liv.communes || []).forEach((c) => {
    const cle = c.cp + ' ' + c.nom;
    if (vues.has(cle)) return;
    vues.add(cle);
    ligne('  - ' + c.nom + ' (' + c.cp + ')');
  });
  ligne('');
  ligne('Hors de ces communes, la commande à emporter reste possible.');
  ligne('');

  if ((carte.offres || []).length) {
    const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    ligne('## Offres');
    ligne('');
    carte.offres.forEach((o) => {
      ligne('- **' + o.nom + '** : le ' + jours[o.jour] + ', toute pizza ' +
        (o.taille ? o.taille + ' ' : '') + 'à ' + euros(o.prix) +
        '. Appliquée automatiquement au panier.');
    });
    ligne('');
  }

  ligne('## La carte');
  ligne('');

  carte.categories.forEach((cat) => {
    ligne('### ' + cat.nom);
    ligne('');
    if (cat.type === 'pizza' && cat.tailles) {
      ligne('Tarifs : ' + cat.tailles.map((t) => t.nom + ' ' + euros(t.prix)).join(' · '));
      ligne('');
    }
    cat.plats.forEach((p) => {
      let s = '- **' + p.nom + '**';
      if (p.prix) s += ' — ' + euros(p.prix);
      s += ' : ' + p.description;
      const marques = (p.badges || []).map((b) => b.texte).filter(Boolean);
      if (marques.length) s += ' [' + marques.join(', ') + ']';
      if ((p.allergenes || []).length) s += ' Allergènes : ' + p.allergenes.join(', ') + '.';
      ligne(s);
    });
    ligne('');
  });

  if ((carte.supplements || []).length) {
    ligne('### Suppléments');
    ligne('');
    carte.supplements.forEach((g) => {
      ligne('- **' + g.nom + '** (' + euros(g.prix) + ' l\'unité) : ' +
        g.choix.map((c) => c.nom).join(', '));
    });
    ligne('');
  }

  ligne('## Allergènes');
  ligne('');
  ligne('Les quatorze allergènes réglementaires sont déclarés plat par plat sur ' +
        SITE + '/cgv. Les préparations sont faites dans une cuisine où sont ' +
        'manipulés gluten, lait, œufs, poissons, fruits à coque et soja : ' +
        'aucune absence de trace ne peut être garantie. En cas d\'allergie, ' +
        'appeler le 02 59 10 01 98 avant de commander.');
  ligne('');

  ligne('## Pages');
  ligne('');
  ligne('- [Accueil et carte complète](' + SITE + '/)');
  ligne('- [Commander en ligne](' + SITE + '/commander)');
  ligne('- [Conditions générales de vente et allergènes](' + SITE + '/cgv)');
  ligne('- [Mentions légales](' + SITE + '/mentions-legales)');
  ligne('- [Politique de confidentialité](' + SITE + '/politique-de-confidentialite)');
  ligne('');
  ligne('---');
  ligne('');
  ligne('Fichier généré le ' + new Date().toISOString().slice(0, 10) +
        ' depuis la carte du restaurant. Les prix font foi sur le site.');
  ligne('');

  fs.writeFileSync(path.join(RACINE, 'llms.txt'), l.join('\n'));
  const plats = carte.categories.reduce((s, c) => s + c.plats.length, 0);
  console.log('[llms] llms.txt écrit — ' + plats + ' plats, ' +
    carte.categories.length + ' rubriques.');
}

try {
  main();
} catch (e) {
  console.warn('[llms] interrompu sans dommage :', e.message);
}
