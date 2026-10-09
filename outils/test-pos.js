/* ==========================================================================
   L'envoi d'une commande sur la caisse SumUp, contre une fausse caisse.
   --------------------------------------------------------------------------
   On ne peut pas essayer contre la vraie caisse du restaurant : il n'y en a
   qu'une, elle est au comptoir, et une commande d'essai y apparaîtrait au
   milieu du service. On rejoue donc ici le contrat tel que la documentation
   de SumUp le décrit, refus compris.

   La fausse caisse est sévère exprès. Elle refuse ce que la vraie refuse :
   un en-tête Vendor-Id absent, un compte opérateur, un téléphone qui n'est
   pas un nombre, une adresse sans ville pour une livraison, et surtout la
   règle qui gouverne toute la forme du message — la somme des paiements doit
   égaler, au centime, la somme des lignes plus les frais. C'est cette règle
   qui casse en premier le jour du branchement si on l'a mal comprise.
   ========================================================================== */
'use strict';

const http = require('http');

const VENDOR = 'vendor-test-0001';
const JETON = 'jwt.factice.0001';

const recues = [];        // les ventes acceptées par la fausse caisse
const anomalies = [];
let niveauCompte = 'store_admin';
let refuserJetonUneFois = false;

/* -------------------------------------------------------------------------- */
/* La fausse caisse                                                           */
/* -------------------------------------------------------------------------- */
function refus(res, message, erreurs) {
  res.writeHead(422, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: false, message, errors: erreurs }));
}

function fausseCaisse() {
  return http.createServer((req, res) => {
    let brut = '';
    req.on('data', (c) => { brut += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const corps = brut ? JSON.parse(brut) : {};

      /* --- connexion --- */
      if (url.pathname === '/api/login') {
        if (corps.subdomain !== 'anaspizza' || corps.password !== 'secret') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid credentials' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          token: JETON, user_level: niveauCompte,
          user_name: 'Anas', client_subdomain: 'anaspizza'
        }));
      }

      /* --- tout le reste demande un jeton --- */
      if (req.headers.authorization !== 'Bearer ' + JETON || refuserJetonUneFois) {
        refuserJetonUneFois = false;
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: false, message: 'Unauthenticated.' }));
      }

      /* --- liste des ventes déjà reçues --- */
      if (url.pathname === '/api/external_sale/sales' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: true,
          data: recues.map((v) => ({
            sale_id: 'id-' + v.vendor_order_ref,
            order_ref: v.order_ref,
            vendor_order_ref: v.vendor_order_ref
          }))
        }));
      }

      /* --- création d'une vente --- */
      if (url.pathname === '/api/external_sale/sale' && req.method === 'POST') {
        // Le fameux en-tête, celui que SumUp délivre à la main.
        if (req.headers['vendor-id'] !== VENDOR) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: false, message: 'Invalid Vendor-Id' }));
        }

        const e = {};
        const v = corps;

        if (!v.order_ref || v.order_ref.length > 20) e.order_ref = ['invalid'];
        if (!v.vendor_order_ref || v.vendor_order_ref.length > 36) e.vendor_order_ref = ['invalid'];
        if (['COLLECTION', 'DELIVERY', 'DROPOFF'].indexOf(v.type) === -1) e.type = ['invalid'];
        if (v.status && ['CREATED', 'ACCEPTED'].indexOf(v.status) === -1) e.status = ['invalid'];
        if (v.notes && v.notes.length > 191) e.notes = ['too long'];

        if (v.user && v.user.phone && !/^\d+$/.test(v.user.phone)) {
          e['user.phone'] = ['The user.phone must be a number.'];
        }

        if (v.type === 'DELIVERY') {
          const a = v.address || {};
          if (!a.address) e['address.address'] = ['The address.address field is required.'];
          if (!a.city) e['address.city'] = ['The address.city field is required.'];
          if (!a.postcode) e['address.postcode'] = ['The address.postcode field is required.'];
        } else if (v.delivery_charge) {
          e.delivery_charge = ['only valid when type is DELIVERY'];
        }

        const items = v.sales_items || [];
        if (!items.length) e.sales_items = ['required'];
        items.forEach((it, i) => {
          if (!it.name) e['sales_items.' + i + '.name'] = ['required'];
          if (!/^-?\d+\.\d{2}$/.test(String(it.price))) e['sales_items.' + i + '.price'] = ['2dp'];
          if (!it.product_id && !it.vat_rate) {
            e['sales_items.' + i + '.vat_rate'] = ['required when no product_id'];
          }
          if (!Number.isInteger(it.quantity) || it.quantity === 0) {
            e['sales_items.' + i + '.quantity'] = ['invalid'];
          }
          if (!Number.isInteger(it.sequence_no)) e['sales_items.' + i + '.sequence_no'] = ['invalid'];
        });

        const paiements = v.payments || [];
        if (!paiements.length) e.payments = ['At least one entry is required'];
        paiements.forEach((p, i) => {
          if (['CASH', 'CARD'].indexOf(p.method) === -1) {
            e['payments.' + i + '.method'] = ['The selected payments.' + i + '.method is invalid.'];
          }
        });

        // La règle centrale, en centimes pour ne pas comparer des flottants.
        const cts = (x) => Math.round(Number(x) * 100);
        const sommeLignes = items.reduce((t, it) => t + cts(it.price) * it.quantity, 0) +
          cts(v.service_charge || 0) + cts(v.delivery_charge || 0);
        const sommePaiements = paiements.reduce((t, p) => t + cts(p.amount), 0);
        if (v.strict_payments !== false && sommePaiements !== sommeLignes) {
          e.payments = ['payments (' + sommePaiements + ') ≠ articles + frais (' + sommeLignes + ')'];
        }

        if (Object.keys(e).length) return refus(res, 'Sale could not be created', e);

        recues.push(v);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: true,
          data: {
            sale_id: 'id-' + v.vendor_order_ref,
            order_ref: v.order_ref,
            vendor_order_ref: v.vendor_order_ref,
            is_voided: false
          },
          message: 'Sale created.'
        }));
      }

      anomalies.push('route inattendue : ' + req.method + ' ' + url.pathname);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: false, message: 'Not Found' }));
    });
  });
}

/* -------------------------------------------------------------------------- */
let vert = 0;
const rouges = [];
function ok(nom, condition, detail) {
  if (condition) { vert++; console.log('  ok  ' + nom); }
  else { rouges.push(nom + (detail ? ' — ' + detail : '')); console.log('  KO  ' + nom + (detail ? ' — ' + detail : '')); }
}
function titre(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 42 - t.length))); }

/* Une commande telle que l'écran cuisine la connaît déjà. */
function commande(sur) {
  // Volontairement calquée sur ce que lireTicket() produit, champ pour champ :
  // il n'y a pas de « reference » là-dedans, seulement un « id ».
  return Object.assign({
    id: 'LIVRAISON-A7F3-K2',
    mode: 'livraison',
    nom: 'Julie Martin',
    telephone: '0612345678',
    adresse: '12 rue de la Paix Appt 3 44000 Nantes',
    commentaire: 'Sonner au 3e étage',
    articles: [
      { n: 2, texte: 'Pizza Chicago — grande' },
      { n: 1, texte: 'Coca 33 cl' }
    ],
    montant: 3140,
    total: '31,40 €'
  }, sur || {});
}

(async () => {
  const serveur = fausseCaisse();
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const port = serveur.address().port;

  process.env.POS_BASE = 'http://127.0.0.1:' + port + '/api';
  process.env.POS_SUBDOMAIN = 'anaspizza';
  process.env.POS_USER = 'anas';
  process.env.POS_PASSWORD = 'secret';
  process.env.POS_VENDOR_ID = VENDOR;
  delete process.env.POS_OUTLET_ID;

  const pos = require('../api/_pos');

  /* ------------------------------------------------------------------ */
  titre('le message que la caisse attend');

  const v = pos.construireVente(commande());
  ok('la référence affichée reste courte', v.order_ref === 'A7F3-K2', v.order_ref);
  ok('la référence interne garde le mode', v.vendor_order_ref === 'LIVRAISON-A7F3-K2');
  ok('une livraison est bien une livraison', v.type === 'DELIVERY');
  ok('la commande part déjà acceptée', v.status === 'ACCEPTED');
  ok('le téléphone ne contient que des chiffres', /^\d{10}$/.test(v.user.phone));
  ok('le mot du client suit la commande', v.notes === 'Sonner au 3e étage');
  ok('et suit aussi le livreur', v.address.notes === 'Sonner au 3e étage');

  titre('l’adresse, découpée pour la caisse');
  ok('la rue', v.address.address === '12 rue de la Paix Appt 3', v.address.address);
  ok('le code postal', v.address.postcode === '44000', v.address.postcode);
  ok('la ville', v.address.city === 'Nantes', v.address.city);

  const sansCP = pos.decouperAdresse('3 impasse du Four');
  ok('une adresse sans code postal ne fait pas tout échouer',
    sansCP.address === '3 impasse du Four' && sansCP.postcode === '44000' && sansCP.city === 'Nantes');
  const cpColle = pos.decouperAdresse('5 bd des Poilus, 44300 Nantes');
  ok('une virgule avant le code postal ne gêne pas',
    cpColle.address === '5 bd des Poilus' && cpColle.city === 'Nantes', JSON.stringify(cpColle));

  titre('la cuisine lit ses articles, la caisse sa somme');
  ok('chaque article a sa ligne', v.sales_items.length === 3);
  ok('les articles sont lisibles tels quels',
    v.sales_items[0].name === 'Pizza Chicago — grande' && v.sales_items[0].quantity === 2);
  ok('les lignes sont numérotées dans l’ordre',
    v.sales_items.map((l) => l.sequence_no).join(',') === '1,2,3');
  ok('la dernière ligne porte la somme', v.sales_items[2].price === '31.40');
  ok('le paiement est la carte, déjà encaissée',
    v.payments[0].method === 'CARD' && v.payments[0].amount === '31.40');
  ok('les prix sont en décimal à deux chiffres',
    v.sales_items.every((l) => /^\d+\.\d{2}$/.test(l.price)));

  titre('une commande à emporter');
  const e = pos.construireVente(commande({
    mode: 'emporter', id: 'EMPORTER-B2C4-M9',
    adresse: '', commentaire: '', montant: 1890
  }));
  ok('c’est un retrait sur place', e.type === 'COLLECTION');
  ok('et sans adresse de livraison', e.address === undefined);
  ok('sans frais de livraison non plus', e.delivery_charge === undefined);
  ok('la somme suit la commande', e.payments[0].amount === '18.90');

  /* ------------------------------------------------------------------ */
  titre('la caisse accepte — et l’écran cuisine s’allume');

  let envoi;
  try { envoi = await pos.envoyerVente(commande()); } catch (x) { envoi = { erreur: x.message }; }
  ok('la vente est créée', envoi && envoi.sale_id === 'id-LIVRAISON-A7F3-K2',
    envoi && envoi.erreur);
  ok('la fausse caisse l’a bien reçue', recues.length === 1);
  ok('avec les articles de la commande',
    recues[0] && recues[0].sales_items.length === 3);

  try {
    await pos.envoyerVente(commande({
      mode: 'emporter', id: 'EMPORTER-B2C4-M9',
      adresse: '', commentaire: '', montant: 1890
    }));
    ok('une commande à emporter passe aussi', recues.length === 2);
  } catch (x) {
    ok('une commande à emporter passe aussi', false, x.message);
  }

  titre('ne pas envoyer deux fois la même commande');
  const deja = await pos.referencesEnvoyees();
  ok('la caisse dit ce qu’elle a déjà', deja.has('LIVRAISON-A7F3-K2') && deja.size === 2);
  ok('et donc ce qu’il reste à envoyer', !deja.has('LIVRAISON-ZZZZ-99'));

  /* ------------------------------------------------------------------ */
  titre('ce que la vraie caisse refuserait');

  const avant = recues.length;
  try {
    // Un centime de trop sur le paiement : la règle qui casse en premier.
    const faux = pos.construireVente(commande());
    faux.payments[0].amount = '31.41';
    await (async () => {
      const r = await fetch(process.env.POS_BASE + '/external_sale/sale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json',
          Authorization: 'Bearer ' + JETON, 'Vendor-Id': VENDOR
        },
        body: JSON.stringify(faux)
      });
      const d = await r.json();
      ok('un centime d’écart est refusé, pas avalé',
        d.status === false && Boolean(d.errors.payments));
    })();
  } catch (x) { ok('un centime d’écart est refusé, pas avalé', false, x.message); }
  ok('et rien n’est enregistré dans ce cas', recues.length === avant);

  // Sans l'en-tête que SumUp délivre, rien ne passe. C'est tout l'enjeu.
  const sansVendor = process.env.POS_VENDOR_ID;
  process.env.POS_VENDOR_ID = 'mauvais';
  pos.oublierJeton();
  let refuse = null;
  try { await pos.envoyerVente(commande({ id: 'LIVRAISON-XXXX-11' })); }
  catch (x) { refuse = x.message; }
  ok('sans Vendor-Id valide, la caisse ferme la porte', /Vendor-Id/i.test(refuse || ''), refuse);
  process.env.POS_VENDOR_ID = sansVendor;

  titre('les pannes qu’on saura diagnostiquer');

  pos.oublierJeton();
  niveauCompte = 'operator';
  let plainte = null;
  try { await pos.envoyerVente(commande({ id: 'LIVRAISON-YYYY-22' })); }
  catch (x) { plainte = x.message; }
  ok('un compte opérateur est nommé, pas deviné',
    /opérateur/i.test(plainte || ''), plainte);
  niveauCompte = 'store_admin';
  pos.oublierJeton();

  // Un jeton périmé en pleine soirée ne doit pas perdre la commande.
  refuserJetonUneFois = true;
  let reprise;
  try { reprise = await pos.envoyerVente(commande({ id: 'LIVRAISON-WWWW-33' })); }
  catch (x) { reprise = { erreur: x.message }; }
  ok('un jeton périmé se renouvelle tout seul',
    reprise && reprise.sale_id === 'id-LIVRAISON-WWWW-33', reprise && reprise.erreur);

  /* ------------------------------------------------------------------ */
  titre('le rattrapage, qui ne dépend d’aucun navigateur');

  // On remplace le prestataire de paiement par une liste connue : ce qui est
  // testé ici n'est pas la lecture des paiements, c'est la règle de versement
  // — n'envoyer que ce qui manque, et ne jamais s'arrêter sur un refus.
  const cheminPaiement = require.resolve('../api/_paiement');
  let payeesSimulees = [];
  require.cache[cheminPaiement] = {
    id: cheminPaiement, filename: cheminPaiement, loaded: true, exports: {
      prestataire: () => 'sumup',
      commandesPayees: async () => payeesSimulees
    }
  };
  const cheminCuisine = require.resolve('../api/cuisine');
  require.cache[cheminCuisine] = {
    id: cheminCuisine, filename: cheminCuisine, loaded: true, exports: {
      debutService: () => Math.floor(Date.now() / 1000) - 3600
    }
  };
  process.env.POS_RATTRAPAGE_CLE = 'cle-de-service';
  const rattrapage = require('../api/pos-rattrapage');

  function appelRattrapage(cle) {
    return new Promise((resoudre) => {
      const corps = [];
      const res = {
        statusCode: 200, setHeader() {},
        end(t) { resoudre({ statut: res.statusCode, d: JSON.parse(t || '{}') }); }
      };
      rattrapage({ url: '/api/pos-rattrapage?cle=' + encodeURIComponent(cle), headers: {} }, res);
    });
  }

  let r = await appelRattrapage('mauvaise');
  ok('sans la bonne clé, le rattrapage refuse', r.statut === 401);

  // Deux commandes déjà versées plus tôt dans ce test, une nouvelle.
  payeesSimulees = [
    commande(),
    commande({ id: 'EMPORTER-B2C4-M9', mode: 'emporter', adresse: '', commentaire: '' }),
    commande({ id: 'TXNNEUVE1', montant: 2250 })
  ];
  const avantRattrapage = recues.length;
  r = await appelRattrapage('cle-de-service');
  ok('il ne renvoie pas ce que la caisse a déjà',
    r.d.envoyees && r.d.envoyees.length === 1 && r.d.envoyees[0] === 'TXNNEUVE1',
    JSON.stringify(r.d));
  ok('une seule vente de plus en caisse', recues.length === avantRattrapage + 1);

  r = await appelRattrapage('cle-de-service');
  ok('relancé aussitôt, il n’envoie plus rien',
    r.d.envoyees.length === 0 && recues.length === avantRattrapage + 1);

  // Une commande dont le téléphone est inexploitable : la caisse la refuse.
  // Celle d'après doit quand même passer.
  payeesSimulees = [
    commande({ id: 'TXNCASSEE', telephone: 'néant', montant: 1000 }),
    commande({ id: 'TXNSAINE', montant: 1100 })
  ];
  // Un téléphone vidé de ses chiffres passerait la validation ; on force le
  // refus là où la vraie caisse refuse aussi : un article sans nom.
  payeesSimulees[0].articles = [{ n: 1, texte: '' }];
  const avantMelange = recues.length;
  r = await appelRattrapage('cle-de-service');
  ok('une commande refusée n’arrête pas les suivantes',
    r.d.envoyees.indexOf('TXNSAINE') !== -1 && r.d.echecs.length === 1,
    JSON.stringify(r.d));
  ok('et la caisse n’a reçu que la bonne', recues.length === avantMelange + 1);
  ok('le refus est nommé, pas masqué',
    /name/i.test((r.d.echecs[0] || {}).motif || ''), (r.d.echecs[0] || {}).motif);

  titre('tant que SumUp n’a pas ouvert l’accès');
  const garde = process.env.POS_VENDOR_ID;
  delete process.env.POS_VENDOR_ID;
  ok('le module se déclare éteint', pos.posConfigure() === false);
  process.env.POS_VENDOR_ID = garde;
  ok('et allumé dès que les quatre valeurs sont là', pos.posConfigure() === true);

  /* ------------------------------------------------------------------ */
  serveur.close();
  anomalies.forEach((a) => rouges.push('anomalie : ' + a));
  console.log('');
  if (rouges.length) {
    console.error('ÉCHEC — ' + rouges.length + ' contrôle(s) :');
    rouges.forEach((r) => console.error('  • ' + r));
    process.exit(1);
  }
  console.log('Tout est vert — ' + vert + ' contrôles sur l’envoi en caisse.');
})().catch((e) => { console.error(e); process.exit(1); });
