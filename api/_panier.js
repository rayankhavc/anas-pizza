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
   flottant ne touche un prix.
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
function calculer(lignes, mode) {
  if (!Array.isArray(lignes) || lignes.length === 0) {
    throw new Refus('Le panier est vide.', 'panier');
  }
  if (lignes.length > MAX_LIGNES) {
    throw new Refus('Trop d’articles différents. Appelez-nous pour une grosse commande.', 'panier');
  }
  if (mode !== 'livraison' && mode !== 'emporter') {
    throw new Refus('Mode de retrait inconnu.', 'mode');
  }

  const detail = [];
  let sousTotal = 0;

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
    if (categorie.type === 'pizza') {
      taille = categorie.tailles.find((t) => t.id === String(l.taille || ''));
      if (!taille) throw new Refus('Choisissez une taille pour ' + plat.nom + '.', 'panier');
      unitaire = taille.prix;
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
  return { lignes: detail, sousTotal, frais, total: sousTotal + frais };
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

const euros = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';

/** Libellé lisible d'une ligne, pour Stripe, la cuisine et le client. */
function libelle(l) {
  let s = l.nom;
  if (l.tailleNom) s += ' — ' + l.tailleNom;
  if (l.supplements.length) s += ' + ' + l.supplements.map((x) => x.nom).join(', ');
  return s;
}

module.exports = { calculer, verifierAdresse, carte, euros, libelle, Refus };
