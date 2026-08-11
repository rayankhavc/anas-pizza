/* ==========================================================================
   La chaîne complète, contre un faux SumUp.
   --------------------------------------------------------------------------
   Le jour où la clé du restaurant arrive, il n'y aura pas de deuxième
   chance : on la colle dans Vercel et ça doit encaisser. Or ce chemin-là
   n'a jamais tourné — pas de compte marchand pour l'essayer.

   Alors on remplace SumUp par un serveur local qui parle comme lui, et on
   fait passer une vraie commande dedans : POST /api/commande ouvre un
   paiement, le faux SumUp vérifie que la requête est conforme à sa
   documentation, puis GET /api/cuisine relit la commande payée et doit
   retrouver le client, son adresse et ses pizzas.

   Ce que ce test prouve : que le format d'appel est le bon, que la réponse
   est bien lue, et surtout que le ticket survit à l'aller-retour par le
   champ « description » — le seul endroit où SumUp accepte de transporter
   le détail d'une commande. Ce qu'il ne prouve pas : que la clé est
   valide, ni que le compte est actif. Ça, ça se voit au premier euro.
   ========================================================================== */
'use strict';

const http = require('http');

/* -------------------------------------------------------------------------- */
/* Le faux SumUp                                                              */
/* -------------------------------------------------------------------------- */
const CLE = 'sup_sk_TESTFACTICE';
const MARCHAND = 'MCTEST01';
const recus = [];        // les checkouts créés, dans l'ordre
const anomalies = [];    // ce que le vrai SumUp aurait refusé
const courriels = [];    // ce que le faux Brevo a reçu

// L'écran cuisine n'affiche que le service en cours. Une fausse commande
// datée de « maintenant » disparaîtrait donc de l'écran si la suite tourne
// entre la fermeture et la réouverture — ce qui rendrait ces contrôles
// dépendants de l'heure à laquelle on les lance. On les date dans le
// service courant, quel qu'il soit.
const { debutService } = require('../api/cuisine.js');
const DANS_LE_SERVICE = () => new Date((debutService() + 60) * 1000).toISOString();

function faussSumUp() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');

    // Faux Brevo : même serveur, autre chemin.
    if (req.method === 'POST' && url.pathname === '/brevo') {
      let brut = '';
      req.on('data', (c) => { brut += c; });
      req.on('end', () => {
        if (req.headers['api-key'] !== 'cle-brevo-test') {
          anomalies.push('clé Brevo absente ou fausse');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'unauthorized' }));
        }
        let b = {};
        try { b = JSON.parse(brut); } catch (e) { /* laissé vide */ }
        if (!b.sender || !b.sender.email) anomalies.push('expéditeur absent');
        if (!b.to || !b.to[0] || !b.to[0].email) anomalies.push('destinataire absent');
        if (!b.subject) anomalies.push('sujet absent');
        if (!b.textContent || !b.htmlContent) anomalies.push('corps incomplet');
        courriels.push({ a: b.to[0].email, sujet: b.subject,
                         texte: b.textContent, html: b.htmlContent });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messageId: '<test@brevo>' }));
      });
      return;
    }

    // Le contrôle qui suit est celui de SumUp : Brevo, lui, s'authentifie
    // autrement, d'où sa place au-dessus.
    if (req.headers.authorization !== 'Bearer ' + CLE) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }

    if (req.method === 'POST' && url.pathname === '/checkouts') {
      let brut = '';
      req.on('data', (c) => { brut += c; });
      req.on('end', () => {
        let b;
        try { b = JSON.parse(brut); } catch (e) {
          anomalies.push('corps illisible');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Bad JSON' }));
        }

        // Contrôles calqués sur la documentation SumUp.
        if (typeof b.amount !== 'number' || !(b.amount > 0)) {
          anomalies.push('amount doit être un nombre décimal positif, reçu ' + JSON.stringify(b.amount));
        }
        if (Math.round(b.amount * 100) !== b.amount * 100) {
          anomalies.push('amount a plus de deux décimales : ' + b.amount);
        }
        if (b.currency !== 'EUR') anomalies.push('currency attendu EUR, reçu ' + b.currency);
        if (b.merchant_code !== MARCHAND) anomalies.push('merchant_code faux : ' + b.merchant_code);
        if (!b.checkout_reference) anomalies.push('checkout_reference manquant');
        if (!b.hosted_checkout || b.hosted_checkout.enabled !== true) {
          anomalies.push('hosted_checkout.enabled absent : pas de page hébergée, donc pas d’URL');
        }
        if (!b.redirect_url || !/^https?:\/\//.test(b.redirect_url)) {
          anomalies.push('redirect_url absent ou relatif : ' + b.redirect_url);
        }
        if (typeof b.description !== 'string' || b.description.length > 400) {
          anomalies.push('description absente ou trop longue : ' + (b.description || '').length);
        }

        const id = 'chk_' + recus.length;
        const enregistre = {
          id,
          checkout_reference: b.checkout_reference,
          amount: b.amount,
          currency: b.currency,
          description: b.description,
          status: 'PENDING',
          date: DANS_LE_SERVICE(),
          hosted_checkout_url: 'https://pay.sumup.test/' + id
        };
        recus.push(enregistre);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(enregistre));
      });
      return;
    }

    // SumUp refuse d'énumérer les checkouts sans « checkout_reference ».
    // On le reproduit, pour que le test échoue si le code y revenait.
    if (req.method === 'GET' && url.pathname === '/checkouts') {
      if (!url.searchParams.get('checkout_reference')) {
        anomalies.push('liste des checkouts sans checkout_reference : SumUp refuse');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error_code: 'MISSING', message: 'Validation error',
                                        param: 'checkout_reference' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(recus.filter(
        (c) => c.checkout_reference === url.searchParams.get('checkout_reference'))));
    }

    // L'historique des transactions, lui, s'énumère. « product_summary » y
    // reprend le « description » du checkout : c'est notre ticket.
    const hist = url.pathname.match(/^\/merchants\/([^/]+)\/transactions\/history$/);
    if (req.method === 'GET' && hist) {
      if (hist[1] !== MARCHAND) anomalies.push('code marchand faux dans l’URL : ' + hist[1]);
      if (!url.searchParams.get('oldest_time')) anomalies.push('oldest_time absent');
      const items = recus.filter((c) => c.status === 'PAID').map((c) => ({
        id: c.id,
        transaction_code: c.checkout_reference,
        amount: c.amount,
        currency: c.currency,
        status: 'SUCCESSFUL',
        timestamp: c.date,
        product_summary: c.description,
        type: 'PAYMENT'
      }));
      // une vente au comptoir, sans ticket : la cuisine doit l'ignorer
      items.push({ id: 'tpe_1', transaction_code: 'TPE-01', amount: 12.5,
                   currency: 'EUR', status: 'SUCCESSFUL',
                   timestamp: DANS_LE_SERVICE(), type: 'PAYMENT' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items }));
    }


    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not found' }));
  });
}

/* -------------------------------------------------------------------------- */
/* Appel d'une fonction serverless sans serveur                               */
/* -------------------------------------------------------------------------- */
function appeler(handler, { methode = 'GET', corps = null, entetes = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method: methode,
      url: '/',
      headers: Object.assign({ host: 'anas-pizza.test', 'x-forwarded-proto': 'https' }, entetes),
      body: corps
    };
    const res = {
      statusCode: 200,
      setHeader() {},
      end(texte) {
        try { resolve({ code: res.statusCode, corps: JSON.parse(texte || '{}') }); }
        catch (e) { resolve({ code: res.statusCode, corps: texte }); }
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

/* -------------------------------------------------------------------------- */
/* Contrôles                                                                  */
/* -------------------------------------------------------------------------- */
let vert = 0;
const rouges = [];
function ok(nom, condition, detail) {
  if (condition) { vert++; console.log('  ok  ' + nom); }
  else { rouges.push(nom + (detail ? ' — ' + detail : '')); console.log('  KO  ' + nom + (detail ? ' — ' + detail : '')); }
}
function titre(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 40 - t.length))); }

/* -------------------------------------------------------------------------- */
(async function principal() {
  const serveur = faussSumUp();
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const port = serveur.address().port;

  process.env.SUMUP_API_BASE = 'http://127.0.0.1:' + port;
  process.env.SUMUP_API_KEY = CLE;
  process.env.SUMUP_MERCHANT_CODE = MARCHAND;
  process.env.CUISINE_CODE = 'code-cuisine-test';
  process.env.BREVO_API_BASE = 'http://127.0.0.1:' + port + '/brevo';
  process.env.BREVO_API_KEY = 'cle-brevo-test';
  process.env.EMAIL_EXPEDITEUR = 'site@anas-pizza.test';
  process.env.EMAIL_RESTAURANT = 'resto@anas-pizza.test';
  delete process.env.STRIPE_SECRET_KEY;

  const commande = require('../api/commande.js');
  const cuisine = require('../api/cuisine.js');
  const confirmation = require('../api/confirmation.js');
  const { prestataire } = require('../api/_paiement.js');
  const { carte, offreDuMoment } = require('../api/_panier.js');

  // Les montants attendus se calculent, ils ne s'écrivent pas en dur : un
  // mardi, l'offre du jour abaisse le prix des medium et un test figé
  // hurlerait au bug un jour par semaine.
  const tailles = carte().categories.find((c) => c.type === 'pizza').tailles;
  const offre = offreDuMoment();
  function prixDe(idTaille) {
    const t = tailles.find((x) => x.id === idTaille);
    return (offre && (!offre.taille || offre.taille === idTaille) && offre.prix < t.prix)
      ? offre.prix : t.prix;
  }
  const SUPP_FROMAGE = carte().supplements.find((g) => g.id === 'supplement-fromage').prix;
  const FRAIS = carte().livraison.frais;

  // La livraison ferme à minuit. Ce test-ci vérifie la chaîne SumUp, pas les
  // horaires : on ouvre le créneau en grand, sinon il échouerait la nuit.
  // Le créneau a ses propres contrôles dans test-panier.js.
  carte().livraison.creneaux = { livraison: { debut: '00:00', fin: '23:59' },
                                 emporter: { debut: '00:00', fin: '23:59' } };
  if (offre) console.log('  (offre « ' + offre.nom +' » active aujourd’hui, montants ajustés)');

  titre('prestataire choisi');
  ok('les deux variables SumUp suffisent', prestataire() === 'sumup', 'reçu ' + prestataire());

  /* --- une livraison complète ------------------------------------------- */
  titre('livraison payée de bout en bout');
  const panier = [
    { plat: 'tikka', taille: 'medium', quantite: 2,
      supplements: [{ groupe: 'supplement-fromage', choix: 'chevre' }] },
    { plat: '4-fromages', taille: 'large', quantite: 1, supplements: [] }
  ];
  const client = {
    nom: 'Rayan Khalifa', telephone: '06 12 34 56 78',
    rue: '3 rue Crébillon', complement: 'Bât. B, 2e étage',
    codePostal: '44000', commentaire: 'Sonner deux fois'
  };

  const r1 = await appeler(commande, {
    methode: 'POST', corps: { mode: 'livraison', panier, client }
  });

  ok('la commande est acceptée', r1.code === 200, 'code ' + r1.code + ' ' + JSON.stringify(r1.corps).slice(0, 160));
  ok('une page de paiement SumUp est renvoyée',
    typeof r1.corps.url === 'string' && r1.corps.url.startsWith('https://pay.sumup.test/'),
    String(r1.corps.url));
  ok('la référence est dictable au téléphone', /^[A-Z2-9]{4}-[A-Z2-9]{2}$/.test(r1.corps.reference || ''),
    String(r1.corps.reference));

  const envoye = recus[0] || {};
  const attendu = 2 * (prixDe('medium') + SUPP_FROMAGE) + prixDe('large') + FRAIS;
  ok('le total est celui de la carte, pas celui du navigateur',
    r1.corps.total === attendu, 'attendu ' + attendu + ', reçu ' + r1.corps.total);
  ok('le montant envoyé à SumUp est en euros décimaux, pas en centimes',
    envoye.amount === r1.corps.total / 100,
    'SumUp a reçu ' + envoye.amount + ' pour un total de ' + r1.corps.total + ' centimes');
  ok('SumUp n’a rien eu à redire sur la requête',
    anomalies.length === 0, anomalies.join(' / '));

  /* --- le ticket survit-il au voyage ? ----------------------------------- */
  titre('le ticket relu par la cuisine');
  recus.forEach((c) => { c.status = 'PAID'; });

  const r2 = await appeler(cuisine, { entetes: { 'x-cuisine-code': 'code-cuisine-test' } });
  ok('l’écran cuisine répond', r2.code === 200, 'code ' + r2.code);
  const cmd = (r2.corps.commandes || [])[0] || {};
  ok('la commande payée apparaît', !!cmd.id, JSON.stringify(r2.corps).slice(0, 160));
  // le terminal du comptoir encaisse aussi sur ce compte : ses ventes n'ont
  // pas de ticket, et n'ont rien à faire sur l'écran de la cuisine
  ok('une vente au comptoir sans ticket est ignorée',
    !(r2.corps.commandes || []).some((c) => c.id === 'TPE-01'),
    JSON.stringify((r2.corps.commandes || []).map((c) => c.id)));
  ok('le mode est retrouvé', cmd.mode === 'livraison', String(cmd.mode));
  ok('le nom du client est retrouvé', cmd.nom === 'Rayan Khalifa', String(cmd.nom));
  ok('le téléphone est retrouvé', cmd.telephone === '0612345678', String(cmd.telephone));
  ok('l’adresse est retrouvée',
    /Crébillon/.test(cmd.adresse || '') && /44000/.test(cmd.adresse || ''), String(cmd.adresse));
  ok('la consigne du client est retrouvée', cmd.commentaire === 'Sonner deux fois', String(cmd.commentaire));
  ok('les deux lignes sont retrouvées', (cmd.articles || []).length === 2,
    JSON.stringify(cmd.articles));
  ok('la quantité est retrouvée', (cmd.articles || [])[0] && cmd.articles[0].n === 2,
    JSON.stringify((cmd.articles || [])[0]));
  ok('le supplément est retrouvé',
    /Chèvre|chevre|Chevre/i.test(((cmd.articles || [])[0] || {}).texte || ''),
    String(((cmd.articles || [])[0] || {}).texte));
  ok('la taille est retrouvée',
    /Medium/i.test(((cmd.articles || [])[0] || {}).texte || ''),
    String(((cmd.articles || [])[0] || {}).texte));
  ok('le total affiché en cuisine correspond au montant encaissé',
    (cmd.total || '').replace(/ /g, ' ') === (r1.corps.total / 100).toFixed(2).replace('.', ',') + ' €',
    cmd.total + ' vs ' + r1.corps.total);

  /* --- à emporter -------------------------------------------------------- */
  titre('commande à emporter');
  const r3 = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'emporter', panier: [{ plat: 'tikka', taille: 'medium', quantite: 1, supplements: [] }],
             client: { nom: 'Anas', telephone: '0259100198' } }
  });
  ok('acceptée sans adresse', r3.code === 200, 'code ' + r3.code + ' ' + JSON.stringify(r3.corps).slice(0, 140));
  ok('aucun frais de livraison ajouté à un retrait', r3.corps.total === prixDe('medium'),
    'attendu ' + prixDe('medium') + ', reçu ' + r3.corps.total);
  recus.forEach((c) => { c.status = 'PAID'; });
  const r4 = await appeler(cuisine, { entetes: { 'x-cuisine-code': 'code-cuisine-test' } });
  const emporter = (r4.corps.commandes || []).find((c) => c.mode === 'emporter');
  ok('la cuisine la voit comme un retrait', !!emporter, JSON.stringify(r4.corps.commandes || []).slice(0, 160));
  ok('aucune adresse affichée pour un retrait', emporter && !emporter.adresse, String(emporter && emporter.adresse));

  /* --- l'offre du mardi jusque dans l'encaissement ----------------------- */
  titre('offre du jour appliquée à l’encaissement');
  // Le restaurant a renoncé à l'offre du mardi : la carte n'en contient plus.
  // On en installe une de laboratoire, pour continuer d'éprouver que la remise
  // traverse bien tout le chemin jusqu'au montant encaissé — c'est la partie
  // qu'on ne veut pas découvrir cassée le jour où il en redemande une.
  ok('aucune remise configurée par défaut', (carte().offres || []).length === 0,
    JSON.stringify(carte().offres));
  carte().offres = [{ id: 'labo', nom: 'Remise de contrôle', jour: 2, finService: 2,
                      taille: 'medium', prix: 590 }];
  const offres = carte().offres;
  {
    const o = offres[0];
    const jourGarde = o.jour;
    const { jourDeService } = require('../api/_panier.js');
    // On déplace l'offre sur le jour de service courant : sans ça, ce contrôle
    // ne dirait la vérité qu'un mardi sur sept.
    o.jour = jourDeService(new Date(), o.finService);

    const avant = recus.length;
    const rOffre = await appeler(commande, {
      methode: 'POST',
      corps: { mode: 'emporter',
               panier: [{ plat: 'tikka', taille: o.taille || 'medium', quantite: 1, supplements: [] }],
               client: { nom: 'Anas', telephone: '0259100198' } }
    });
    const tailleVisee = tailles.find((t) => t.id === (o.taille || 'medium'));
    ok('le prix remisé est bien celui retenu', rOffre.corps.total === o.prix,
      'attendu ' + o.prix + ', reçu ' + rOffre.corps.total);
    ok('la remise est réelle, pas cosmétique', o.prix < tailleVisee.prix,
      o.prix + ' vs ' + tailleVisee.prix);
    ok('c’est le montant remisé qui part chez SumUp',
      recus[avant] && recus[avant].amount === o.prix / 100,
      String(recus[avant] && recus[avant].amount));

    // et une taille non visée par l'offre reste au tarif plein
    if (o.taille) {
      const autre = tailles.find((t) => t.id !== o.taille);
      const rPlein = await appeler(commande, {
        methode: 'POST',
        corps: { mode: 'emporter',
                 panier: [{ plat: 'tikka', taille: autre.id, quantite: 1, supplements: [] }],
                 client: { nom: 'Anas', telephone: '0259100198' } }
      });
      ok('l’offre ne déborde pas sur les autres tailles',
        rPlein.corps.total === autre.prix, 'attendu ' + autre.prix + ', reçu ' + rPlein.corps.total);
    }
    o.jour = jourGarde;
    carte().offres = [];   // on repose l'offre de laboratoire
  }

  /* --- les courriels de confirmation ------------------------------------ */
  titre('courriels de confirmation');
  const refPayee = recus[0].checkout_reference;
  courriels.length = 0;

  // une référence inventée ne doit rien déclencher : sans ce garde-fou,
  // n'importe qui ferait expédier de faux tickets au restaurant
  const inv = await appeler(confirmation, {
    methode: 'POST', corps: { reference: 'ZZZZ-99', email: 'pirate@exemple.fr' }
  });
  ok('une référence inventée n’envoie rien', inv.code === 200 && inv.corps.fait === false,
    JSON.stringify(inv.corps));
  ok('et aucun courriel n’est parti', courriels.length === 0, String(courriels.length));

  // une référence mal formée n'atteint même pas SumUp
  const mal = await appeler(confirmation, {
    methode: 'POST', corps: { reference: '../../etc/passwd' }
  });
  ok('une référence mal formée est refusée', mal.corps.fait === false, JSON.stringify(mal.corps));

  // la vraie commande, payée
  const conf = await appeler(confirmation, {
    methode: 'POST', corps: { reference: refPayee, email: 'client@exemple.fr' }
  });
  ok('la commande payée déclenche les envois', conf.corps.fait === true, JSON.stringify(conf.corps));
  ok('deux courriels partent', courriels.length === 2, String(courriels.length));

  const auResto = courriels.find((c) => c.a === 'resto@anas-pizza.test');
  const auClient = courriels.find((c) => c.a === 'client@exemple.fr');

  ok('le restaurant est prévenu', !!auResto, JSON.stringify(courriels.map((c) => c.a)));
  ok('le sujet dit l’essentiel d’un coup d’œil',
    auResto && /LIVRAISON/.test(auResto.sujet) && auResto.sujet.includes(refPayee),
    auResto && auResto.sujet);
  ok('le ticket du restaurant porte le téléphone du client',
    auResto && auResto.texte.includes('0612345678'), auResto && auResto.texte.slice(0, 80));
  ok('et l’adresse de livraison',
    auResto && /Crébillon/.test(auResto.texte), auResto && auResto.texte.slice(0, 80));
  ok('et la consigne laissée',
    auResto && auResto.texte.includes('Sonner deux fois'), '');

  ok('le client reçoit sa preuve', !!auClient, '');
  ok('elle porte la référence', auClient && auClient.texte.includes(refPayee), '');
  // euros() sépare le nombre du symbole par une espace insécable : on
  // normalise des deux côtés plutôt que de comparer des espaces invisibles
  const sansInsec = (t) => String(t).replace(/\u00A0/g, ' ');
  ok('elle porte le montant payé',
    auClient && sansInsec(auClient.texte).includes(sansInsec(cmd.total)),
    auClient && cmd.total);
  ok('elle ne porte pas le téléphone du client, inutile pour lui',
    auClient && !auClient.texte.includes('Client :'), '');

  // sans adresse cliente, le restaurant est prévenu quand même
  courriels.length = 0;
  const seul = await appeler(confirmation, {
    methode: 'POST', corps: { reference: refPayee }
  });
  ok('sans adresse cliente, le restaurant est prévenu seul',
    seul.corps.fait === true && courriels.length === 1 &&
    courriels[0].a === 'resto@anas-pizza.test', String(courriels.length));

  // sans clé Brevo, rien ne casse
  courriels.length = 0;
  const gardeBrevo = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY;
  const sansCle = await appeler(confirmation, {
    methode: 'POST', corps: { reference: refPayee, email: 'client@exemple.fr' }
  });
  ok('sans clé Brevo, la page répond quand même sans erreur',
    sansCle.code === 200 && sansCle.corps.fait === false, JSON.stringify(sansCle.corps));
  ok('et aucun courriel n’est parti', courriels.length === 0, String(courriels.length));
  process.env.BREVO_API_KEY = gardeBrevo;

  /* --- l'écran cuisine est-il fermé à clé ? ------------------------------ */
  titre('accès à l’écran cuisine');
  const r5 = await appeler(cuisine, { entetes: { 'x-cuisine-code': 'mauvais' } });
  ok('un mauvais code est refusé', r5.code === 401, 'code ' + r5.code);
  const r6 = await appeler(cuisine, {});
  ok('sans code, rien ne sort', r6.code === 401, 'code ' + r6.code);
  const garde = process.env.CUISINE_CODE;
  delete process.env.CUISINE_CODE;
  const r7 = await appeler(cuisine, { entetes: { 'x-cuisine-code': 'peu importe' } });
  ok('sans CUISINE_CODE configuré, l’écran se déclare hors service, il ne s’ouvre pas',
    r7.code === 503, 'code ' + r7.code);
  process.env.CUISINE_CODE = garde;

  /* --- prix falsifié ----------------------------------------------------- */
  titre('tentative de fraude');
  const r8 = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'emporter',
             panier: [{ plat: 'tikka', taille: 'medium', quantite: 1, prix: 1, unitaire: 1, total: 1, supplements: [] }],
             client: { nom: 'Anas', telephone: '0259100198' } }
  });
  ok('un prix envoyé par le navigateur est ignoré', r8.corps.total === prixDe('medium'),
    'total retenu ' + r8.corps.total + ', attendu ' + prixDe('medium'));
  ok('c’est bien ce montant-là qui part chez SumUp',
    recus[recus.length - 1].amount === prixDe('medium') / 100, String(recus[recus.length - 1].amount));

  /* --- sans clé, le site ne fait pas semblant ---------------------------- */
  titre('avant l’arrivée de la clé');
  delete process.env.SUMUP_API_KEY;
  delete process.env.SUMUP_MERCHANT_CODE;
  const r9 = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'emporter', panier: [{ plat: 'tikka', taille: 'medium', quantite: 1, supplements: [] }],
             client: { nom: 'Anas', telephone: '0259100198' } }
  });
  ok('le site renvoie vers le téléphone plutôt que de tourner dans le vide',
    r9.code === 503 && /téléphone/.test(r9.corps.erreur || ''), JSON.stringify(r9.corps).slice(0, 140));
  ok('et il rappelle quand même le récapitulatif',
    r9.corps.recap && r9.corps.recap.total, JSON.stringify(r9.corps.recap));
  const r10 = await appeler(cuisine, { entetes: { 'x-cuisine-code': 'code-cuisine-test' } });
  ok('l’écran cuisine reste ouvert et honnête',
    r10.code === 200 && Array.isArray(r10.corps.commandes) && r10.corps.commandes.length === 0,
    JSON.stringify(r10.corps).slice(0, 140));

  /* --- clé refusée par SumUp --------------------------------------------- */
  titre('clé invalide ou compte fermé');
  process.env.SUMUP_API_KEY = 'sup_sk_MAUVAISE';
  process.env.SUMUP_MERCHANT_CODE = MARCHAND;
  const r11 = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'emporter', panier: [{ plat: 'tikka', taille: 'medium', quantite: 1, supplements: [] }],
             client: { nom: 'Anas', telephone: '0259100198' } }
  });
  ok('le client voit un message clair, pas une page blanche',
    r11.code === 502 && /téléphone/.test(r11.corps.erreur || ''), JSON.stringify(r11.corps).slice(0, 140));

  serveur.close();
  console.log('');
  if (rouges.length) {
    console.log('✗ ' + rouges.length + ' contrôle(s) en échec sur ' + (vert + rouges.length) + ' :');
    rouges.forEach((r) => console.log('   - ' + r));
    process.exit(1);
  }
  console.log('Tout est vert — ' + vert + ' contrôles, chaîne SumUp comprise.');
})().catch((e) => { console.error(e); process.exit(1); });
