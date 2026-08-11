/* ==========================================================================
   Ouverture d'une page de paiement — SumUp ou Stripe.
   --------------------------------------------------------------------------
   Le restaurant encaisse déjà par SumUp en boutique. Utiliser le même compte
   en ligne évite de créer un second compte marchand, et fait tomber les
   recettes du site au même endroit que celles du comptoir : une seule
   réconciliation bancaire, un seul interlocuteur.

   Stripe reste branché derrière la même interface. Le choix se fait sur les
   variables d'environnement présentes, sans toucher au code :

     SUMUP_API_KEY + SUMUP_MERCHANT_CODE  → SumUp
     STRIPE_SECRET_KEY                    → Stripe
     aucune                               → renvoi vers le téléphone

   Ce fichier ne calcule aucun prix : il reçoit un total déjà vérifié par
   api/_panier.js et se contente d'ouvrir la page de paiement.
   ========================================================================== */
'use strict';

const { euros, libelle } = require('./_panier');

/**
 * L'adresse de l'API, lue à chaque appel et non au chargement du module.
 *
 * Elle est surchargeable pour que outils/test-sumup.js fasse tourner la
 * chaîne entière contre un faux SumUp. Figée à l'import, elle dépendait de
 * l'ordre des « require » : un module chargé avant que le test ait posé ses
 * variables partait taper sur la vraie API. Le piège se refermait en
 * silence, sur une erreur qui n'avait rien à voir.
 */
function baseSumUp() {
  return process.env.SUMUP_API_BASE || 'https://api.sumup.com/v0.1';
}

/** Quel prestataire est configuré ? */
function prestataire() {
  if (process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE) return 'sumup';
  if (process.env.STRIPE_SECRET_KEY) return 'stripe';
  return null;
}

/** Référence courte, lisible au téléphone : « A7F3-K2 ». */
function reference() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sans I, O, 0, 1 : dictés sans erreur
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s.slice(0, 4) + '-' + s.slice(4);
}

/**
 * Ticket compact transporté par le prestataire.
 * SumUp n'offre pas de champ de métadonnées libre comme Stripe : tout ce que
 * la cuisine doit lire tient dans la description. D'où ce format dense, et
 * la troncature défensive — un ticket coupé reste lisible, un appel refusé
 * pour dépassement ne l'est pas.
 */
function ticket(total, client, mode) {
  const articles = total.lignes
    .map((l) => l.quantite + '× ' + libelle(l))
    .join(' ; ');
  const bloc = [
    mode === 'livraison' ? 'LIVRAISON' : 'EMPORTER',
    articles,
    client.nom + ' ' + client.telephone,
    mode === 'livraison'
      ? [client.rue, client.complement, client.codePostal + ' ' + client.ville].filter(Boolean).join(' ')
      : 'Retrait sur place',
    client.commentaire ? 'NOTE : ' + client.commentaire : ''
  ].filter(Boolean).join(' | ');
  return bloc.length > 380 ? bloc.slice(0, 377) + '…' : bloc;
}

/* -------------------------------------------------------------------------- */
/* SumUp                                                                      */
/* -------------------------------------------------------------------------- */
async function sumupCheckout(total, client, mode, base) {
  const ref = reference();
  const corps = {
    checkout_reference: ref,
    // SumUp attend un montant décimal, pas des centimes
    amount: Number((total.total / 100).toFixed(2)),
    currency: 'EUR',
    merchant_code: process.env.SUMUP_MERCHANT_CODE,
    description: ticket(total, client, mode),
    hosted_checkout: { enabled: true },
    // bouton « retour à la boutique » sur la page de confirmation SumUp
    redirect_url: base + '/commande-confirmee?ref=' + encodeURIComponent(ref)
  };

  const r = await fetch(baseSumUp() + '/checkouts', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.SUMUP_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(corps)
  });

  const brut = await r.text();
  let d = {};
  try { d = JSON.parse(brut); } catch (e) { /* corps non JSON : gardé tel quel */ }

  if (!r.ok) throw new Error(motif(r.status, d, brut));

  const url = d.hosted_checkout_url;
  if (!url) throw new Error('SumUp n’a pas renvoyé de page de paiement. ' + apercu(brut));
  return { url, reference: ref, id: d.id };
}

/** Les 300 premiers caractères de la réponse, sur une ligne. */
function apercu(brut) {
  const t = String(brut || '').replace(/\s+/g, ' ').trim();
  return t ? 'Réponse : ' + t.slice(0, 300) : 'Réponse vide.';
}

/**
 * Pourquoi SumUp a refusé, en clair dans les journaux.
 *
 * Un « 401 : réponse illisible » ne dit rien : clé fausse, compte pas encore
 * activé, code marchand qui n'appartient pas à la clé — trois causes, trois
 * remèdes, et aucun moyen de trancher. SumUp met son motif tantôt dans
 * `message`, tantôt dans `error_message`, tantôt dans `error_code`, parfois
 * dans un corps qui n'est même pas du JSON. On les regarde tous, et à
 * défaut on recopie la réponse brute : mieux vaut un journal verbeux qu'une
 * panne muette un vendredi soir.
 */
function motif(code, d, brut) {
  const dit = d.message || d.error_message || d.error_code || d.detail ||
    (Array.isArray(d.errors) && d.errors[0] && (d.errors[0].message || d.errors[0].code));

  let piste = '';
  if (code === 401) {
    piste = ' — clé refusée : soit elle est fausse ou révoquée, soit le compte ' +
      'SumUp n’est pas encore activé pour l’encaissement en ligne.';
  } else if (code === 403) {
    piste = ' — clé acceptée mais droits insuffisants, ou code marchand (' +
      (process.env.SUMUP_MERCHANT_CODE || '?') + ') étranger à cette clé.';
  } else if (code === 404) {
    piste = ' — code marchand introuvable : vérifier SUMUP_MERCHANT_CODE.';
  } else if (code === 409) {
    piste = ' — référence de commande déjà utilisée.';
  }

  // La réponse brute est jointe même quand un message a été trouvé : « 400 :
  // Validation error » ne dit pas quel champ est en cause, alors que le
  // corps le nomme. Un journal un peu long vaut mieux qu'un aller-retour de
  // mise en ligne pour découvrir un nom de paramètre.
  return 'SumUp ' + code + (dit ? ' : ' + dit : '') + piste + ' ' + apercu(brut);
}

/**
 * Les paiements aboutis depuis un instant donné (écran cuisine).
 *
 * On passe par l'historique des transactions, pas par la liste des
 * checkouts. GET /v0.1/checkouts refuse en effet d'énumérer quoi que ce
 * soit : sans « checkout_reference », il répond
 *
 *     {"error_code":"MISSING","param":"checkout_reference"}
 *
 * alors que le client officiel de SumUp donne ce paramètre pour facultatif.
 * Il permet de consulter une commande dont on connaît déjà la référence, pas
 * de découvrir celles qui viennent d'arriver — ce qui est exactement ce dont
 * une cuisine a besoin.
 *
 * L'historique, lui, s'énumère, se filtre par date et par statut, et porte
 * « product_summary », que SumUp reprend du « description » du checkout.
 * C'est donc notre ticket qui revient intact, avec le client, l'adresse et
 * les pizzas.
 */
async function sumupCommandes(depuis) {
  const params = new URLSearchParams({
    limit: '100',
    order: 'descending',
    oldest_time: new Date(depuis * 1000).toISOString()
  });
  params.append('statuses[]', 'SUCCESSFUL');
  params.append('types[]', 'PAYMENT');

  const url = baseSumUp().replace('/v0.1', '/v2.1') + '/merchants/' +
    encodeURIComponent(process.env.SUMUP_MERCHANT_CODE) +
    '/transactions/history?' + params.toString();

  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.SUMUP_API_KEY }
  });
  if (!r.ok) {
    const brut = await r.text().catch(() => '');
    let d = {};
    try { d = JSON.parse(brut); } catch (e) { /* corps non JSON */ }
    throw new Error(motif(r.status, d, brut));
  }
  const rep = await r.json();
  const items = Array.isArray(rep) ? rep : (rep.items || []);

  const payees = items.filter((t) => t.status === 'SUCCESSFUL');

  // Une transaction du site porte toujours un ticket qui commence par
  // LIVRAISON ou EMPORTER. Les autres viennent du terminal du comptoir : la
  // cuisine n'a rien à en faire.
  //
  // Écarter sur la seule absence de « product_summary » serait dangereux :
  // si SumUp cessait un jour de recopier la description du checkout, toutes
  // les commandes du site disparaîtraient de l'écran sans un mot, et la
  // cuisine ne saurait même pas qu'elle rate des pizzas. On reconnaît donc
  // la forme du ticket, et on crie dans les journaux quand une transaction
  // récente n'en a pas — au comptoir c'est normal, en rafale ça ne l'est pas.
  const duSite = (t) => /^\s*(LIVRAISON|EMPORTER)\s*\|/.test(String(t.product_summary || ''));
  const orphelines = payees.filter((t) => !duSite(t)).length;
  if (orphelines) {
    console.warn('[cuisine] ' + orphelines + ' encaissement(s) sans ticket sur ' +
      payees.length + ' — normalement des ventes au comptoir. Si le site vient ' +
      'd’encaisser et que rien n’apparaît, c’est ici qu’il faut regarder.');
  }

  return payees
    .filter(duSite)
    .map((t) => lireTicket({
      id: t.transaction_code || String(t.id || '').slice(-8),
      horodatage: Math.floor(new Date(t.timestamp || Date.now()).getTime() / 1000),
      description: t.product_summary || '',
      montant: Math.round(Number(t.amount || 0) * 100)
    }))
    .filter((c) => c.horodatage >= depuis);
}

/**
 * Une commande précise, retrouvée par sa référence — et seulement si elle
 * est payée.
 *
 * C'est le seul usage que SumUp accepte de GET /v0.1/checkouts : avec le
 * « checkout_reference » qu'il réclamait, l'appel fonctionne. Il sert au
 * retour du client sur la page de confirmation, pour vérifier auprès de
 * SumUp que le paiement a bien abouti avant d'envoyer quoi que ce soit.
 *
 * Cette vérification n'est pas une formalité : sans elle, n'importe qui
 * pourrait faire envoyer des courriels en inventant des références.
 */
async function sumupCommandeParReference(ref) {
  const url = baseSumUp() + '/checkouts?checkout_reference=' + encodeURIComponent(ref);
  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.SUMUP_API_KEY }
  });
  if (!r.ok) {
    const brut = await r.text().catch(() => '');
    let d = {};
    try { d = JSON.parse(brut); } catch (e) { /* corps non JSON */ }
    throw new Error(motif(r.status, d, brut));
  }
  const rep = await r.json();
  const liste = Array.isArray(rep) ? rep : [rep];
  const c = liste.find((x) => x && x.status === 'PAID');
  if (!c) return null;

  return lireTicket({
    id: c.checkout_reference || String(c.id || '').slice(-8),
    horodatage: Math.floor(new Date(c.date || Date.now()).getTime() / 1000),
    description: c.description || '',
    montant: Math.round(Number(c.amount || 0) * 100)
  });
}

async function commandeParReference(ref) {
  if (prestataire() !== 'sumup') return null;
  return sumupCommandeParReference(ref);
}

/* -------------------------------------------------------------------------- */
/* Stripe                                                                     */
/* -------------------------------------------------------------------------- */
const TVA = 'txcd_40060003';   // restauration à emporter / livrée

async function stripeCheckout(total, client, mode, base) {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const ref = reference();

  const articles = total.lignes.map((l) => ({
    quantity: l.quantite,
    price_data: {
      currency: 'eur',
      unit_amount: l.unitaire,
      tax_behavior: 'inclusive',
      product_data: { name: libelle(l), tax_code: TVA }
    }
  }));
  if (total.frais) {
    articles.push({
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: total.frais,
        tax_behavior: 'inclusive',
        product_data: { name: 'Frais de livraison', tax_code: TVA }
      }
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: articles,
    locale: 'fr',
    customer_creation: 'if_required',
    success_url: base + '/commande-confirmee?ref=' + ref,
    cancel_url: base + '/commander?annule=1',
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    submit_type: 'pay',
    client_reference_id: ref,
    metadata: { reference: ref, ticket: ticket(total, client, mode) }
  });

  return { url: session.url, reference: ref, id: session.id };
}

async function stripeCommandes(depuis) {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const liste = await stripe.checkout.sessions.list({ limit: 100, created: { gte: depuis } });
  return liste.data
    .filter((s) => s.payment_status === 'paid')
    .map((s) => lireTicket({
      id: (s.metadata && s.metadata.reference) || s.id.slice(-8).toUpperCase(),
      horodatage: s.created,
      description: (s.metadata && s.metadata.ticket) || '',
      montant: s.amount_total || 0
    }));
}

/* -------------------------------------------------------------------------- */
/* Lecture du ticket                                                          */
/* -------------------------------------------------------------------------- */
function lireTicket(c) {
  const p = c.description.split(' | ');
  const mode = (p[0] || '').toLowerCase().includes('livraison') ? 'livraison' : 'emporter';
  const client = (p[2] || '').trim();
  const tel = (client.match(/0\d{9}/) || [''])[0];
  const note = p.find((x) => x.startsWith('NOTE : '));

  return {
    id: c.id,
    horodatage: c.horodatage,
    heure: new Date(c.horodatage * 1000).toLocaleTimeString('fr-FR',
      { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }),
    mode,
    nom: client.replace(tel, '').trim(),
    telephone: tel,
    adresse: mode === 'livraison' ? (p[3] || '') : '',
    commentaire: note ? note.slice(7) : '',
    articles: (p[1] || '').split(' ; ').filter(Boolean).map((t) => {
      const m = t.match(/^(\d+)×\s*(.*)$/);
      return { n: m ? Number(m[1]) : 1, texte: m ? m[2] : t };
    }),
    total: euros(c.montant)
  };
}

/* -------------------------------------------------------------------------- */
async function ouvrirPaiement(total, client, mode, base) {
  const p = prestataire();
  if (p === 'sumup') return sumupCheckout(total, client, mode, base);
  if (p === 'stripe') return stripeCheckout(total, client, mode, base);
  return null;
}

async function commandesPayees(depuis) {
  const p = prestataire();
  if (p === 'sumup') return sumupCommandes(depuis);
  if (p === 'stripe') return stripeCommandes(depuis);
  return [];
}

module.exports = { prestataire, ouvrirPaiement, commandesPayees, commandeParReference,
  ticket, lireTicket, reference };
