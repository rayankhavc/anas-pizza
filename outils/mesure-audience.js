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

   Donc : GA4_ID n'a rien d'un interrupteur anodin. Ce script s'occupe des
   trois conséquences plutôt que de les rappeler et de les laisser à faire :

   - il pose le mode consentement de Google en « refusé » avant même de
     charger la balise, si bien que rien n'est déposé tant que le visiteur
     n'a pas dit oui ;
   - il ajoute le bandeau de consentement, avec « Refuser » aussi visible
     et aussi facile qu'« Accepter », comme la CNIL l'exige ;
   - il réécrit la section « Cookies et traceurs » de la politique de
     confidentialité, qui affirme sinon qu'aucun traceur n'est utilisé.

   Retirer GA4_ID défait les trois. La page légale dit donc toujours la
   vérité sur la configuration réelle, sans que personne ait à y penser.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const GSC = (process.env.GSC_TOKEN || '').trim();
const GA4 = (process.env.GA4_ID || '').trim();

const DEBUT = '<!-- mesure:debut -->';
const FIN = '<!-- mesure:fin -->';

// Les écrans internes ne sont ni indexés ni mesurés : la cuisine et la
// gestion ne sont pas une audience — les compter fausserait les chiffres avec
// le personnel — et la page de confirmation contient des données de client.
const EXCLUES = new Set(['cuisine.html', 'admin.html', 'commande-confirmee.html']);

function bloc() {
  const l = [DEBUT];
  if (GSC) {
    l.push('<meta name="google-site-verification" content="' +
      GSC.replace(/"/g, '&quot;') + '">');
  }
  if (GA4) {
    const id = GA4.replace(/[^A-Za-z0-9-]/g, '');
    // L'ordre compte. Le refus par défaut est déclaré avant que la balise
    // Google ne soit chargée : sans cela, elle dépose son cookie pendant que
    // le visiteur lit encore le bandeau, et le consentement ne veut plus
    // rien dire.
    l.push('<script>window.dataLayer=window.dataLayer||[];' +
      'function gtag(){dataLayer.push(arguments)}' +
      'gtag(\'consent\',\'default\',{ad_storage:"denied",ad_user_data:"denied",' +
      'ad_personalization:"denied",analytics_storage:"denied"});' +
      'try{if(localStorage.getItem("anas-mesure")==="oui")' +
      'gtag(\'consent\',\'update\',{analytics_storage:"granted"})}catch(e){}' +
      'gtag(\'js\',new Date());gtag(\'config\',\'' + id + '\',{anonymize_ip:true});</script>');
    l.push('<script async src="https://www.googletagmanager.com/gtag/js?id=' + id + '"></script>');
    l.push('<script src="assets/js/consentement.js" defer></script>');
  }
  l.push(FIN);
  return l.join('\n');
}

/* --------------------------------------------------------------------------
   La politique de confidentialité suit la configuration
   -------------------------------------------------------------------------- */

const POLITIQUE = 'politique-de-confidentialite.html';
const T_DEBUT = '<!-- traceurs:debut -->';
const T_FIN = '<!-- traceurs:fin -->';

const SANS_TRACEUR =
'      <p><strong>Ce site ne dépose aucun cookie.</strong> Il n’utilise ni mesure d’audience (Google Analytics\n' +
'        ou équivalent), ni pixel publicitaire, ni bouton de partage social, ni police d’écriture chargée\n' +
'        depuis un serveur tiers. Aucune bannière de consentement n’est donc nécessaire.</p>';

const AVEC_GA4 =
'      <p>Ce site utilise <strong>Google Analytics</strong> (Google Ireland Limited) pour mesurer sa\n' +
'        fréquentation&nbsp;: nombre de visiteurs, pages consultées, origine des visites. Cet outil dépose\n' +
'        des cookies sur votre appareil.</p>\n' +
'      <p><strong>Rien n’est déposé tant que vous n’avez pas accepté.</strong> À votre première visite, un\n' +
'        bandeau vous demande votre choix&nbsp;; refuser est aussi simple qu’accepter, et le refus est\n' +
'        conservé. Tant que vous n’avez pas répondu, ou si vous refusez, aucun cookie de mesure n’est écrit.</p>\n' +
'      <p>Vous pouvez revenir sur votre choix à tout moment&nbsp;: le lien <em>Cookies</em> en bas de chaque\n' +
'        page rouvre le bandeau.</p>\n' +
'      <p>L’adresse IP est anonymisée avant traitement. Les données sont conservées 14&nbsp;mois. Base légale&nbsp;:\n' +
'        votre consentement (article&nbsp;6.1.a du RGPD et article&nbsp;82 de la loi « Informatique et Libertés »).\n' +
'        Nous n’utilisons ni la publicité personnalisée, ni le partage de données publicitaires.</p>';

function politique() {
  if (!fs.existsSync(path.join(RACINE, POLITIQUE))) return false;
  const abs = path.join(RACINE, POLITIQUE);
  const avant = fs.readFileSync(abs, 'utf8');
  const i = avant.indexOf(T_DEBUT);
  const j = avant.indexOf(T_FIN);
  if (i === -1 || j === -1) {
    console.warn('[mesure] ⚠ repères « traceurs » absents de ' + POLITIQUE +
      ' : la page n’a pas pu être mise en accord avec la configuration.');
    return false;
  }
  const apres = avant.slice(0, i + T_DEBUT.length) + '\n' +
    (GA4 ? AVEC_GA4 : SANS_TRACEUR) + '\n' + avant.slice(j);
  if (apres === avant) return false;
  fs.writeFileSync(abs, apres);
  return true;
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

  const legale = politique();

  const quoi = [GSC && 'Search Console', GA4 && 'Analytics ' + GA4]
    .filter(Boolean).join(' + ') || 'rien (aucune variable posée)';
  console.log('[mesure] ' + quoi + ' — ' + touchees + ' page(s) modifiée(s)' +
    (legale ? ', politique de confidentialité mise en accord' : '') + '.');

  if (GA4) {
    console.log('[mesure] bandeau de consentement actif : rien n’est déposé ' +
      'avant acceptation, et le lien « Cookies » du pied de page rouvre le choix.');
  }
}

try {
  main();
} catch (e) {
  console.warn('[mesure] interrompu sans dommage :', e.message);
}
