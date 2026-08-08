/* ==========================================================================
   Injecte le tableau des allergènes dans cgv.html.
   --------------------------------------------------------------------------
   Le tableau est calculé à partir des ingrédients réels (voir outils/carte.js)
   et réécrit entre deux marqueurs HTML. Modifier une recette dans index.html
   met donc à jour la déclaration d'allergènes toute seule — un tableau tenu
   à la main aurait divergé dès la première pizza modifiée.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const CIBLE = path.join(RACINE, 'cgv.html');
const DEBUT = '<!-- allergenes:debut -->';
const FIN = '<!-- allergenes:fin -->';

const ORDRE = ['gluten', 'lait', 'oeufs', 'poissons', 'fruits à coque',
  'soja', 'moutarde', 'sesame', 'celeri', 'sulfites'];
const LISIBLE = {
  gluten: 'Gluten', lait: 'Lait', oeufs: 'Œufs', poissons: 'Poissons',
  'fruits à coque': 'Fruits à coque', soja: 'Soja', moutarde: 'Moutarde',
  sesame: 'Sésame', celeri: 'Céleri', sulfites: 'Sulfites'
};

function main() {
  const carte = JSON.parse(fs.readFileSync(path.join(RACINE, 'assets/data/carte.json'), 'utf8'));

  const lignes = [];
  for (const cat of carte.categories) {
    if (cat.id === 'boissons') continue;   // aucun allergène à déclarer
    lignes.push('        <tr class="allerg__cat"><th colspan="2" scope="rowgroup">' + cat.nom + '</th></tr>');
    for (const p of cat.plats) {
      const noms = ORDRE.filter((a) => p.allergenes.includes(a)).map((a) => LISIBLE[a]);
      lignes.push('        <tr><th scope="row">' + p.nom + '</th><td>' +
        (noms.length ? noms.join(', ') : '—') + '</td></tr>');
    }
  }

  const table =
    DEBUT + '\n' +
    '      <table class="allerg">\n' +
    '        <caption class="sr-only">Allergènes présents dans chaque plat</caption>\n' +
    '        <thead><tr><th scope="col">Plat</th><th scope="col">Allergènes présents</th></tr></thead>\n' +
    '        <tbody>\n' + lignes.join('\n') + '\n        </tbody>\n' +
    '      </table>\n      ' + FIN;

  let html = fs.readFileSync(CIBLE, 'utf8');
  const i = html.indexOf(DEBUT);
  const j = html.indexOf(FIN);
  if (i === -1 || j === -1) throw new Error('marqueurs allergenes absents de cgv.html');
  html = html.slice(0, i) + table + html.slice(j + FIN.length);
  fs.writeFileSync(CIBLE, html);

  const n = lignes.filter((l) => !l.includes('allerg__cat')).length;
  console.log('[cgv] tableau des allergènes : ' + n + ' plats');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('[cgv] ' + e.message);
    process.exit(1);
  }
}

module.exports = { main };
