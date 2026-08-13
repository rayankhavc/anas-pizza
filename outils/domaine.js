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

   ── Sa place dans la chaîne de construction ────────────────────────────────
   Ce script passe en AVANT-DERNIER, juste avant l'empreinte des versions, et
   ce n'est pas un détail d'ordonnancement. Il réécrit des fichiers ; tout
   générateur qui écrirait une adresse après lui la lui ferait manquer. C'est
   arrivé avec llms.txt, qui était produit après son passage et gardait donc
   l'ancienne adresse alors que les huit autres fichiers étaient à jour — un
   défaut invisible, parce que le fichier existait bien et paraissait juste.
   Tout ce qui écrit une URL doit tourner avant lui.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');

// L'adresse réelle du site. Vercel fournit VERCEL_PROJECT_PRODUCTION_URL,
// mais on ne s'en sert pas par défaut : elle change selon le déploiement et
// une canonique doit être stable.
// Le domaine du restaurant, acheté le 13 août 2026. Sans « www » : une seule
// forme fait autorité, et c'est celle-là. La variante www redirige vers elle
// côté hébergeur, elle n'apparaît nulle part dans les pages.
const SITE = (process.env.SITE_URL || 'https://anaspizzaoriginal.fr')
  .trim().replace(/\/+$/, '');

// Toute adresse absolue déjà posée par une exécution précédente, quelle
// qu'elle soit, est remplacée. Le script est donc rejouable sans dégât — et
// c'est ce qui permet de changer de domaine sans chasser les occurrences.
const CONNUES = [
  'https://www.anaspizza-nantes.fr',
  'https://anaspizza-nantes.fr',
  'https://anas-pizza.vercel.app',
  'https://www.anaspizzaoriginal.fr'
];

const FICHIERS = ['.html', '.xml', '.txt', '.webmanifest'];

function main() {
  const cibles = fs.readdirSync(RACINE)
    .filter((f) => FICHIERS.some((e) => f.endsWith(e)));

  let touchees = 0;
  let remplacements = 0;
  let normalisees = 0;

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

    // Vercel sert les pages sans extension et redirige /page.html en 308.
    // Une canonique qui désigne l'adresse redirigée fait suivre une
    // redirection à chaque passage du robot, pour rien. On normalise ici
    // plutôt que dans les fichiers : une correction faite à la main se perd
    // au premier coup de git checkout — c'est arrivé.
    const propre = apres.replace(
      new RegExp('(' + SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '/[a-z0-9-]+)\\.html', 'g'), '$1');
    if (propre !== apres) {
      normalisees += apres.split('.html').length - propre.split('.html').length;
      apres = propre;
    }

    if (apres !== avant) {
      fs.writeFileSync(abs, apres);
      touchees++;
    }
  }

  console.log('[domaine] ' + SITE + ' — ' + remplacements +
    ' adresse(s) réécrite(s), ' + normalisees +
    ' sans extension, dans ' + touchees + ' fichier(s).');
}

try {
  main();
} catch (e) {
  console.warn('[domaine] interrompu sans dommage :', e.message);
}
