/* ==========================================================================
   Empreinte des feuilles de style et des scripts
   --------------------------------------------------------------------------
   Un téléphone garde volontiers en mémoire un fichier CSS pendant des jours.
   Le client rouvre le site après une mise en ligne, voit l'ancien affichage,
   et conclut que rien n'a été corrigé. C'est arrivé.

   On ajoute donc à chaque référence une empreinte du contenu :
       assets/css/styles.css?v=3f9a1c2b
   L'adresse change dès que le fichier change, le navigateur retélécharge.
   Tant que le fichier ne bouge pas, l'adresse ne bouge pas non plus et le
   cache continue de faire son travail.

   Le script est idempotent : il retire l'empreinte précédente avant d'en
   poser une nouvelle, donc on peut le relancer autant de fois qu'on veut.
   Il ne fait jamais échouer la construction.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..');
const CIBLES = /(href|src)="(assets\/(?:css|js)\/[a-z0-9._-]+\.(?:css|js))(?:\?v=[a-z0-9]+)?"/gi;

const empreintes = new Map();

function empreinte(rel) {
  if (empreintes.has(rel)) return empreintes.get(rel);
  let v = null;
  try {
    const contenu = fs.readFileSync(path.join(RACINE, rel));
    v = crypto.createHash('sha1').update(contenu).digest('hex').slice(0, 8);
  } catch (e) {
    console.warn('[versions] fichier introuvable, laissé tel quel : ' + rel);
  }
  empreintes.set(rel, v);
  return v;
}

function main() {
  const pages = fs.readdirSync(RACINE).filter((f) => f.endsWith('.html'));
  let touchees = 0;

  for (const page of pages) {
    const abs = path.join(RACINE, page);
    const avant = fs.readFileSync(abs, 'utf8');
    const apres = avant.replace(CIBLES, (tout, attr, rel) => {
      const v = empreinte(rel);
      return v ? attr + '="' + rel + '?v=' + v + '"' : attr + '="' + rel + '"';
    });
    if (apres !== avant) {
      fs.writeFileSync(abs, apres);
      touchees++;
    }
  }

  console.log('[versions] ' + empreintes.size + ' fichier(s) empreint(s), ' +
    touchees + ' page(s) mise(s) à jour.');
}

try {
  main();
} catch (e) {
  console.warn('[versions] interrompu sans dommage :', e.message);
}
