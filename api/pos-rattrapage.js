/* ==========================================================================
   GET /api/pos-rattrapage — verser les commandes payées dans la caisse SumUp.
   --------------------------------------------------------------------------
   Appelé toutes les minutes par une tâche planifiée. Il regarde les commandes
   payées du service, demande à la caisse celles qu'elle a déjà, et n'envoie
   que la différence.

   Pourquoi par une tâche planifiée et pas au moment du paiement ? Parce que
   le seul instant où notre serveur apprend qu'un paiement a abouti, c'est le
   retour du client sur la page de confirmation. Un client qui ferme l'onglet
   en sortant de la page bancaire — ce qui arrive tous les jours — et la
   commande n'arriverait jamais en cuisine. Une pizza payée que personne ne
   prépare, c'est exactement la panne qu'on vient de corriger ailleurs.

   La tâche, elle, ne dépend du navigateur de personne. Elle rattrape aussi
   les commandes passées pendant une coupure de la caisse, sans rien avoir à
   mémoriser : la caisse est la seule source de vérité sur ce qu'elle a reçu.
   Relancer cet appel dix fois de suite n'envoie rien en double.
   ========================================================================== */
'use strict';

const { prestataire, commandesPayees } = require('./_paiement');
const { posConfigure, envoyerVente, referencesEnvoyees } = require('./_pos');
const { debutService } = require('./cuisine');

function json(res, code, corps) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corps));
}

// Comparaison à durée constante : même sur une clé de service, une
// comparaison naïve se devine caractère par caractère en mesurant le temps.
function memeCle(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

module.exports = async function handler(req, res) {
  const attendue = process.env.POS_RATTRAPAGE_CLE;
  if (!attendue) {
    return json(res, 503, { erreur: 'Rattrapage non configuré (POS_RATTRAPAGE_CLE absent).' });
  }

  // Vercel envoie « Authorization: Bearer … » sur ses tâches planifiées ; un
  // service de ping extérieur passera plutôt par l'adresse. On accepte les
  // deux, pour ne pas dépendre d'une formule d'abonnement.
  const url = new URL(req.url, 'http://x');
  const fournie = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
    url.searchParams.get('cle') || '';
  if (!memeCle(fournie, attendue)) {
    return json(res, 401, { erreur: 'Clé incorrecte.' });
  }

  if (!prestataire()) return json(res, 200, { actif: false, motif: 'paiement non branché' });
  if (!posConfigure()) return json(res, 200, { actif: false, motif: 'caisse non branchée' });

  const depuis = debutService();

  let payees, deja;
  try {
    payees = await commandesPayees(depuis);
  } catch (e) {
    console.error('[rattrapage] lecture des paiements : ' + e.message);
    return json(res, 502, { erreur: 'Prestataire de paiement injoignable.' });
  }
  try {
    deja = await referencesEnvoyees();
  } catch (e) {
    console.error('[rattrapage] lecture de la caisse : ' + e.message);
    return json(res, 502, { erreur: 'Caisse injoignable.' });
  }

  const manquantes = payees.filter((c) => !deja.has(String(c.id)));

  const envoyees = [];
  const echecs = [];
  for (const c of manquantes) {
    try {
      await envoyerVente(c);
      envoyees.push(c.id);
      console.log('[rattrapage] ' + c.id + ' — versée en caisse');
    } catch (e) {
      // On continue : une commande refusée ne doit pas bloquer les suivantes.
      // Elle sera retentée à la minute d'après, et le refus est écrit noir sur
      // blanc pour qu'on sache lequel des deux côtés corriger.
      echecs.push({ id: c.id, motif: e.message });
      console.error('[rattrapage] ' + c.id + ' — refusée : ' + e.message);
    }
  }

  return json(res, 200, {
    actif: true,
    service: new Date(depuis * 1000).toISOString(),
    payees: payees.length,
    deja: deja.size,
    envoyees,
    echecs
  });
};
