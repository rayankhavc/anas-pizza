/* ==========================================================================
   Calcul du prix d'un panier — côté serveur uniquement.
   --------------------------------------------------------------------------
   Règle unique et non négociable : le navigateur n'envoie que des
   identifiants et des quantités. Aucun montant venu du client n'est lu.
   Tout prix est relu dans assets/data/carte.json, qui fait foi.

   Sans cela, n'importe qui ouvre les outils de développement, remplace
   1090 par 1, et paie sa pizza un centime. C'est la faute la plus banale
   d'une boutique en ligne, et la plus coûteuse.

   Les montants sont des entiers en centimes du début à la fin : aucun
   flottant ne touche un prix. Ce fichier ignore qui encaisse — SumUp,
   Stripe ou personne : il calcule, api/_paiement.js encaisse.
   ========================================================================== */
'use strict';

// require plutôt que readFileSync : le catalogue est ainsi tracé comme une
// dépendance et embarqué dans le paquet de la fonction serverless. Lu sur
// disque à l'exécution, il serait absent en production.
const CARTE = require('../assets/data/carte.json');

const MAX_QTE = 20;          // par ligne
const MAX_LIGNES = 40;       // par commande
const MAX_SUPP = 8;          // par pizza

function carte() { return CARTE; }

class Refus extends Error {
  constructor(message, champ) {
    super(message);
    this.champ = champ || null;
    this.refus = true;
  }
}

function trouverPlat(id) {
  for (const cat of carte().categories) {
    const p = cat.plats.find((x) => x.id === id);
    if (p) return { plat: p, categorie: cat };
  }
  return null;
}

/**
 * Jour de service à Paris, en tenant compte de la nuit.
 * Le restaurant sert de 11h30 à 2h du matin : une commande passée le mercredi
 * à 1h appartient encore au service du mardi, donc à l'offre du mardi.
 * @returns {number} 0 = dimanche … 6 = samedi
 */
function jourDeService(quand, finService) {
  const d = quand || new Date();
  let jour, heure;
  try {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', hour12: false
    }).formatToParts(d);
    const m = {};
    p.forEach((x) => { m[x.type] = x.value; });
    jour = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[m.weekday];
    heure = parseInt(m.hour, 10) % 24;
  } catch (e) {
    jour = d.getDay();
    heure = d.getHours();
  }
  return heure < (finService || 0) ? (jour + 6) % 7 : jour;
}

/** Minutes écoulées depuis minuit à Paris. */
function minutesParis(quand) {
  const d = quand || new Date();
  try {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d);
    const m = {};
    p.forEach((x) => { m[x.type] = x.value; });
    return (parseInt(m.hour, 10) % 24) * 60 + parseInt(m.minute, 10);
  } catch (e) {
    return d.getHours() * 60 + d.getMinutes();
  }
}

function enMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * La livraison est-elle ouverte à cet instant ?
 *
 * Le restaurant sert jusqu'à 2h du matin mais ne livre que jusqu'à minuit :
 * les deux horaires ne se confondent pas. Une fenêtre qui franchit minuit
 * (11h30 → 2h, si le restaurant changeait d'avis) est gérée aussi, d'où le
 * second test sur la journée suivante.
 */
function livraisonOuverte(quand) {
  const s = (carte().livraison || {}).service;
  if (!s || !s.debut || !s.fin) return true;   // pas de créneau défini : toujours ouvert

  const debut = enMinutes(s.debut);
  let fin = enMinutes(s.fin);
  if (fin <= debut) fin += 24 * 60;            // « 00:00 » veut dire minuit du lendemain

  const m = minutesParis(quand);
  return (m >= debut && m < fin) || (m + 24 * 60 >= debut && m + 24 * 60 < fin);
}

/** L'offre applicable à cet instant, ou null. */
function offreDuMoment(quand) {
  const offres = carte().offres || [];
  for (const o of offres) {
    if (jourDeService(quand, o.finService) === o.jour) return o;
  }
  return null;
}

function entier(v, nom) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Refus(nom + ' invalide');
  return n;
}

/**
 * Recalcule intégralement un panier.
 * @param {Array} lignes  [{ plat, taille?, quantite, supplements: [{groupe, choix}] }]
 * @param {String} mode   'livraison' | 'emporter'
 * @returns {{lignes:Array, sousTotal:number, frais:number, total:number}}
 */
function calculer(lignes, mode, quand) {
  if (!Array.isArray(lignes) || lignes.length === 0) {
    throw new Refus('Le panier est vide.', 'panier');
  }
  if (lignes.length > MAX_LIGNES) {
    throw new Refus('Trop d’articles différents. Appelez-nous pour une grosse commande.', 'panier');
  }
  if (mode !== 'livraison' && mode !== 'emporter') {
    throw new Refus('Mode de retrait inconnu.', 'mode');
  }
  if (mode === 'livraison' && !livraisonOuverte(quand)) {
    const s = carte().livraison.service;
    throw new Refus(
      'La livraison s’arrête à ' + s.fin.replace(':', 'h').replace('00h00', 'minuit') +
      '. La commande à emporter reste possible.', 'mode');
  }

  const detail = [];
  let sousTotal = 0;
  const offre = offreDuMoment(quand);

  for (const l of lignes) {
    const found = trouverPlat(String(l.plat || ''));
    if (!found) throw new Refus('Produit inconnu : ' + l.plat, 'panier');
    const { plat, categorie } = found;

    const quantite = entier(l.quantite, 'Quantité');
    if (quantite < 1 || quantite > MAX_QTE) {
      throw new Refus('Quantité invalide pour ' + plat.nom + '.', 'panier');
    }

    // prix de base : celui de la taille choisie, ou le prix unitaire
    let unitaire;
    let taille = null;
    let remise = null;
    if (categorie.type === 'pizza') {
      taille = categorie.tailles.find((t) => t.id === String(l.taille || ''));
      if (!taille) throw new Refus('Choisissez une taille pour ' + plat.nom + '.', 'panier');
      unitaire = taille.prix;
      // Offre du jour : elle ne s'applique qu'à la taille visée, et seulement
      // si elle abaisse réellement le prix. Elle porte sur la pizza seule,
      // jamais sur les suppléments, qui restent facturés au tarif normal.
      if (offre && (!offre.taille || offre.taille === taille.id) && offre.prix < unitaire) {
        remise = { nom: offre.nom, avant: unitaire, apres: offre.prix };
        unitaire = offre.prix;
      }
    } else {
      unitaire = plat.prix;
      if (l.taille) throw new Refus(plat.nom + ' n’a pas de taille.', 'panier');
    }

    // suppléments : seulement sur les pizzas, et seulement ceux de la carte
    const supps = Array.isArray(l.supplements) ? l.supplements : [];
    if (supps.length && categorie.type !== 'pizza') {
      throw new Refus('Pas de supplément sur ' + plat.nom + '.', 'panier');
    }
    if (supps.length > MAX_SUPP) {
      throw new Refus('Maximum ' + MAX_SUPP + ' suppléments par pizza.', 'panier');
    }

    const detailSupps = [];
    const vus = new Set();
    for (const s of supps) {
      const groupe = carte().supplements.find((g) => g.id === String(s.groupe || ''));
      if (!groupe) throw new Refus('Supplément inconnu.', 'panier');
      const choix = groupe.choix.find((c) => c.id === String(s.choix || ''));
      if (!choix) throw new Refus('Supplément inconnu : ' + s.choix, 'panier');
      const cle = groupe.id + '/' + choix.id;
      if (vus.has(cle)) throw new Refus('Supplément en double : ' + choix.nom, 'panier');
      vus.add(cle);
      unitaire += groupe.prix;
      detailSupps.push({ groupe: groupe.id, choix: choix.id, nom: choix.nom, prix: groupe.prix });
    }

    const total = unitaire * quantite;
    sousTotal += total;
    detail.push({
      plat: plat.id,
      nom: plat.nom,
      categorie: categorie.id,
      taille: taille ? taille.id : null,
      tailleNom: taille ? taille.nom : null,
      remise,
      supplements: detailSupps,
      quantite,
      unitaire,
      total
    });
  }

  const liv = carte().livraison;
  if (mode === 'livraison' && sousTotal < liv.minimum) {
    throw new Refus(
      'Minimum ' + euros(liv.minimum) + ' pour la livraison — il manque ' +
      euros(liv.minimum - sousTotal) + '.', 'panier');
  }

  const frais = mode === 'livraison' ? liv.frais : 0;
  const economie = detail.reduce(
    (s, l) => s + (l.remise ? (l.remise.avant - l.remise.apres) * l.quantite : 0), 0);
  return {
    lignes: detail, sousTotal, frais, total: sousTotal + frais,
    offre: economie ? { nom: offre.nom, economie } : null
  };
}

/** Vérifie l'adresse de livraison. Retourne la commune reconnue. */
function verifierAdresse(a) {
  if (!a || typeof a !== 'object') throw new Refus('Adresse manquante.', 'adresse');

  const nom = String(a.nom || '').trim();
  if (nom.length < 2 || nom.length > 80) throw new Refus('Indiquez votre nom.', 'nom');

  // 10 chiffres commençant par 0, espaces et séparateurs tolérés à la saisie
  const tel = String(a.telephone || '').replace(/[\s.\-()]/g, '');
  if (!/^0[1-9]\d{8}$/.test(tel)) {
    throw new Refus('Numéro de téléphone invalide (10 chiffres).', 'telephone');
  }

  const rue = String(a.rue || '').trim();
  if (rue.length < 5 || rue.length > 120) throw new Refus('Indiquez votre adresse.', 'rue');

  const cp = String(a.codePostal || '').trim();
  const communes = carte().livraison.communes.filter((c) => c.cp === cp);
  if (!communes.length) {
    throw new Refus('Nous ne livrons pas encore le ' + (cp || '?') +
      '. Commande à emporter possible.', 'codePostal');
  }

  return {
    nom,
    telephone: tel,
    rue,
    codePostal: cp,
    ville: communes[0].nom,
    complement: String(a.complement || '').trim().slice(0, 120),
    commentaire: String(a.commentaire || '').trim().slice(0, 300)
  };
}

const euros = (c) => (c / 100).toFixed(2).replace('.', ',') + '\u00A0€';

/** Libellé lisible d'une ligne, pour le paiement, la cuisine et le client. */
function libelle(l) {
  let s = l.nom;
  if (l.tailleNom) s += ' — ' + l.tailleNom;
  if (l.supplements.length) s += ' + ' + l.supplements.map((x) => x.nom).join(', ');
  return s;
}

module.exports = { calculer, verifierAdresse, carte, euros, libelle, Refus,
  offreDuMoment, jourDeService, livraisonOuverte };
