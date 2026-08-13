/* ==========================================================================
   /api/admin — l'espace de gestion du restaurant.
   --------------------------------------------------------------------------
   Deux profils, un seul code chacun :

   - le PROPRIÉTAIRE du site (ADMIN_CODE) peut tout ;
   - le GÉRANT du restaurant (ADMIN_CODE_GERANT) tient la boutique au
     quotidien : ouvrir, fermer, déclarer une rupture, voir la recette.

   Les deux profils peuvent tout, y compris les prix, la livraison et les
   photos. La bride qui existait sur le gérant a été levée : elle protégeait
   le prestataire, pas le restaurant, et le vrai levier n'a jamais été là —
   c'est le propriétaire qui détient les codes, qui peut les changer et qui
   peut fermer la boutique en un appui.

   Le garde-fou utile est ailleurs, et il tient tout seul : chaque
   modification est un commit signé dans le dépôt, avec son auteur, sa date
   et son avant/après. Un prix cassé se retrouve et se défait en regardant
   l'historique — ce qu'aucun panneau de contrôle classique ne donne.

   ADMIN_EDITION=0 remet la bride si le besoin revient : le gérant retombe
   alors sur l'exploitation seule — ouvrir, fermer, déclarer une rupture,
   lire le chiffre du jour.

   Aucun compte, aucun mot de passe stocké : deux codes partagés, comparés à
   durée constante. Pour un espace que deux personnes ouvrent, un système de
   comptes coûterait plus cher à maintenir qu'il ne protégerait.
   ========================================================================== */
'use strict';

const {
  lire, ecrire, ecritureDisponible, ecrireFichier,
  cleTaille, clePlat, cleSupp, prixPilote, enRupture, livraisonPilotee
} = require('./_pilotage');
const { carte, euros } = require('./_panier');
const { commandesPayees, prestataire } = require('./_paiement');
const { debutService } = require('./cuisine');

const MAX_CORPS = 6 * 1024 * 1024;   // une photo redimensionnée tient dedans

function json(res, code, corps) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corps));
}

// Comparaison à durée constante : une comparaison naïve laisse deviner le
// code caractère par caractère en mesurant le temps de réponse.
function memeCode(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Qui est au bout du fil, et à quoi a-t-il droit.
 * @returns {{profil:string, droits:Object}|null}
 */
function identifier(code) {
  const proprio = process.env.ADMIN_CODE || '';
  const gerant = process.env.ADMIN_CODE_GERANT || '';
  // Ouvert par défaut. ADMIN_EDITION=0 — et rien d'autre — referme.
  const edition = String(process.env.ADMIN_EDITION || '1') !== '0';

  if (proprio && memeCode(code, proprio)) {
    return {
      profil: 'proprietaire',
      titre: 'Propriétaire du site',
      droits: { service: true, ruptures: true, prix: true, livraison: true, photos: true }
    };
  }
  if (gerant && memeCode(code, gerant)) {
    return {
      profil: 'gerant',
      titre: 'Gérant du restaurant',
      droits: {
        service: true, ruptures: true,
        prix: edition, livraison: edition, photos: edition
      }
    };
  }
  return null;
}

async function lireCorps(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const morceaux = [];
  let taille = 0;
  for await (const c of req) {
    taille += c.length;
    if (taille > MAX_CORPS) throw new Error('corps trop volumineux');
    morceaux.push(c);
  }
  return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}');
}

/* --------------------------------------------------------------------------
   La carte telle qu'elle est réellement facturée
   -------------------------------------------------------------------------- */

/**
 * La carte enrichie du pilotage : prix effectif, prix d'origine, ruptures.
 * L'espace admin affiche les deux pour que le gérant voie ce qu'il a changé
 * et puisse revenir en arrière — un prix modifié sans repère est un prix
 * qu'on n'ose plus retoucher.
 */
function carteAdmin(pilotage) {
  const c = carte();
  return {
    categories: c.categories.map((cat) => ({
      id: cat.id,
      nom: cat.nom,
      type: cat.type,
      tailles: (cat.tailles || []).map((t) => ({
        cle: cleTaille(cat.id, t.id),
        nom: t.nom,
        origine: t.prix,
        prix: prixPilote(pilotage, cleTaille(cat.id, t.id)) || t.prix
      })),
      plats: cat.plats.map((p) => ({
        id: p.id,
        nom: p.nom,
        photo: p.photo || null,
        rupture: enRupture(pilotage, p.id),
        cle: cat.type === 'pizza' ? null : clePlat(p.id),
        origine: cat.type === 'pizza' ? null : p.prix,
        prix: cat.type === 'pizza' ? null : (prixPilote(pilotage, clePlat(p.id)) || p.prix)
      }))
    })),
    supplements: c.supplements.map((g) => ({
      id: g.id,
      nom: g.nom,
      cle: cleSupp(g.id),
      origine: g.prix,
      prix: prixPilote(pilotage, cleSupp(g.id)) || g.prix
    })),
    livraison: Object.assign({}, c.livraison, livraisonPilotee(pilotage, c.livraison))
  };
}

/** Le chiffre du service en cours, lu chez le prestataire de paiement. */
async function recetteDuJour() {
  if (!prestataire()) return { disponible: false };
  const depuis = debutService();
  try {
    const cmds = (await commandesPayees(depuis)).filter((c) => c.horodatage >= depuis);
    const encaisse = cmds.reduce((s, c) => s + (c.montant || 0), 0);
    return {
      disponible: true,
      commandes: cmds.length,
      livraisons: cmds.filter((c) => c.mode === 'livraison').length,
      total: euros(encaisse),
      depuis: new Date(depuis * 1000).toISOString()
    };
  } catch (e) {
    console.warn('[admin] recette indisponible : ' + e.message);
    return { disponible: false, erreur: 'Prestataire de paiement injoignable.' };
  }
}

/* --------------------------------------------------------------------------
   Actions
   -------------------------------------------------------------------------- */

class Refus extends Error {
  constructor(message, code) { super(message); this.code = code || 422; }
}

function centimes(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000) {
    throw new Refus('Prix invalide (entre 0 et 1 000 €).');
  }
  return n;
}

/** Le plat existe-t-il vraiment ? Un identifiant inventé ne doit rien créer. */
function platConnu(id) {
  return carte().categories.some((cat) => cat.plats.some((p) => p.id === id));
}

/** Une clé de prix connue de la carte, et rien d'autre. */
function cleConnue(cle) {
  const c = carte();
  for (const cat of c.categories) {
    for (const t of cat.tailles || []) if (cleTaille(cat.id, t.id) === cle) return true;
    if (cat.type !== 'pizza') {
      for (const p of cat.plats) if (clePlat(p.id) === cle) return true;
    }
  }
  return c.supplements.some((g) => cleSupp(g.id) === cle);
}

const ACTIONS = {
  /** Ouvrir ou fermer les commandes en ligne, quelle que soit l'heure. */
  service(corps, qui) {
    const ouvert = corps.ouvert !== false;
    const motif = String(corps.motif || '').trim().slice(0, 160);
    return {
      droit: 'service',
      resume: ouvert ? 'commandes rouvertes' : 'commandes suspendues',
      muter: (p) => { p.service = { ouvert, motif: ouvert ? '' : motif }; return p; }
    };
  },

  /** Déclarer un plat en rupture, ou le remettre à la carte. */
  rupture(corps) {
    const plat = String(corps.plat || '');
    if (!platConnu(plat)) throw new Refus('Plat inconnu : ' + plat);
    const rupture = corps.rupture !== false;
    return {
      droit: 'ruptures',
      resume: (rupture ? 'rupture ' : 'retour ') + plat,
      muter: (p) => {
        const s = new Set(p.ruptures);
        if (rupture) s.add(plat); else s.delete(plat);
        p.ruptures = Array.from(s).sort();
        return p;
      }
    };
  },

  /** Changer un prix, ou revenir au prix de la carte (prix absent). */
  prix(corps) {
    const cle = String(corps.cle || '');
    if (!cleConnue(cle)) throw new Refus('Prix inconnu : ' + cle);
    const remise = corps.prix === null || corps.prix === '' || corps.prix === undefined;
    const valeur = remise ? null : centimes(corps.prix);
    return {
      droit: 'prix',
      resume: remise ? 'prix d’origine ' + cle : cle + ' à ' + euros(valeur),
      muter: (p) => {
        if (remise) delete p.prix[cle]; else p.prix[cle] = valeur;
        return p;
      }
    };
  },

  /** Minimum de commande et frais de livraison. */
  livraison(corps) {
    const minimum = centimes(corps.minimum);
    const frais = centimes(corps.frais);
    return {
      droit: 'livraison',
      resume: 'livraison ' + euros(minimum) + ' min, ' + euros(frais) + ' de frais',
      muter: (p) => { p.livraison = { minimum, frais }; return p; }
    };
  }
};

/* --------------------------------------------------------------------------
   Photos — elles ne vivent pas dans le pilotage mais dans le dépôt
   -------------------------------------------------------------------------- */

/**
 * Remplacer la photo d'un plat.
 *
 * Le fichier part tel quel dans assets/img/plats/<plat>.jpg : c'est
 * exactement ce que fait un dépôt de photo à la main, et l'étape de
 * construction s'occupe du reste — redimensionnement, WebP, vignette. Rien
 * de neuf à maintenir. Le navigateur a déjà réduit l'image avant l'envoi :
 * une photo de téléphone brute pèse quatre mégaoctets et n'a aucune raison
 * de traverser le réseau à cette taille.
 *
 * Contrepartie assumée : la photo n'apparaît qu'après le redéploiement
 * déclenché par le commit, soit une à deux minutes. L'espace admin le dit.
 */
/* Les quatre photos du restaurant, celles qui ne sont pas des plats. Le nom
   du fichier fait tout le travail : build.js reconnaît ces quatre-là et les
   convertit à la bonne largeur. */
const SCENES = {
  hero: 'La photo du haut de la page d’accueil',
  devanture: 'La devanture, dans « La maison »',
  salle: 'La salle, dans « La maison »',
  pizza: 'Les pizzas, dans « La maison »'
};

async function changerPhoto(corps, qui) {
  const plat = String(corps.plat || '');
  const scene = Object.prototype.hasOwnProperty.call(SCENES, plat);
  if (!scene && !platConnu(plat)) throw new Refus('Photo inconnue : ' + plat);

  /* JPEG et rien d'autre, et ce n'est pas une paresse.
     L'étape de construction cherche « <nom>.<n'importe quelle extension> » et
     retient le premier trouvé. Déposer tikka.png à côté d'un tikka.jpg déjà
     là ne remplacerait donc rien : le .jpg gagnerait au tri, et la nouvelle
     photo serait ignorée sans un mot. En n'acceptant qu'une extension, le
     fichier est toujours écrasé, jamais doublé. Le navigateur réencode de
     toute façon en JPEG avant l'envoi. */
  const donnee = String(corps.image || '');
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(donnee);
  if (!m) throw new Refus('Image illisible (JPEG attendu).');

  const octets = Buffer.from(m[1], 'base64');
  if (octets.length > 3 * 1024 * 1024) throw new Refus('Photo trop lourde (3 Mo maximum).');
  if (octets.length < 1024) throw new Refus('Photo trop petite pour être valable.');

  // Les photos du restaurant vivent à la racine d'assets/img/, les plats dans
  // leur sous-dossier : c'est ce qui les distingue pour l'étape de
  // construction, qui ne les redimensionne pas à la même largeur.
  const chemin = scene
    ? 'assets/img/' + plat + '.jpg'
    : 'assets/img/plats/' + plat + '.jpg';

  // On écrase le fichier s'il existe : d'où la relecture de son sha. Sans
  // lui, GitHub refuse la mise à jour d'un fichier existant.
  const { lireFichier } = require('./_pilotage');
  let sha = null;
  try {
    const f = await lireFichier(chemin);
    sha = f ? f.sha : null;
  } catch (e) { /* le fichier n'existait pas : on le crée */ }

  await ecrireFichier(chemin, octets, 'Photo : ' + plat + ' (' + qui + ')', sha);
  return { chemin };
}

/* --------------------------------------------------------------------------
   Point d'entrée
   -------------------------------------------------------------------------- */

module.exports = async function handler(req, res) {
  if (!process.env.ADMIN_CODE && !process.env.ADMIN_CODE_GERANT) {
    return json(res, 503, {
      erreur: 'Espace de gestion non configuré (ADMIN_CODE absent).'
    });
  }

  const code = String(req.headers['x-admin-code'] || '');
  const moi = identifier(code);
  if (!moi) return json(res, 401, { erreur: 'Code incorrect.' });

  /* ── état complet ────────────────────────────────────────────────────── */
  if (req.method === 'GET') {
    const pilotage = await lire();
    const [recette] = await Promise.all([recetteDuJour()]);
    return json(res, 200, {
      profil: moi.profil,
      titre: moi.titre,
      droits: moi.droits,
      publication: ecritureDisponible(),
      pilotage,
      carte: carteAdmin(pilotage),
      scenes: Object.keys(SCENES).map((id) => ({ id, nom: SCENES[id] })),
      recette
    });
  }

  /* ── modification ────────────────────────────────────────────────────── */
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { erreur: 'Méthode non autorisée.' });
  }

  let corps;
  try {
    corps = await lireCorps(req);
  } catch (e) {
    return json(res, 400, { erreur: 'Requête illisible ou trop volumineuse.' });
  }

  const nom = String(corps.action || '');
  const qui = moi.profil === 'gerant' ? 'gérant' : 'propriétaire';

  try {
    if (nom === 'photo') {
      if (!moi.droits.photos) {
        return json(res, 403, { erreur: 'Les photos ne sont pas ouvertes à ce profil.' });
      }
      if (!ecritureDisponible()) {
        return json(res, 503, { erreur: 'Publication non configurée (GITHUB_TOKEN absent).' });
      }
      const r = await changerPhoto(corps, qui);
      return json(res, 200, {
        fait: true,
        differe: true,
        message: 'Photo envoyée. Elle apparaîtra en ligne dans une à deux minutes.',
        chemin: r.chemin
      });
    }

    const fabrique = ACTIONS[nom];
    if (!fabrique) return json(res, 400, { erreur: 'Action inconnue.' });

    const acte = fabrique(corps, qui);
    if (!moi.droits[acte.droit]) {
      return json(res, 403, {
        erreur: 'Cette partie n’est pas ouverte à ce profil.'
      });
    }

    const pilotage = await ecrire(acte.muter, qui, acte.resume);
    return json(res, 200, {
      fait: true,
      message: 'Enregistré.',
      pilotage,
      carte: carteAdmin(pilotage)
    });
  } catch (e) {
    if (e instanceof Refus) return json(res, e.code, { erreur: e.message });
    if (e.configuration) return json(res, 503, { erreur: e.message });
    // Écriture concurrente : l'écran se redessine sur l'état réel, et le
    // gérant refait son geste. Rien à consigner, ce n'est pas une panne.
    if (e.conflit) return json(res, 409, { erreur: e.message });
    console.error('[admin] ' + nom + ' : ' + e.message);
    return json(res, 502, { erreur: 'Enregistrement impossible : ' + e.message });
  }
};

module.exports.identifier = identifier;
module.exports.carteAdmin = carteAdmin;
