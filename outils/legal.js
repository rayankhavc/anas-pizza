/* ==========================================================================
   Les deux mentions qui ne s'écrivent pas dans le code.
   --------------------------------------------------------------------------
   Deux informations légales manquaient au site, et pour la même raison : ce
   sont des faits du monde réel, pas des choix techniques. Personne ne peut
   les inventer depuis un éditeur de texte.

     MEDIATEUR_NOM      le médiateur de la consommation auquel adhère le
     MEDIATEUR_ADRESSE  restaurant. L'adhésion est obligatoire dès lors qu'un
     MEDIATEUR_URL      professionnel vend à des consommateurs (art. L.612-1
                        et L.616-1 du Code de la consommation), et le nom doit
                        figurer sur le site, en boutique et sur les bons de
                        commande. Son absence est sanctionnable.

     SUMUP_ENTITE       la raison sociale et l'adresse de l'entité SumUp qui
                        a signé le contrat d'acceptation, telles qu'elles
                        figurent sur le contrat du restaurant.

   Elles vivaient jusqu'ici sous forme d'encadrés « À compléter » — des notes
   d'auteur, visibles par les clients sur une page qui engage juridiquement le
   restaurant. Une page légale inachevée aux yeux de tous est pire que la
   mention manquante : elle donne à lire que personne ne l'a relue.

   D'où ce script, calqué sur outils/domaine.js. Deux états, jamais trois :

   - variables posées   → la mention exacte s'affiche, comme la loi l'exige ;
   - variables absentes → une phrase adressée au client, qui lui dit comment
                          obtenir l'information. Ce n'est pas la conformité,
                          et ça ne prétend pas l'être ; c'est ce qui se dit
                          honnêtement en attendant, sans laisser traîner une
                          note interne. Le rappel, lui, part dans les journaux
                          de construction à chaque déploiement.

   Le jour où le restaurant adhère à un médiateur, on pose la variable dans
   Vercel et les deux pages se remplissent au déploiement suivant. Aucun code
   à toucher.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PAGES = ['mentions-legales.html', 'cgv.html'];

const val = (n) => String(process.env[n] || '').trim();

function echapper(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Remplace le contenu entre deux marqueurs.
 * Les marqueurs restent en place : le script est rejouable à chaque
 * construction, et une variable retirée refait apparaître le texte d'attente.
 */
function remplacer(html, nom, contenu) {
  const debut = '<!-- ' + nom + ':debut -->';
  const fin = '<!-- ' + nom + ':fin -->';
  const i = html.indexOf(debut);
  const j = html.indexOf(fin);
  if (i === -1 || j === -1 || j < i) return html;
  return html.slice(0, i + debut.length) + '\n' + contenu + '\n      ' + html.slice(j);
}

/* --- les deux blocs ------------------------------------------------------ */

function blocMediateur() {
  const nom = val('MEDIATEUR_NOM');
  if (!nom) return null;

  const adresse = val('MEDIATEUR_ADRESSE');
  const url = val('MEDIATEUR_URL');
  const lien = /^https:\/\/[\w.-]+/.test(url)
    ? ' — <a href="' + echapper(url) + '" target="_blank" rel="noopener">' +
      echapper(url.replace(/^https:\/\//, '')) + '</a>'
    : '';

  return '      <p>L’établissement a désigné le médiateur de la consommation suivant&nbsp;:\n' +
    '        <strong>' + echapper(nom) + '</strong>' +
    (adresse ? ', ' + echapper(adresse) : '') + lien + '.\n' +
    '        La saisine est gratuite pour le consommateur et n’est recevable qu’après une réclamation\n' +
    '        écrite préalable auprès de l’établissement.</p>';
}

function blocSumUp() {
  const entite = val('SUMUP_ENTITE');
  if (!entite) return null;
  return '      <p>Le prestataire de paiement est&nbsp;: <strong>' + echapper(entite) +
    '</strong>.</p>';
}

/* --- exécution ----------------------------------------------------------- */

function main() {
  const blocs = { mediateur: blocMediateur(), sumup: blocSumUp() };
  const manquants = [];

  for (const page of PAGES) {
    const chemin = path.join(RACINE, page);
    if (!fs.existsSync(chemin)) continue;

    let html = fs.readFileSync(chemin, 'utf8');
    const avant = html;

    for (const [nom, contenu] of Object.entries(blocs)) {
      if (contenu && html.includes('<!-- ' + nom + ':debut -->')) {
        html = remplacer(html, nom, contenu);
      }
    }

    if (html !== avant) {
      fs.writeFileSync(chemin, html);
      console.log('[legal] ' + page + ' mis à jour.');
    }
  }

  if (!blocs.mediateur) manquants.push('MEDIATEUR_NOM (médiateur de la consommation)');
  if (!blocs.sumup) manquants.push('SUMUP_ENTITE (entité SumUp du contrat)');

  if (manquants.length) {
    console.warn('[legal] Mentions encore absentes : ' + manquants.join(', ') + '.');
    console.warn('[legal] Le site affiche en attendant une phrase renvoyant le client ' +
      'vers le restaurant. Ce n’est pas la conformité : le nom du médiateur est ' +
      'obligatoire (art. L.616-1 du Code de la consommation).');
  }
}

main();
