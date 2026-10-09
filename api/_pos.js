/* ==========================================================================
   La caisse SumUp POS — envoyer une commande payée sur l'écran de cuisine.
   --------------------------------------------------------------------------
   Le restaurant a déjà un écran de cuisine SumUp, fixé au mur, que la brigade
   regarde toute la soirée pour les commandes du comptoir. Les commandes du
   site arrivaient ailleurs : sur notre écran à nous. Deux écrans, donc des
   allers-retours, donc des commandes vues en retard.

   Ce module pousse la commande payée dans la caisse SumUp, d'où elle part
   toute seule sur leur écran. Plus qu'un seul endroit à regarder.

   Deux API différentes, à ne pas confondre :

   - l'API « paiements » (api.sumup.com), celle qu'on utilise pour encaisser.
     Elle ne connaît que des encaissements, et ignore tout des commandes ;
   - l'API « caisse » (api.thegoodtill.com), l'ancienne Goodtill rachetée par
     SumUp. C'est elle qui tient les ventes, les tickets et l'écran cuisine.

   Celle-ci exige un en-tête « Vendor-Id » que SumUp délivre sur demande. Tant
   qu'il manque, tout ce fichier reste inerte : rien n'est tenté, rien n'est
   cassé, le site encaisse comme avant. C'est voulu — on code d'abord, on
   branche le jour où l'autorisation arrive.
   ========================================================================== */
'use strict';

const BASE = () => (process.env.POS_BASE || 'https://api.thegoodtill.com/api')
  .replace(/\/+$/, '');

/**
 * La caisse est-elle branchée ?
 *
 * Quatre valeurs sont nécessaires et aucune n'a de défaut raisonnable : sans
 * elles on ne tente rien. Un site qui encaisse doit continuer d'encaisser même
 * si la caisse du restaurant est injoignable, mal configurée, ou pas encore
 * autorisée par SumUp.
 */
function posConfigure() {
  return Boolean(
    process.env.POS_SUBDOMAIN &&
    process.env.POS_USER &&
    process.env.POS_PASSWORD &&
    process.env.POS_VENDOR_ID
  );
}

/* --- jeton ------------------------------------------------------------- */

// Le jeton vit une douzaine d'heures. On le garde en mémoire du processus :
// sur une fonction sans état, ça vaut pour les quelques commandes qui se
// suivent, et on se reconnecte sans drame le reste du temps. Stocker un mot
// de passe ailleurs qu'en variable d'environnement serait pire.
let jetonEnCache = null;
let jetonExpire = 0;

async function jeton() {
  const maintenant = Date.now();
  if (jetonEnCache && maintenant < jetonExpire) return jetonEnCache;

  const r = await fetch(BASE() + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      subdomain: process.env.POS_SUBDOMAIN,
      username: process.env.POS_USER,
      password: process.env.POS_PASSWORD
    })
  });

  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) {
    throw new Error('Connexion à la caisse refusée : ' +
      (d.error || d.message || 'HTTP ' + r.status));
  }

  // L'API refuse les comptes « operator » : elle délivre bien un jeton, mais
  // tous les appels suivants échouent. Autant le dire ici, clairement, plutôt
  // que de laisser chercher pourquoi les commandes n'arrivent pas.
  if (d.user_level && /operator/i.test(d.user_level)) {
    throw new Error('Le compte « ' + (d.user_name || process.env.POS_USER) +
      ' » est un compte opérateur. La caisse n’accepte que les comptes ' +
      'administrateur ou propriétaire du magasin.');
  }

  jetonEnCache = d.token;
  jetonExpire = maintenant + 10 * 60 * 60 * 1000;   // dix heures, large
  return jetonEnCache;
}

/** Oublie le jeton : au prochain appel on se reconnecte. */
function oublierJeton() { jetonEnCache = null; jetonExpire = 0; }

/* --- construction de la vente ------------------------------------------ */

/** Centimes → « 31.40 ». La caisse veut un décimal à deux chiffres, en texte. */
const prix = (centimes) => (Math.round(centimes) / 100).toFixed(2);

/**
 * Découpe l'adresse écrite d'un bloc en rue / code postal / ville.
 *
 * On relit ici une chaîne que l'on a nous-mêmes fabriquée à la commande —
 * « 12 rue de la Paix Appt 3 44000 Nantes » — parce que c'est tout ce qui
 * survit au passage par le prestataire de paiement. Le code postal sert de
 * charnière : cinq chiffres isolés, ce qui précède est la rue, ce qui suit
 * est la ville.
 *
 * La caisse exige les trois champs. Quand la découpe échoue, on préfère un
 * repli honnête à un refus : l'adresse complète part dans la rue, et le code
 * postal du restaurant comble le trou. Une commande qui arrive avec une
 * adresse mal découpée vaut mieux qu'une commande qui n'arrive pas.
 */
function decouperAdresse(texte) {
  const brut = String(texte || '').trim();
  const m = brut.match(/^(.*?)[\s,]*\b(\d{5})\b[\s,]*(.*)$/);
  if (!m) return { address: brut || 'Adresse non renseignée', postcode: '44000', city: 'Nantes' };
  return {
    address: m[1].trim() || brut,
    postcode: m[2],
    city: m[3].trim() || 'Nantes'
  };
}

/**
 * Notre commande payée → la vente attendue par la caisse.
 *
 * Une règle de l'API gouverne toute la forme : la somme des paiements doit
 * égaler, au centime, la somme des lignes plus les frais. Or notre ticket ne
 * transporte pas le prix de chaque ligne — il ne transporte que le total, par
 * manque de place chez le prestataire de paiement.
 *
 * D'où ce choix : les articles partent en lignes à 0,00 €, lisibles sur
 * l'écran de cuisine, et une dernière ligne porte la totalité de la somme.
 * L'égalité est exacte, la cuisine lit sa commande article par article, et la
 * caisse encaisse le bon montant. Ce qu'on y perd, c'est la ventilation par
 * plat dans les rapports — ce qui n'intéresse personne tant que les totaux
 * sont justes, et qui se récupérera le jour où le ticket portera les prix.
 */
function construireVente(c, options) {
  const o = options || {};
  const tva = String(o.tva || process.env.POS_TVA || '10');
  const livraison = c.mode === 'livraison';

  // Numérotation des lignes : l'API s'en sert pour l'ordre d'affichage.
  let rang = 0;
  const lignes = (c.articles || []).map((a) => ({
    name: String(a.texte || '').slice(0, 191),
    price: '0.00',
    vat_rate: tva,
    quantity: Number(a.n) || 1,
    sequence_no: ++rang
  }));

  // La ligne qui porte l'argent. Elle dit aussi d'où vient la commande : sur
  // le ticket et dans les rapports, « site » se distingue du comptoir.
  lignes.push({
    name: 'Commande en ligne — payée sur le site',
    price: prix(c.montant),
    vat_rate: tva,
    quantity: 1,
    sequence_no: ++rang
  });

  // « id » est l'identifiant que le prestataire de paiement nous rend pour
  // cette commande : la référence du paiement quand on relit un encaissement
  // précis, le code de transaction quand on relit l'historique du service.
  // Dans les deux cas il est unique et stable, et c'est lui qui empêche
  // d'envoyer deux fois la même commande en cuisine.
  const identifiant = String(c.id || '');

  const vente = {
    // Court, parce que la caisse l'affiche en entier : « A7F3-K2 ».
    order_ref: identifiant.replace(/^(LIVRAISON|EMPORTER)-/, '').slice(0, 20),
    vendor_order_ref: identifiant.slice(0, 36),
    type: livraison ? 'DELIVERY' : 'COLLECTION',
    // Le restaurant a déjà encaissé : la commande n'a pas à être acceptée une
    // seconde fois à la caisse, elle part directement en préparation.
    status: 'ACCEPTED',
    user: {
      name: String(c.nom || '').slice(0, 191),
      // « user.phone must be a number » : on ne garde que les chiffres.
      phone: String(c.telephone || '').replace(/\D/g, '')
    },
    sales_items: lignes,
    payments: [{ method: 'CARD', amount: prix(c.montant) }]
  };

  if (c.commentaire) vente.notes = String(c.commentaire).slice(0, 191);

  if (livraison) {
    vente.address = decouperAdresse(c.adresse);
    // Le mot du client — « sonner au 3e » — sert au livreur, pas au cuisinier.
    if (c.commentaire) vente.address.notes = String(c.commentaire).slice(0, 191);
  }

  return vente;
}

/* --- appels ------------------------------------------------------------- */

async function appeler(chemin, options) {
  const o = options || {};
  const entetes = {
    Accept: 'application/json',
    Authorization: 'Bearer ' + (await jeton()),
    'Vendor-Id': process.env.POS_VENDOR_ID
  };
  if (process.env.POS_OUTLET_ID) entetes['Outlet-Id'] = process.env.POS_OUTLET_ID;
  if (o.corps) entetes['Content-Type'] = 'application/json';

  const r = await fetch(BASE() + chemin, {
    method: o.methode || 'GET',
    headers: entetes,
    body: o.corps ? JSON.stringify(o.corps) : undefined
  });

  const d = await r.json().catch(() => ({}));

  // Un jeton périmé se reconnaît à un 401. On se reconnecte une fois, puis on
  // abandonne : réessayer en boucle sur un mot de passe changé ne ferait que
  // verrouiller le compte.
  if (r.status === 401 && !o.secondEssai) {
    oublierJeton();
    return appeler(chemin, Object.assign({}, o, { secondEssai: true }));
  }

  if (!r.ok || d.status === false) {
    // L'API détaille ses refus champ par champ : on les remonte tels quels,
    // c'est ce qui fera gagner du temps le jour du branchement.
    const details = d.errors
      ? ' (' + Object.keys(d.errors).map((k) => k + ' : ' + [].concat(d.errors[k])[0]).join(' ; ') + ')'
      : '';
    throw new Error((d.message || 'HTTP ' + r.status) + details);
  }

  return d.data !== undefined ? d.data : d;
}

/** Envoie une commande payée sur la caisse, et donc sur l'écran de cuisine. */
async function envoyerVente(commande, options) {
  return appeler('/external_sale/sale', {
    methode: 'POST',
    corps: construireVente(commande, options)
  });
}

/**
 * Les références déjà présentes dans la caisse.
 *
 * Sert à ne pas envoyer deux fois la même commande. On interroge la caisse
 * plutôt que de tenir une liste de notre côté : elle est la seule à savoir ce
 * qu'elle a vraiment reçu, et une liste à nous serait une chose de plus à
 * garder juste.
 */
async function referencesEnvoyees() {
  const d = await appeler('/external_sale/sales');
  const liste = Array.isArray(d) ? d : (d.sales || d.data || []);
  return new Set(liste
    .map((v) => v && (v.vendor_order_ref || v.order_ref))
    .filter(Boolean));
}

module.exports = {
  posConfigure, construireVente, envoyerVente, referencesEnvoyees,
  decouperAdresse, prix, oublierJeton
};
