/* ==========================================================================
   GET /api/cuisine — les commandes payées du service en cours.
   --------------------------------------------------------------------------
   Aucune base de données : le prestataire de paiement conserve déjà chaque
   commande, avec son ticket. On la relit directement. Une base de plus serait
   une base à sauvegarder, à sécuriser et à payer, pour stocker ce qui existe
   déjà ailleurs.

   Protection : un mot de passe partagé (CUISINE_CODE). C'est un écran de
   comptoir, pas un compte utilisateur — mais sans ce garde-fou, les nom,
   téléphone et adresse des clients seraient publics.
   ========================================================================== */
'use strict';

const { commandesPayees, prestataire } = require('./_paiement');
const garde = require('./_garde');

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

/* --------------------------------------------------------------------------
   L'heure de Paris, depuis un serveur qui n'y est pas
   --------------------------------------------------------------------------
   Les fonctions sans serveur tournent en UTC. Tout calcul d'horaire fait avec
   les méthodes locales de Date (setHours, getHours) porte donc sur UTC, pas
   sur Paris — deux heures d'écart l'été, une l'hiver.

   Le détour par toLocaleString('en-US', { timeZone: 'Europe/Paris' }) suivi
   d'un new Date() est le piège classique, et c'est celui dans lequel cette
   fonction était tombée : il rend les bons chiffres — « 12:52 » — mais
   new Date() les relit dans le fuseau du serveur. Le 11h00 posé ensuite
   devenait 11h00 UTC, soit 13h00 à Paris. Toute commande passée entre 11h et
   13h tombait avant le début de service et disparaissait de l'écran cuisine,
   sans le moindre message. Le soir n'était pas touché, ce qui a laissé le
   défaut passer inaperçu jusqu'à ce qu'un service du midi le révèle.

   On passe donc par le décalage réel de Paris à un instant donné, lu chez
   Intl, seul à connaître les règles d'heure d'été et leurs changements.
   -------------------------------------------------------------------------- */

const FUSEAU = 'Europe/Paris';

const CHAMPS = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSEAU, hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
});

/** Les composantes de l'heure murale parisienne à un instant donné. */
function murParis(instant) {
  const p = {};
  for (const m of CHAMPS.formatToParts(instant)) p[m.type] = m.value;
  return {
    annee: Number(p.year), mois: Number(p.month), jour: Number(p.day),
    // certaines versions d'ICU rendent « 24 » pour minuit
    heure: Number(p.hour) % 24, minute: Number(p.minute), seconde: Number(p.second)
  };
}

/** Le décalage de Paris sur UTC à cet instant, en millisecondes. */
function decalageParis(instant) {
  const m = murParis(instant);
  const commeSiUTC = Date.UTC(m.annee, m.mois - 1, m.jour, m.heure, m.minute, m.seconde);
  return commeSiUTC - instant.getTime();
}

/**
 * L'instant UTC correspondant à une heure murale parisienne.
 *
 * Le décalage dépend de l'instant qu'on cherche, pas de celui d'où l'on part :
 * on l'estime une fois, puis on le relit à la date obtenue. Deux passes
 * suffisent — 11h00 est loin des heures où bascule l'heure d'été (2h et 3h),
 * donc la seconde lecture est toujours la bonne.
 */
function instantParis(annee, mois, jour, heure) {
  const mural = Date.UTC(annee, mois - 1, jour, heure, 0, 0);
  const approx = mural - decalageParis(new Date(mural));
  return mural - decalageParis(new Date(approx));
}

/**
 * Début du service en cours, en secondes.
 *
 * Le restaurant sert de 11h30 à 2h du matin. Le service ouvre donc à 11h00
 * heure de Paris, avec une marge devant la première commande possible ; et
 * entre minuit et 3h, la nuit appartient encore au service de la veille.
 */
function debutService(maintenant) {
  const t = maintenant || new Date();
  const m = murParis(t);

  let { annee, mois, jour } = m;
  if (m.heure < 3) {
    // On recule d'un jour par le calendrier, pas en soustrayant 24 heures :
    // les jours de changement d'heure n'en font pas 24.
    const veille = new Date(Date.UTC(annee, mois - 1, jour) - 24 * 3600 * 1000);
    annee = veille.getUTCFullYear();
    mois = veille.getUTCMonth() + 1;
    jour = veille.getUTCDate();
  }

  return Math.floor(instantParis(annee, mois, jour, 11) / 1000);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { erreur: 'Méthode non autorisée.' });
  }

  const attendu = process.env.CUISINE_CODE;
  if (!attendu) {
    return json(res, 503, { erreur: 'Écran cuisine non configuré (CUISINE_CODE absent).' });
  }
  garde.verifierForce('CUISINE_CODE', attendu);

  const feu = garde.autorise(req);
  if (!feu.ok) {
    res.setHeader('Retry-After', String(feu.attente));
    return json(res, 429, {
      erreur: 'Trop de codes incorrects. Réessayez dans ' + feu.attente + ' secondes.'
    });
  }

  /* Le code ne se lit que dans l'en-tête.
     Il était aussi accepté en « ?code= », ce dont personne ne se servait : le
     client (assets/js/cuisine.js) a toujours envoyé l'en-tête. Une porte que
     personne n'emprunte mais qui recopie le code dans les journaux de
     l'hébergeur, l'historique du navigateur et l'en-tête Referer de chaque
     ressource chargée ensuite n'a que des inconvénients. */
  const fourni = req.headers['x-cuisine-code'] || '';
  if (!memeCode(String(fourni), attendu)) {
    await garde.echec(req);
    return json(res, 401, { erreur: 'Code incorrect.' });
  }
  garde.succes(req);

  if (!prestataire()) {
    return json(res, 200, { commandes: [], note: 'Paiement en ligne pas encore activé.' });
  }

  const depuis = debutService();
  try {
    const commandes = (await commandesPayees(depuis))
      .filter((c) => c.horodatage >= depuis)
      .sort((a, b) => b.horodatage - a.horodatage);
    return json(res, 200, { commandes, service: new Date(depuis * 1000).toISOString() });
  } catch (e) {
    console.error('[cuisine] ' + e.message);
    return json(res, 502, { erreur: 'Impossible de joindre le prestataire de paiement.' });
  }
};

module.exports.debutService = debutService;
