/* ==========================================================================
   Le garde — ce qui ralentit celui qui essaie les codes un par un.
   --------------------------------------------------------------------------
   Deux écrans sont protégés par un code partagé : l'espace de gestion et
   l'écran cuisine. Les deux champs de saisie sont numériques, donc les codes
   le sont aussi en pratique. Un code à six chiffres, c'est un million de
   possibilités : sans rien pour l'en empêcher, une machine les épuise en
   quelques minutes, et le serveur répond aussi vite qu'on l'interroge.

   Ce que ça coûterait : l'écran cuisine donne les nom, téléphone et adresse
   de tous les clients du service ; l'espace de gestion donne les prix, la
   fermeture de la boutique, et le jeton d'écriture sur le dépôt.

   ── Ce que ce garde fait, et ce qu'il ne fait pas ─────────────────────────
   Il compte les échecs par adresse IP, en mémoire. Une fonction sans serveur
   ne garde pas cette mémoire éternellement — l'hébergeur éteint les instances
   inactives et en démarre d'autres sous la charge — donc le compte peut se
   remettre à zéro, et un attaquant réparti sur mille adresses passera à
   travers. C'est assumé : la seule parade complète serait une base de plus,
   et ce site n'en a pas, volontairement.

   Ce qu'il garantit vraiment est ailleurs, et suffit à ce qu'on défend :

   - chaque échec coûte une seconde pleine, quoi qu'il arrive. Un million de
     tentatives depuis une seule adresse ne tient plus dans une soirée ;
   - au-delà de dix échecs, l'adresse est refusée sans même comparer le code,
     pour un temps qui double à chaque récidive ;
   - un compteur global attrape ce que le compteur par adresse laisse passer :
     au-delà de deux cents échecs toutes adresses confondues sur dix minutes,
     tout le monde attend. Un restaurant, ça fait deux ou trois saisies de
     code par soir — deux cents échecs ne sont jamais une maladresse.

   Le gérant qui se trompe deux fois ne voit rien de tout cela. C'est le but :
   la gêne est pour celui qui insiste.
   ========================================================================== */
'use strict';

const FENETRE = 10 * 60 * 1000;   // dix minutes de mémoire
const SEUIL_IP = 10;              // échecs tolérés par adresse
const SEUIL_GLOBAL = 200;         // échecs tolérés toutes adresses confondues
const ATTENTE_ECHEC = 1000;       // le prix d'un essai raté, en millisecondes
const BLOCAGE_BASE = 30 * 1000;   // premier blocage, doublé à chaque récidive
const BLOCAGE_MAX = 30 * 60 * 1000;

/* Une seule table pour tout le module. Elle est purgée à l'écriture plutôt
   qu'au minuteur : un minuteur garde l'instance éveillée pour rien. */
const parIp = new Map();
let global = { echecs: 0, depuis: Date.now() };

function maintenant() { return Date.now(); }

function purger(t) {
  for (const [ip, e] of parIp) {
    // On garde une entrée tant qu'elle bloque encore, même expirée.
    if (t - e.dernier > FENETRE && t > (e.bloqueJusqua || 0)) parIp.delete(ip);
  }
  if (t - global.depuis > FENETRE) global = { echecs: 0, depuis: t };
}

/**
 * L'adresse du demandeur.
 *
 * Derrière l'hébergeur, l'adresse réelle est dans x-forwarded-for, dont le
 * PREMIER élément est celui du client. On ne prend pas le dernier : il est
 * ajouté par le proxy et serait identique pour tout le monde.
 */
function adresse(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'inconnue';
}

function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Cette adresse a-t-elle le droit d'essayer un code maintenant ?
 * @returns {{ok:true}|{ok:false, attente:number}} attente en secondes
 */
function autorise(req) {
  const t = maintenant();
  purger(t);

  const e = parIp.get(adresse(req));
  if (e && e.bloqueJusqua && t < e.bloqueJusqua) {
    return { ok: false, attente: Math.ceil((e.bloqueJusqua - t) / 1000) };
  }
  if (global.echecs >= SEUIL_GLOBAL) {
    return { ok: false, attente: Math.ceil((global.depuis + FENETRE - t) / 1000) };
  }
  return { ok: true };
}

/**
 * Un code refusé. Toujours suivi d'une attente, même sous le seuil : c'est
 * elle qui rend l'énumération impraticable, le blocage ne fait que finir le
 * travail.
 */
async function echec(req) {
  const t = maintenant();
  const ip = adresse(req);
  const e = parIp.get(ip) || { echecs: 0, dernier: t, blocages: 0, bloqueJusqua: 0 };

  e.echecs += 1;
  e.dernier = t;
  global.echecs += 1;

  if (e.echecs >= SEUIL_IP) {
    e.blocages += 1;
    e.bloqueJusqua = t + Math.min(BLOCAGE_BASE * 2 ** (e.blocages - 1), BLOCAGE_MAX);
    e.echecs = 0;   // le compteur repart ; c'est le blocage qui s'allonge
    console.warn('[garde] ' + ip + ' bloquée ' +
      Math.round((e.bloqueJusqua - t) / 1000) + 's après ' + e.blocages + ' série(s).');
  }

  parIp.set(ip, e);
  await attendre(ATTENTE_ECHEC);
}

/** Un code accepté : l'adresse repart à zéro, mais le blocage en cours tient. */
function succes(req) {
  const e = parIp.get(adresse(req));
  if (e) { e.echecs = 0; }
}

/**
 * Un code trop court est un code qu'aucun garde ne sauve.
 *
 * On ne refuse pas de démarrer — fermer la boutique un vendredi soir parce
 * que le code fait quatre chiffres serait pire que le risque — mais on le dit
 * dans les journaux, à chaque démarrage à froid, jusqu'à ce que ce soit
 * corrigé.
 */
function verifierForce(nom, code) {
  const c = String(code || '');
  if (!c) return;
  if (c.length < 6) {
    console.warn('[garde] ' + nom + ' ne fait que ' + c.length + ' caractères. ' +
      'Six chiffres au minimum, huit de préférence : en dessous, ' +
      'l’énumération reste possible malgré le ralentissement.');
  }
}

module.exports = { autorise, echec, succes, adresse, verifierForce };
