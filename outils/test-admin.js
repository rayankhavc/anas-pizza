/* ==========================================================================
   L'espace de gestion, contre un faux GitHub.
   --------------------------------------------------------------------------
   Ce qui se joue ici n'est pas du confort : l'espace de gestion touche aux
   prix et à la disponibilité des plats, c'est-à-dire à ce que le client
   paie. Deux fautes suffiraient à coûter de l'argent au restaurant —

   - un profil qui obtiendrait un droit qu'il n'a pas, et le gérant change
     les prix avant d'avoir payé le site ;
   - une rupture déclarée au comptoir qui n'arrêterait pas la commande, et
     la cuisine reçoit un ticket pour un plat qu'elle n'a plus.

   Ces deux-là sont vérifiées ci-dessous de bout en bout, avec un faux GitHub
   qui stocke réellement le fichier de pilotage et exige un sha correct, comme
   le vrai. Le reste — prix modifié, livraison, photo — passe par le même
   chemin et se contrôle au passage.
   ========================================================================== */
'use strict';

const http = require('http');

/* -------------------------------------------------------------------------- */
/* Le faux GitHub                                                             */
/* -------------------------------------------------------------------------- */
const JETON = 'ghp_TESTFACTICE';
const DEPOT = 'rayan/anas-pizza-test';

const fichiers = new Map();     // chemin → { contenu: Buffer, sha }
const commits = [];             // messages, pour vérifier la traçabilité
const anomalies = [];

let compteur = 0;
const nouveauSha = () => 'sha' + (++compteur).toString(16).padStart(6, '0');
let glisserUneEcriture = false;   // voir « deux téléphones à la fois »

function fauxGitHub() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');

    if (req.headers.authorization !== 'Bearer ' + JETON) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Bad credentials' }));
    }
    if (!req.headers.accept || !/github/.test(req.headers.accept)) {
      anomalies.push('en-tête Accept absent ou inattendu : ' + req.headers.accept);
    }

    const prefixe = '/repos/' + DEPOT + '/contents/';
    if (url.pathname.indexOf(prefixe) !== 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Not Found' }));
    }
    const chemin = decodeURIComponent(url.pathname.slice(prefixe.length));

    if (req.method === 'GET') {
      const f = fichiers.get(chemin);
      if (!f) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'Not Found' }));
      }
      // Simule l'autre téléphone : quelqu'un écrit entre la lecture et
      // l'écriture. Le sha que l'on vient de renvoyer devient périmé.
      if (glisserUneEcriture && chemin === 'assets/data/pilotage.json') {
        glisserUneEcriture = false;
        fichiers.set(chemin, { contenu: f.contenu, sha: nouveauSha() });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        path: chemin, sha: f.sha, encoding: 'base64',
        content: f.contenu.toString('base64')
      }));
    }

    if (req.method === 'PUT') {
      let brut = '';
      req.on('data', (c) => { brut += c; });
      req.on('end', () => {
        let b = {};
        try { b = JSON.parse(brut); } catch (e) {
          anomalies.push('corps illisible à l’écriture');
        }
        if (!b.message) anomalies.push('commit sans message');
        if (typeof b.content !== 'string') anomalies.push('contenu absent');
        if (!b.branch) anomalies.push('branche absente');

        const existant = fichiers.get(chemin);
        // Le vrai GitHub refuse d'écraser un fichier sans son sha : c'est la
        // protection contre deux téléphones qui modifient en même temps.
        if (existant && b.sha !== existant.sha) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'sha does not match' }));
        }
        const sha = nouveauSha();
        fichiers.set(chemin, { contenu: Buffer.from(b.content, 'base64'), sha });
        commits.push(b.message);
        res.writeHead(existant ? 200 : 201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: { path: chemin, sha } }));
      });
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Method not allowed' }));
  });
}

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

let vert = 0;
const rouges = [];
function ok(nom, condition, detail) {
  if (condition) { vert++; console.log('  ok  ' + nom); }
  else { rouges.push(nom + (detail ? ' — ' + detail : '')); console.log('  KO  ' + nom + (detail ? ' — ' + detail : '')); }
}
function titre(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 42 - t.length))); }

const PROPRIO = { 'x-admin-code': 'code-proprio-test' };
const GERANT = { 'x-admin-code': 'code-gerant-test' };

/* -------------------------------------------------------------------------- */
(async function principal() {
  const serveur = fauxGitHub();
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const port = serveur.address().port;

  process.env.GITHUB_API_BASE = 'http://127.0.0.1:' + port;
  process.env.GITHUB_TOKEN = JETON;
  process.env.GITHUB_DEPOT = DEPOT;
  process.env.GITHUB_BRANCHE = 'main';
  process.env.ADMIN_CODE = 'code-proprio-test';
  process.env.ADMIN_CODE_GERANT = 'code-gerant-test';
  delete process.env.ADMIN_EDITION;         // le gérant n'a pas encore payé
  delete process.env.SUMUP_API_KEY;         // pas de recette dans ce test
  delete process.env.STRIPE_SECRET_KEY;

  const admin = require('../api/admin.js');
  const commande = require('../api/commande.js');
  const pilotagePublic = require('../api/pilotage.js');
  const { lire } = require('../api/_pilotage.js');
  const { carte } = require('../api/_panier.js');

  // Les créneaux ont leurs propres contrôles dans test-panier.js. Ici on
  // vérifie le pilotage, pas l'horloge : sans cette ouverture, tout ce
  // fichier échouerait entre 1h30 et 11h30 — c'est-à-dire la nuit où l'on
  // travaille dessus.
  carte().livraison.creneaux = { livraison: { debut: '00:00', fin: '23:59' },
                                 emporter: { debut: '00:00', fin: '23:59' } };

  // Le cache de lecture est volontairement court, mais il existe : entre deux
  // contrôles, on ne veut pas attendre quinze secondes.
  const frais = () => lire(true);

  /* --- accès ------------------------------------------------------------- */
  titre('qui entre, et qui n’entre pas');

  const inconnu = await appeler(admin, { entetes: { 'x-admin-code': 'au-hasard' } });
  ok('un code inconnu est refusé', inconnu.code === 401, JSON.stringify(inconnu.corps));

  const sansCode = await appeler(admin, {});
  ok('sans code, rien ne sort', sansCode.code === 401);

  const vueProprio = await appeler(admin, { entetes: PROPRIO });
  ok('le propriétaire entre', vueProprio.code === 200 && vueProprio.corps.profil === 'proprietaire',
    JSON.stringify(vueProprio.corps).slice(0, 120));

  const vueGerant = await appeler(admin, { entetes: GERANT });
  ok('le gérant entre', vueGerant.code === 200 && vueGerant.corps.profil === 'gerant');

  /* --- droits ------------------------------------------------------------ */
  titre('ce que chacun a le droit de faire');

  ok('le propriétaire peut tout',
    vueProprio.corps.droits.prix === true && vueProprio.corps.droits.photos === true &&
    vueProprio.corps.droits.livraison === true && vueProprio.corps.droits.service === true);

  ok('le gérant tient la boutique',
    vueGerant.corps.droits.service === true && vueGerant.corps.droits.ruptures === true);

  ok('mais pas les prix tant que le site n’est pas payé',
    vueGerant.corps.droits.prix === false && vueGerant.corps.droits.livraison === false &&
    vueGerant.corps.droits.photos === false);

  const tentative = await appeler(admin, {
    methode: 'POST', entetes: GERANT,
    corps: { action: 'prix', cle: 'cat:tomate:large', prix: 100 }
  });
  ok('et le serveur le refuse, pas seulement l’écran',
    tentative.code === 403, JSON.stringify(tentative.corps).slice(0, 120));

  const apresTentative = await frais();
  ok('rien n’a été écrit au passage',
    Object.keys(apresTentative.prix).length === 0, JSON.stringify(apresTentative.prix));

  const photoRefusee = await appeler(admin, {
    methode: 'POST', entetes: GERANT,
    corps: { action: 'photo', plat: 'tikka', image: 'data:image/jpeg;base64,' + 'A'.repeat(2000) }
  });
  ok('les photos lui sont fermées aussi', photoRefusee.code === 403);

  /* --- rupture ----------------------------------------------------------- */
  titre('une rupture arrête vraiment la commande');

  const avant = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'emporter', panier: [{ plat: 'tikka', taille: 'medium', quantite: 1, supplements: [] }],
             client: { nom: 'Anas', telephone: '0259100198' } }
  });
  ok('avant la rupture, la commande passe le calcul',
    avant.code === 503, 'code ' + avant.code + ' (503 = pas de prestataire, le calcul a réussi)');

  const decl = await appeler(admin, {
    methode: 'POST', entetes: GERANT,
    corps: { action: 'rupture', plat: 'tikka', rupture: true }
  });
  ok('le gérant peut déclarer une rupture', decl.code === 200 && decl.corps.fait === true,
    JSON.stringify(decl.corps).slice(0, 120));

  const apres = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'emporter', panier: [{ plat: 'tikka', taille: 'medium', quantite: 1, supplements: [] }],
             client: { nom: 'Anas', telephone: '0259100198' } }
  });
  ok('la commande du plat parti est refusée',
    apres.code === 422 && /plus disponible/.test(apres.corps.erreur || ''),
    JSON.stringify(apres.corps).slice(0, 140));

  const autre = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'emporter', panier: [{ plat: 'reine', taille: 'medium', quantite: 1, supplements: [] }],
             client: { nom: 'Anas', telephone: '0259100198' } }
  });
  ok('les autres plats restent commandables', autre.code === 503, 'code ' + autre.code);

  const vuePublique = await appeler(pilotagePublic, {});
  ok('la page de commande voit la rupture',
    vuePublique.code === 200 && (vuePublique.corps.ruptures || []).indexOf('tikka') !== -1,
    JSON.stringify(vuePublique.corps).slice(0, 140));

  const retour = await appeler(admin, {
    methode: 'POST', entetes: GERANT,
    corps: { action: 'rupture', plat: 'tikka', rupture: false }
  });
  ok('et le plat revient d’un second appui',
    retour.code === 200 && (retour.corps.pilotage.ruptures || []).indexOf('tikka') === -1);

  const inventé = await appeler(admin, {
    methode: 'POST', entetes: GERANT,
    corps: { action: 'rupture', plat: 'pizza-au-caviar', rupture: true }
  });
  ok('un plat inventé ne crée rien', inventé.code === 422, JSON.stringify(inventé.corps));

  /* --- fermeture --------------------------------------------------------- */
  titre('fermer la boutique à toute heure');

  const fermer = await appeler(admin, {
    methode: 'POST', entetes: GERANT,
    corps: { action: 'service', ouvert: false, motif: 'four en panne' }
  });
  ok('le gérant peut suspendre les commandes',
    fermer.code === 200 && fermer.corps.pilotage.service.ouvert === false);

  const pendant = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'emporter', panier: [{ plat: 'reine', taille: 'medium', quantite: 1, supplements: [] }],
             client: { nom: 'Anas', telephone: '0259100198' } }
  });
  ok('plus aucune commande ne passe, quelle que soit l’heure',
    pendant.code === 422 && /four en panne/.test(pendant.corps.erreur || ''),
    JSON.stringify(pendant.corps).slice(0, 140));

  const rouvrir = await appeler(admin, {
    methode: 'POST', entetes: GERANT, corps: { action: 'service', ouvert: true }
  });
  ok('et la réouverture efface le motif',
    rouvrir.code === 200 && rouvrir.corps.pilotage.service.ouvert === true &&
    rouvrir.corps.pilotage.service.motif === '');

  /* --- prix -------------------------------------------------------------- */
  titre('les prix, côté propriétaire');

  const majPrix = await appeler(admin, {
    methode: 'POST', entetes: PROPRIO,
    corps: { action: 'prix', cle: 'cat:tomate:large', prix: 1290 }
  });
  ok('le propriétaire change un prix', majPrix.code === 200,
    JSON.stringify(majPrix.corps).slice(0, 120));

  const carteApres = majPrix.corps.carte.categories.find((c) => c.id === 'tomate');
  ok('la carte renvoyée montre le nouveau prix et l’ancien',
    carteApres.tailles.find((t) => t.nom === 'Large').prix === 1290 &&
    carteApres.tailles.find((t) => t.nom === 'Large').origine === 1090);

  // La sicilienne est à base tomate : deux larges font 2 × 12,90 = 25,80,
  // au lieu de 2 × 10,90 = 21,80. Le prix suit la famille, pas la pizza.
  const facture = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'emporter', panier: [{ plat: 'sicilienne', taille: 'large', quantite: 2, supplements: [] }],
             client: { nom: 'Anas', telephone: '0259100198' } }
  });
  ok('et c’est ce prix-là qui est facturé',
    facture.code === 503 && /25,80/.test(JSON.stringify(facture.corps.recap || {})),
    JSON.stringify(facture.corps.recap || {}).slice(0, 140));

  const negatif = await appeler(admin, {
    methode: 'POST', entetes: PROPRIO, corps: { action: 'prix', cle: 'cat:tomate:large', prix: -500 }
  });
  ok('un prix négatif est refusé', negatif.code === 422);

  const inconnue = await appeler(admin, {
    methode: 'POST', entetes: PROPRIO, corps: { action: 'prix', cle: 'cat:inventée:large', prix: 500 }
  });
  ok('une clé inconnue est refusée', inconnue.code === 422);

  const remise = await appeler(admin, {
    methode: 'POST', entetes: PROPRIO, corps: { action: 'prix', cle: 'cat:tomate:large', prix: null }
  });
  ok('et le prix revient à celui de la carte',
    remise.code === 200 && remise.corps.pilotage.prix['cat:tomate:large'] === undefined &&
    remise.corps.carte.categories.find((c) => c.id === 'tomate')
      .tailles.find((t) => t.nom === 'Large').prix === 1090);

  /* --- livraison --------------------------------------------------------- */
  titre('les conditions de livraison');

  const liv = await appeler(admin, {
    methode: 'POST', entetes: PROPRIO,
    corps: { action: 'livraison', minimum: 2000, frais: 350 }
  });
  ok('le minimum et les frais se règlent', liv.code === 200 &&
    liv.corps.carte.livraison.minimum === 2000 && liv.corps.carte.livraison.frais === 350);

  const tropPetit = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'livraison', panier: [{ plat: 'reine', taille: 'medium', quantite: 2, supplements: [] }],
             client: { nom: 'Anas', telephone: '0612345678', rue: '3 rue du Test', codePostal: '44000' } }
  });
  ok('le nouveau minimum s’applique tout de suite',
    tropPetit.code === 422 && /20,00/.test(tropPetit.corps.erreur || ''),
    JSON.stringify(tropPetit.corps).slice(0, 140));

  await appeler(admin, {
    methode: 'POST', entetes: PROPRIO, corps: { action: 'livraison', minimum: 1380, frais: 299 }
  });

  /* --- photos ------------------------------------------------------------ */
  titre('les photos de plats');

  const pasUneImage = await appeler(admin, {
    methode: 'POST', entetes: PROPRIO,
    corps: { action: 'photo', plat: 'tikka', image: 'bonjour' }
  });
  ok('un fichier qui n’est pas une image est refusé', pasUneImage.code === 422);

  const minuscule = await appeler(admin, {
    methode: 'POST', entetes: PROPRIO,
    corps: { action: 'photo', plat: 'tikka', image: 'data:image/jpeg;base64,QUJD' }
  });
  ok('une image d’un octet aussi', minuscule.code === 422);

  const vraie = await appeler(admin, {
    methode: 'POST', entetes: PROPRIO,
    corps: { action: 'photo', plat: 'tikka', image: 'data:image/jpeg;base64,' + 'QUJD'.repeat(600) }
  });
  ok('une photo valable part vers le dépôt',
    vraie.code === 200 && vraie.corps.chemin === 'assets/img/plats/tikka.jpg',
    JSON.stringify(vraie.corps).slice(0, 140));

  ok('et elle y est bien arrivée', fichiers.has('assets/img/plats/tikka.jpg'));

  const remplacee = await appeler(admin, {
    methode: 'POST', entetes: PROPRIO,
    corps: { action: 'photo', plat: 'tikka', image: 'data:image/jpeg;base64,' + 'WFla'.repeat(600) }
  });
  ok('une seconde photo écrase la première sans conflit de sha', remplacee.code === 200,
    JSON.stringify(remplacee.corps).slice(0, 140));

  /* --- traçabilité ------------------------------------------------------- */
  titre('ce que le dépôt garde');

  ok('chaque changement porte le nom de son auteur',
    commits.some((m) => /gérant/.test(m)) && commits.some((m) => /propriétaire/.test(m)),
    commits.slice(0, 3).join(' / '));

  ok('et dit ce qui a changé',
    commits.some((m) => /rupture tikka/.test(m)) && commits.some((m) => /12,90/.test(m)),
    commits.filter((m) => /Pilotage/.test(m)).slice(-3).join(' / '));

  // Un changement de prix n'a pas besoin d'un déploiement : il est relu par
  // l'API dans les quinze secondes. Une photo, si — elle doit passer par
  // l'étape de construction pour être convertie.
  ok('un changement de pilotage ne redéploie pas le site',
    commits.filter((m) => /Pilotage/.test(m)).every((m) => /\[skip ci\]/.test(m)),
    commits.filter((m) => /Pilotage/.test(m)).slice(0, 2).join(' / '));

  ok('une photo, elle, déclenche bien le déploiement',
    commits.filter((m) => /^Photo/.test(m)).length > 0 &&
    commits.filter((m) => /^Photo/.test(m)).every((m) => !/\[skip ci\]/.test(m)),
    commits.filter((m) => /^Photo/.test(m)).join(' / '));

  /* --- deux téléphones à la fois ------------------------------------------ */
  titre('deux téléphones ouverts en même temps');

  // Dans un restaurant, deux personnes sur l'espace de gestion, c'est le cas
  // normal. Le danger n'est pas l'échec : c'est la réussite silencieuse, où la
  // seconde écriture efface la première sans que personne le voie.
  await appeler(admin, {
    methode: 'POST', entetes: GERANT, corps: { action: 'rupture', plat: 'wings', rupture: true }
  });

  glisserUneEcriture = true;
  const collision = await appeler(admin, {
    methode: 'POST', entetes: GERANT, corps: { action: 'rupture', plat: 'brownie', rupture: true }
  });
  ok('une écriture concurrente est refusée, pas avalée',
    collision.code === 409, 'code ' + collision.code + ' — ' + JSON.stringify(collision.corps).slice(0, 100));

  ok('et le message dit quoi faire, pas quel code HTTP',
    /réessayez/i.test(collision.corps.erreur || '') && !/409|sha/i.test(collision.corps.erreur || ''),
    collision.corps.erreur);

  const apresCollision = await frais();
  ok('et la première déclaration est toujours là',
    apresCollision.ruptures.indexOf('wings') !== -1,
    JSON.stringify(apresCollision.ruptures));

  const reprise = await appeler(admin, {
    methode: 'POST', entetes: GERANT, corps: { action: 'rupture', plat: 'brownie', rupture: true }
  });
  ok('le second appui, lui, passe',
    reprise.code === 200 && reprise.corps.pilotage.ruptures.indexOf('brownie') !== -1 &&
    reprise.corps.pilotage.ruptures.indexOf('wings') !== -1,
    JSON.stringify((reprise.corps.pilotage || {}).ruptures));

  await appeler(admin, { methode: 'POST', entetes: GERANT,
    corps: { action: 'rupture', plat: 'wings', rupture: false } });
  await appeler(admin, { methode: 'POST', entetes: GERANT,
    corps: { action: 'rupture', plat: 'brownie', rupture: false } });

  /* --- le jour où le gérant a payé --------------------------------------- */
  titre('le jour où le gérant a fini de payer');

  process.env.ADMIN_EDITION = '1';
  const gerantLibre = await appeler(admin, { entetes: GERANT });
  ok('une variable suffit à lui ouvrir les prix',
    gerantLibre.corps.droits.prix === true && gerantLibre.corps.droits.photos === true &&
    gerantLibre.corps.droits.livraison === true);

  const sonPrix = await appeler(admin, {
    methode: 'POST', entetes: GERANT, corps: { action: 'prix', cle: 'cat:tradition:medium', prix: 750 }
  });
  ok('et il peut alors les changer lui-même', sonPrix.code === 200,
    JSON.stringify(sonPrix.corps).slice(0, 120));

  await appeler(admin, {
    methode: 'POST', entetes: GERANT, corps: { action: 'prix', cle: 'cat:tradition:medium', prix: null }
  });
  delete process.env.ADMIN_EDITION;

  /* --- panne de GitHub --------------------------------------------------- */
  titre('quand GitHub ne répond plus');

  serveur.close();
  await new Promise((r) => setTimeout(r, 50));

  const pendantPanne = await appeler(commande, {
    methode: 'POST',
    corps: { mode: 'emporter', panier: [{ plat: 'reine', taille: 'medium', quantite: 1, supplements: [] }],
             client: { nom: 'Anas', telephone: '0259100198' } }
  });
  ok('le site continue de prendre les commandes',
    pendantPanne.code === 503, 'code ' + pendantPanne.code);

  /* ----------------------------------------------------------------------- */
  console.log('');
  if (anomalies.length) {
    console.log('Requêtes que le vrai GitHub aurait refusées :');
    [...new Set(anomalies)].forEach((a) => console.log('   ! ' + a));
  }
  if (rouges.length) {
    console.log('✗ ' + rouges.length + ' contrôle(s) en échec sur ' + (vert + rouges.length) + ' :');
    rouges.forEach((r) => console.log('   - ' + r));
    process.exit(1);
  }
  console.log('Tout est vert — ' + vert + ' contrôles sur l’espace de gestion.');
})().catch((e) => { console.error(e); process.exit(1); });
