/* ==========================================================================
   Le pilotage du restaurant — ce que le gérant peut changer sans nous.
   --------------------------------------------------------------------------
   Un site statique n'a pas de base de données, et c'est voulu : une base de
   plus serait une base à sauvegarder, à sécuriser et à payer. Mais un
   restaurant a besoin de changer trois choses à toute heure — « je n'ai plus
   de saumon », « je ferme ce soir », « la large passe à 16,90 » — et ces
   trois choses ne peuvent pas attendre qu'on ouvre un éditeur de code.

   Le magasin retenu est le dépôt lui-même. Un seul fichier JSON,
   assets/data/pilotage.json, écrit par l'API de GitHub. Ce choix a trois
   qualités qu'aucune base ne donne gratuitement :
   - il est versionné : chaque changement de prix a un auteur et une date,
     et se défait en un clic si le gérant s'est trompé ;
   - il est déjà sauvegardé, sur toutes les machines qui ont cloné le dépôt ;
   - il ne coûte rien et ne tombe pas en panne séparément du site.

   La lecture ne passe pas par le fichier déployé mais par l'API de GitHub,
   avec un cache de quinze secondes. La différence est celle-ci : le fichier
   déployé n'existe qu'après un redéploiement, soit une bonne minute. Un plat
   en rupture doit disparaître de la carte en quelques secondes, pas à la fin
   d'un déploiement. Si GitHub ne répond pas, on retombe sur le fichier
   déployé, puis sur des valeurs neutres — le site prend les commandes dans
   tous les cas.
   ========================================================================== */
'use strict';

const CACHE_MS = 15000;

/* Le fichier embarqué au déploiement : filet de sécurité si GitHub est
   injoignable. require() plutôt que readFileSync pour qu'il soit tracé comme
   une dépendance et embarqué dans le paquet de la fonction. */
let EMBARQUE = null;
try {
  EMBARQUE = require('../assets/data/pilotage.json');
} catch (e) { /* pas encore de pilotage : les valeurs neutres suffisent */ }

const NEUTRE = {
  service: { ouvert: true, motif: '' },
  ruptures: [],
  prix: {},
  livraison: {},
  maj: null,
  par: null
};

/** Un pilotage complet, quelles que soient les clés manquantes à la source. */
function normaliser(brut) {
  const p = (brut && typeof brut === 'object') ? brut : {};
  const s = (p.service && typeof p.service === 'object') ? p.service : {};
  return {
    service: {
      ouvert: s.ouvert !== false,
      motif: String(s.motif || '').slice(0, 160)
    },
    ruptures: Array.isArray(p.ruptures) ? p.ruptures.map(String) : [],
    prix: (p.prix && typeof p.prix === 'object') ? p.prix : {},
    livraison: (p.livraison && typeof p.livraison === 'object') ? p.livraison : {},
    maj: p.maj || null,
    par: p.par || null
  };
}

/* --------------------------------------------------------------------------
   Accès à GitHub
   -------------------------------------------------------------------------- */

// Lu à l'appel, jamais au chargement du module : une variable d'environnement
// lue à l'import fige la valeur d'avant, et l'ordre des require() décide alors
// du comportement. On s'est déjà fait prendre une fois.
function reglagesGit() {
  const jeton = process.env.GITHUB_TOKEN || '';
  const depot = process.env.GITHUB_DEPOT || '';
  if (!jeton || !/^[\w.-]+\/[\w.-]+$/.test(depot)) return null;
  return {
    jeton,
    depot,
    branche: process.env.GITHUB_BRANCHE || 'main',
    base: process.env.GITHUB_API_BASE || 'https://api.github.com'
  };
}

/** Le pilotage peut-il être modifié ? Sinon l'espace admin reste en lecture. */
function ecritureDisponible() { return reglagesGit() !== null; }

function enTetes(g) {
  return {
    Authorization: 'Bearer ' + g.jeton,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'anas-pizza'
  };
}

/**
 * Lit un fichier du dépôt.
 * @returns {{contenu: Buffer, sha: string}|null} null si le fichier n'existe pas
 */
async function lireFichier(chemin) {
  const g = reglagesGit();
  if (!g) throw new Error('GITHUB_TOKEN ou GITHUB_DEPOT absent');

  const url = g.base + '/repos/' + g.depot + '/contents/' + chemin +
    '?ref=' + encodeURIComponent(g.branche);
  const r = await fetch(url, { headers: enTetes(g) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub ' + r.status + ' à la lecture de ' + chemin);

  const d = await r.json();
  return { contenu: Buffer.from(d.content || '', 'base64'), sha: d.sha };
}

/**
 * Écrit un fichier dans le dépôt. Le sha attendu évite d'écraser une
 * modification faite entre-temps : GitHub refuse alors avec un 409, et
 * l'appelant relit avant de réessayer.
 */
async function ecrireFichier(chemin, contenu, message, sha) {
  const g = reglagesGit();
  if (!g) throw new Error('GITHUB_TOKEN ou GITHUB_DEPOT absent');

  const corps = {
    message,
    content: Buffer.from(contenu).toString('base64'),
    branch: g.branche
  };
  if (sha) corps.sha = sha;

  const r = await fetch(g.base + '/repos/' + g.depot + '/contents/' + chemin, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, enTetes(g)),
    body: JSON.stringify(corps)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    // 409 : quelqu'un a écrit entre notre lecture et notre écriture. Ce n'est
    // pas une panne, c'est le garde-fou qui joue son rôle — et le gérant a
    // besoin d'un message qu'il peut suivre, pas d'un code HTTP.
    const e = new Error(r.status === 409
      ? 'Quelqu’un d’autre vient de modifier au même moment. Rien n’a été perdu : ' +
        'retouchez et réessayez.'
      : 'GitHub ' + r.status + ' à l’écriture de ' + chemin + ' — ' + txt.slice(0, 200));
    if (r.status === 409) e.conflit = true;
    throw e;
  }
  return r.json();
}

/* --------------------------------------------------------------------------
   Lecture du pilotage, avec cache
   -------------------------------------------------------------------------- */

const CHEMIN = 'assets/data/pilotage.json';
let cache = { valeur: null, sha: null, jusqua: 0 };

/**
 * L'état de pilotage courant.
 * @param {boolean} frais  ignorer le cache (après une écriture)
 */
async function lire(frais) {
  const maintenant = Date.now();
  if (!frais && cache.valeur && maintenant < cache.jusqua) return cache.valeur;

  if (ecritureDisponible()) {
    try {
      const f = await lireFichier(CHEMIN);
      const valeur = normaliser(f ? JSON.parse(f.contenu.toString('utf8')) : null);
      cache = { valeur, sha: f ? f.sha : null, jusqua: maintenant + CACHE_MS };
      return valeur;
    } catch (e) {
      // Une panne de GitHub ne doit pas fermer la boutique : on sert la
      // dernière valeur connue, sinon celle du déploiement.
      console.warn('[pilotage] lecture GitHub impossible : ' + e.message);
      if (cache.valeur) return cache.valeur;
    }
  }
  return normaliser(EMBARQUE || NEUTRE);
}

/**
 * L'état courant et son sha, lus d'un seul coup.
 *
 * Deux lectures séparées — le contenu d'un côté, le sha de l'autre — ouvrent
 * une fenêtre entre les deux : une écriture qui s'y glisse fait fusionner un
 * contenu périmé. Ici, le contenu et le sha viennent de la même réponse, donc
 * du même instant. Si quelqu'un écrit ensuite, le sha ne correspond plus et
 * GitHub refuse en 409 — ce qui est le bon échec.
 */
async function lireAvecSha() {
  const f = await lireFichier(CHEMIN);
  return {
    valeur: normaliser(f ? JSON.parse(f.contenu.toString('utf8')) : null),
    sha: f ? f.sha : null
  };
}

/**
 * Applique une modification et la publie.
 * @param {Function} muter  reçoit le pilotage courant, renvoie le nouveau
 * @param {String} qui      « gérant » ou « propriétaire », pour l'historique
 * @param {String} quoi     résumé lisible, il devient le message de commit
 */
async function ecrire(muter, qui, quoi) {
  if (!ecritureDisponible()) {
    throw Object.assign(new Error(
      'Publication non configurée : il manque GITHUB_TOKEN et GITHUB_DEPOT.'),
      { configuration: true });
  }

  // On relit juste avant d'écrire : deux téléphones ouverts sur l'espace
  // admin, c'est le cas normal dans un restaurant, pas l'exception.
  const { valeur: courant, sha } = await lireAvecSha();
  const neuf = normaliser(muter(JSON.parse(JSON.stringify(courant))));
  neuf.maj = new Date().toISOString();
  neuf.par = qui;

  /* « [skip ci] » n'est pas un détail de confort. Sans lui, déclarer six
     ruptures un samedi soir déclencherait six déploiements — pour un fichier
     que personne ne lit au déploiement, puisqu'il est relu par l'API. On
     brûlerait le quota de déploiements de l'hébergeur pour rien, et chaque
     changement mettrait une minute au lieu de quinze secondes.
     Les photos, elles, ont besoin du déploiement : elles ne passent pas par
     ici (voir api/admin.js). */
  await ecrireFichier(CHEMIN, JSON.stringify(neuf, null, 2) + '\n',
    'Pilotage : ' + quoi + ' (' + qui + ') [skip ci]', sha);

  cache = { valeur: neuf, sha: null, jusqua: Date.now() + CACHE_MS };
  return neuf;
}

/* --------------------------------------------------------------------------
   Application du pilotage à la carte
   -------------------------------------------------------------------------- */

/* Les clés de prix suivent la carte, pas l'intuition. Une pizza n'a pas de
   prix à elle : toutes les pizzas d'une même famille valent le même prix,
   par taille — douze prix couvrent les quarante-deux pizzas. Les entrées,
   desserts et boissons, eux, ont chacun le leur, et les suppléments sont
   facturés par groupe. D'où trois familles de clés plutôt qu'une. */
const cleTaille = (categorieId, tailleId) => 'cat:' + categorieId + ':' + tailleId;
const clePlat = (platId) => 'plat:' + platId;
const cleSupp = (groupeId) => 'supp:' + groupeId;

/**
 * Le prix piloté correspondant à une clé.
 * @returns {number|null} null si aucune modification ne s'applique
 */
function prixPilote(pilotage, cle) {
  if (!pilotage || !pilotage.prix) return null;
  const v = pilotage.prix[cle];
  return Number.isInteger(v) && v > 0 ? v : null;
}

/** Ce plat est-il déclaré en rupture ? */
function enRupture(pilotage, platId) {
  return !!(pilotage && pilotage.ruptures && pilotage.ruptures.indexOf(platId) !== -1);
}

/** Les conditions de livraison, override compris. */
function livraisonPilotee(pilotage, base) {
  const l = (pilotage && pilotage.livraison) || {};
  return {
    minimum: Number.isInteger(l.minimum) && l.minimum >= 0 ? l.minimum : base.minimum,
    frais: Number.isInteger(l.frais) && l.frais >= 0 ? l.frais : base.frais
  };
}

module.exports = {
  lire, ecrire, ecritureDisponible, normaliser,
  lireFichier, ecrireFichier, lireAvecSha,
  cleTaille, clePlat, cleSupp, prixPilote, enRupture, livraisonPilotee,
  CHEMIN
};
