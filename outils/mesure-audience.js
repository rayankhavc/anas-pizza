/* ==========================================================================
   Search Console et Google Analytics — posés par variables, pas par édition.
   --------------------------------------------------------------------------
   Deux variables dans Vercel, rien à recoder, exactement comme le paiement :

     GSC_TOKEN  → la balise de vérification Search Console
     GA4_ID     → l'identifiant de mesure Google Analytics (G-XXXXXXXXXX)

   Sans elles, le script ne pose rien et le site reste tel qu'il est.

   ── Une conséquence à connaître avant de poser GA4_ID ──────────────────────
   Search Console ne dépose aucun cookie : c'est une balise inerte, elle prouve
   seulement au moteur qu'on est propriétaire du site. Aucun impact.

   Google Analytics, si. Il dépose des cookies de mesure d'audience, et la
   CNIL les soumet au consentement dès lors que l'outil n'est pas configuré
   en mesure exemptée. Or ce site n'a aujourd'hui aucun traceur — c'est
   d'ailleurs écrit noir sur blanc dans la politique de confidentialité, et
   c'est pour ça qu'il n'affiche aucun bandeau. Poser GA4_ID sans rien
   changer d'autre rendrait ces deux pages fausses et le site non conforme.

   Donc : GA4_ID n'a rien d'un interrupteur anodin. Le jour où on le pose, il
   faut aussi un bandeau de consentement et une réécriture des deux pages
   légales. Le script le rappelle dans la console à chaque construction.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const GSC = (process.env.GSC_TOKEN || '').trim();
const GA4 = (process.env.GA4_ID || '').trim();

const DEBUT = '<!-- mesure:debut -->';
const FIN = '<!-- mesure:fin -->';

// Les écrans internes ne sont ni indexés ni mesurés : la cuisine n'est pas
// une audience, et la page de confirmation contient des données de client.
const EXCLUES = new Set(['cuisine.html', 'commande-confirmee.html']);

function bloc() {
  const l = [DEBUT];
  if (GSC) {
    l.push('<meta name="google-site-verification" content="' +
      GSC.replace(/"/g, '&quot;') + '">');
  }
  if (GA4) {
    const id = GA4.replace(/[^A-Za-z0-9-]/g, '');
    l.push('<script async src="https://www.googletagmanager.com/gtag/js?id=' + id + '"></script>');
    l.push('<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}' +
      'gtag(\'js\',new Date());gtag(\'config\',\'' + id + '\',{anonymize_ip:true});</script>');
  }
  l.push(FIN);
  return l.join('\n');
}

function main() {
  const pages = fs.readdirSync(RACINE)
    .filter((f) => f.endsWith('.html') && !EXCLUES.has(f));

  const nouveau = bloc();
  let touchees = 0;

  for (const nom of pages) {
    const abs = path.join(RACINE, nom);
    const avant = fs.readFileSync(abs, 'utf8');
    let apres = avant;

    // on retire toujours le bloc précédent : le script est ainsi rejouable,
    // et retirer une variable retire vraiment ce qu'elle avait posé
    const i = apres.indexOf(DEBUT);
    const j = apres.indexOf(FIN);
    if (i !== -1 && j !== -1) {
      // on avale aussi le saut de ligne posé à l'insertion, sinon retirer les
      // variables laisse une ligne vide derrière soi à chaque passage
      let apresFin = j + FIN.length;
      if (apres[apresFin] === '\n') apresFin++;
      apres = apres.slice(0, i) + apres.slice(apresFin);
    }

    if (GSC || GA4) {
      const tete = apres.indexOf('</head>');
      if (tete === -1) continue;
      apres = apres.slice(0, tete) + nouveau + '\n' + apres.slice(tete);
    }

    if (apres !== avant) {
      fs.writeFileSync(abs, apres);
      touchees++;
    }
  }

  const quoi = [GSC && 'Search Console', GA4 && 'Analytics ' + GA4]
    .filter(Boolean).join(' + ') || 'rien (aucune variable posée)';
  console.log('[mesure] ' + quoi + ' — ' + touchees + ' page(s) modifiée(s).');

  if (GA4) {
    console.warn('[mesure] ⚠ GA4 dépose des cookies soumis à consentement. ' +
      'Il faut un bandeau et corriger la politique de confidentialité, ' +
      'qui affirme aujourd’hui qu’aucun traceur n’est utilisé.');
  }
}

try {
  main();
} catch (e) {
  console.warn('[mesure] interrompu sans dommage :', e.message);
}
