/* ==========================================================================
   Un seul endroit pour l'adresse du site.
   --------------------------------------------------------------------------
   Le site était écrit pour https://www.anaspizza-nantes.fr, un domaine qui
   n'a jamais été acheté. Quarante-trois adresses — canoniques, Open Graph,
   plan du site, robots.txt, données structurées — désignaient donc un
   domaine mort, pendant que le site vivait ailleurs.

   Ce n'est pas cosmétique. Une balise canonique qui pointe vers un domaine
   qui ne répond pas dit à Google : « la vraie page est là-bas ». Google y
   va, ne trouve rien, et n'indexe pas la page qu'il avait sous les yeux.
   Le site peut être parfait, il reste invisible.

   Désormais l'adresse est ici, et nulle part ailleurs. Le jour où le
   restaurant achète son nom de domaine, on change cette ligne — ou on pose
   SITE_URL dans Vercel — et tout suit.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');

// L'adresse réelle du site. Vercel fournit VERCEL_PROJECT_PRODUCTION_URL,
// mais on ne s'en sert pas par défaut : elle change selon le déploiement et
// une canonique doit être stable.
const SITE = (process.env.SITE_URL || 'https://anas-pizza.vercel.app')
  .trim().replace(/\/+$/, '');

// Toute adresse absolue déjà posée par une exécution précédente, quelle
// qu'elle soit, est remplacée. Le script est donc rejouable sans dégât.
const CONNUES = [
  'https://www.anaspizza-nantes.fr',
  'https://anaspizza-nantes.fr',
  'https://anas-pizza.vercel.app'
];

const FICHIERS = ['.html', '.xml', '.txt', '.webmanifest'];

function main() {
  const cibles = fs.readdirSync(RACINE)
    .filter((f) => FICHIERS.some((e) => f.endsWith(e)));

  let touchees = 0;
  let remplacements = 0;

  for (const nom of cibles) {
    const abs = path.join(RACINE, nom);
    const avant = fs.readFileSync(abs, 'utf8');
    let apres = avant;

    for (const ancienne of CONNUES) {
      if (ancienne === SITE) continue;
      const n = apres.split(ancienne).length - 1;
      if (n) {
        apres = apres.split(ancienne).join(SITE);
        remplacements += n;
      }
    }

    if (apres !== avant) {
      fs.writeFileSync(abs, apres);
      touchees++;
    }
  }

  console.log('[domaine] ' + SITE + ' — ' + remplacements +
    ' adresse(s) réécrite(s) dans ' + touchees + ' fichier(s).');
}

try {
  main();
} catch (e) {
  console.warn('[domaine] interrompu sans dommage :', e.message);
}
