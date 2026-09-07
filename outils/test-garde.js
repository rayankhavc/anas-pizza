/* ==========================================================================
   Le garde, contre quelqu'un qui essaie les codes un par un.
   --------------------------------------------------------------------------
   Une limitation de tentatives qui ne fonctionne pas est pire que pas de
   limitation du tout : elle donne la tranquillité sans la protection, et
   personne ne s'en aperçoit tant que le mal n'est pas fait. D'où ces
   contrôles, qui vérifient les trois promesses du garde plutôt que ses
   détails d'écriture :

   - un échec coûte du temps, toujours, dès le premier ;
   - au bout de dix échecs, l'adresse est refusée sans comparaison de code,
     et le refus s'allonge à chaque récidive ;
   - une adresse qui n'a rien fait n'est jamais gênée par celle d'à côté,
     tant que le seuil global n'est pas atteint.

   Le gérant qui se trompe deux fois ne doit rien voir de tout cela : c'est
   le premier contrôle, et c'est le plus important pour l'exploitation.
   ========================================================================== */
'use strict';

const garde = require('../api/_garde');

let vert = 0;
const rouges = [];

function ok(nom, condition, detail) {
  if (condition) { vert++; console.log('  ok  ' + nom); }
  else { rouges.push(nom + (detail ? ' — ' + detail : '')); console.log('  ✗   ' + nom); }
}
function titre(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 42 - t.length))); }

/** Une fausse requête, avec l'adresse qu'on veut. */
const req = (ip) => ({ headers: { 'x-forwarded-for': ip }, socket: {} });

(async () => {
  console.log('\nLe garde des codes partagés\n');

  /* --- l'exploitation d'abord -------------------------------------------- */
  titre('le gérant qui se trompe');

  const gerant = req('10.0.0.1');
  ok('la première tentative est autorisée', garde.autorise(gerant).ok);

  const avant = Date.now();
  await garde.echec(gerant);
  const coutUnEchec = Date.now() - avant;
  ok('un échec coûte au moins une seconde', coutUnEchec >= 950,
    coutUnEchec + ' ms');

  await garde.echec(gerant);
  ok('après deux erreurs, il peut toujours essayer', garde.autorise(gerant).ok);

  garde.succes(gerant);
  ok('un code juste efface les erreurs précédentes', garde.autorise(gerant).ok);

  /* --- celui qui insiste -------------------------------------------------- */
  titre('celui qui énumère');

  const pirate = req('203.0.113.7');
  for (let i = 0; i < 10; i++) await garde.echec(pirate);

  const verdict = garde.autorise(pirate);
  ok('au dixième échec, l’adresse est bloquée', !verdict.ok);
  ok('et on lui dit combien de temps', verdict.ok === false && verdict.attente > 0,
    'attente ' + verdict.attente + 's');

  const premierBlocage = verdict.attente;
  for (let i = 0; i < 10; i++) await garde.echec(pirate);
  const second = garde.autorise(pirate);
  ok('une récidive allonge le blocage', !second.ok && second.attente > premierBlocage,
    premierBlocage + 's puis ' + second.attente + 's');

  /* --- le voisin ---------------------------------------------------------- */
  titre('l’adresse d’à côté');

  ok('une autre adresse n’est pas punie pour la première',
    garde.autorise(req('10.0.0.42')).ok);

  ok('le blocage suit l’adresse, pas le serveur',
    garde.autorise(req('10.0.0.43')).ok && !garde.autorise(pirate).ok);

  /* --- l'adresse elle-même ------------------------------------------------ */
  titre('savoir à qui l’on parle');

  ok('l’adresse retenue est celle du client, pas celle du proxy',
    garde.adresse({ headers: { 'x-forwarded-for': '198.51.100.9, 10.1.1.1' }, socket: {} })
      === '198.51.100.9');

  ok('une requête sans en-tête ne fait pas tomber le garde',
    typeof garde.adresse({ headers: {}, socket: {} }) === 'string');

  /* ----------------------------------------------------------------------- */
  console.log('');
  if (rouges.length) {
    console.log('✗ ' + rouges.length + ' contrôle(s) en échec sur ' + (vert + rouges.length) + ' :');
    rouges.forEach((r) => console.log('   - ' + r));
    process.exit(1);
  }
  console.log('Tout est vert — ' + vert + ' contrôles sur le garde.');
})().catch((e) => { console.error(e); process.exit(1); });
