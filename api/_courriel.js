/* ==========================================================================
   Envoi des courriels de commande.
   --------------------------------------------------------------------------
   Deux destinataires, deux besoins différents :

   — le restaurant reçoit le ticket complet. C'est le filet : si l'écran de
     la cuisine est éteint, en veille, ou que le wifi est tombé, la commande
     arrive quand même quelque part ;
   — le client reçoit sa confirmation. C'est sa preuve. Le jour où le
     restaurant dit « on n'a rien reçu », il a le détail, l'heure et la
     référence, par écrit.

   Comme pour le paiement, le prestataire se choisit par variable
   d'environnement, sans toucher au code. Sans clé, rien n'est envoyé et
   rien ne casse : la commande est payée, l'écran cuisine l'affiche, et le
   courriel est simplement absent.

   Brevo plutôt que les autres pour une raison précise : il accepte de
   valider une simple adresse d'expéditeur, là où la plupart exigent un nom
   de domaine. Or le restaurant n'en a pas encore.
   ========================================================================== */
'use strict';

const { euros } = require('./_panier');

// Lue à chaque envoi, jamais au chargement du module : figée à l'import,
// elle dépendrait de l'ordre des « require ». Surchargeable pour les tests.
function baseBrevo() {
  return process.env.BREVO_API_BASE || 'https://api.brevo.com/v3/smtp/email';
}

/** Le service est-il configuré ? */
function courrielActif() {
  return Boolean(process.env.BREVO_API_KEY && process.env.EMAIL_EXPEDITEUR);
}

function echapper(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Une adresse plausible, sans prétendre valider ce qui ne se valide pas.
 * On refuse ce qui est manifestement faux ; le reste, seul l'envoi le dira.
 */
function adresseValide(a) {
  const s = String(a || '').trim();
  return s.length >= 6 && s.length <= 120 && /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(s);
}

/* -------------------------------------------------------------------------- */
/* Mise en forme                                                              */
/* -------------------------------------------------------------------------- */
function lignesTexte(c) {
  return (c.articles || []).map((a) => '  ' + a.n + ' × ' + a.texte).join('\n');
}

function lignesHtml(c) {
  return (c.articles || []).map((a) =>
    '<tr><td style="padding:6px 10px 6px 0;white-space:nowrap;vertical-align:top">' +
    '<b>' + a.n + ' ×</b></td><td style="padding:6px 0">' + echapper(a.texte) + '</td></tr>'
  ).join('');
}

function cadre(titre, corps, pied) {
  return '<div style="font:15px/1.55 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;' +
    'color:#1B2432;max-width:560px;margin:0 auto;padding:24px">' +
    '<h1 style="font-size:20px;margin:0 0 4px">' + titre + '</h1>' + corps +
    (pied ? '<p style="margin-top:24px;padding-top:14px;border-top:1px solid #E6EAF0;' +
      'font-size:13px;color:#6B7684">' + pied + '</p>' : '') +
    '</div>';
}

/** Le ticket, pour la cuisine. Sobre et complet : il sera lu vite. */
function pourRestaurant(c) {
  const mode = c.mode === 'livraison' ? 'LIVRAISON' : 'À EMPORTER';
  const sujet = mode + ' · ' + c.total + ' · ' + (c.nom || 'client') +
    ' · réf. ' + c.id;

  const texte = [
    mode + ' — ' + c.heure,
    'Référence : ' + c.id,
    '',
    lignesTexte(c),
    '',
    'Total payé : ' + c.total,
    '',
    'Client : ' + (c.nom || '—') + '  ' + (c.telephone || '—'),
    c.mode === 'livraison' ? 'Adresse : ' + (c.adresse || '—') : 'Retrait sur place',
    c.commentaire ? 'Note du client : ' + c.commentaire : '',
    '',
    'Cette commande est déjà payée.'
  ].filter((l) => l !== '').join('\n');

  const html = cadre(
    mode + ' — ' + echapper(c.total),
    '<p style="margin:0 0 16px;color:#6B7684">' + echapper(c.heure) +
      ' · référence <b style="color:#1B2432">' + echapper(c.id) + '</b></p>' +
    '<table style="width:100%;border-collapse:collapse;border-top:2px solid #1B2432;' +
      'border-bottom:2px solid #1B2432">' + lignesHtml(c) + '</table>' +
    '<p style="font-size:18px;margin:14px 0 20px"><b>Total payé : ' + echapper(c.total) + '</b></p>' +
    '<p style="margin:0 0 4px"><b>' + echapper(c.nom || '—') + '</b> · ' +
      '<a href="tel:' + echapper(c.telephone) + '" style="color:#C1440E">' +
      echapper(c.telephone || '—') + '</a></p>' +
    (c.mode === 'livraison'
      ? '<p style="margin:0">' + echapper(c.adresse || '—') + '</p>'
      : '<p style="margin:0">Retrait sur place</p>') +
    (c.commentaire
      ? '<p style="margin:14px 0 0;padding:10px 12px;background:#FDF6EF;' +
        'border-left:3px solid #C1440E"><b>Note :</b> ' + echapper(c.commentaire) + '</p>'
      : ''),
    'Cette commande est déjà payée. Envoyé automatiquement par le site.');

  return { sujet, texte, html };
}

/** La confirmation, pour le client. C'est sa preuve : elle porte tout. */
function pourClient(c) {
  const sujet = 'Votre commande Anas Pizza — ' + c.total + ' (réf. ' + c.id + ')';

  const texte = [
    'Merci ' + (c.nom || '') + ', votre commande est confirmée et payée.',
    '',
    'Référence : ' + c.id,
    'Passée à : ' + c.heure,
    '',
    lignesTexte(c),
    '',
    'Total payé : ' + c.total,
    '',
    c.mode === 'livraison'
      ? 'Livraison à : ' + (c.adresse || '—')
      : 'À retirer : 10 allée Duguay Trouin, 44000 Nantes',
    '',
    'Une question sur votre commande : 02 59 10 01 98.',
    'Gardez ce message, il vaut preuve de votre commande.'
  ].filter((l) => l !== '').join('\n');

  const html = cadre(
    'Votre commande est confirmée',
    '<p style="margin:0 0 16px;color:#6B7684">Merci ' + echapper(c.nom || '') +
      '. Elle est payée, le restaurant l’a reçue.</p>' +
    '<p style="margin:0 0 16px;padding:12px 14px;background:#F7F8FA;border-radius:6px">' +
      'Référence <b style="font-size:18px">' + echapper(c.id) + '</b><br>' +
      '<span style="color:#6B7684">Passée à ' + echapper(c.heure) + '</span></p>' +
    '<table style="width:100%;border-collapse:collapse;border-top:2px solid #1B2432;' +
      'border-bottom:2px solid #1B2432">' + lignesHtml(c) + '</table>' +
    '<p style="font-size:18px;margin:14px 0 20px"><b>Total payé : ' + echapper(c.total) + '</b></p>' +
    (c.mode === 'livraison'
      ? '<p style="margin:0"><b>Livraison à</b><br>' + echapper(c.adresse || '—') + '</p>'
      : '<p style="margin:0"><b>À retirer sur place</b><br>10 allée Duguay Trouin, 44000 Nantes</p>') +
    '<p style="margin:20px 0 0">Une question&nbsp;? <a href="tel:+33259100198" ' +
      'style="color:#C1440E">02 59 10 01 98</a></p>',
    'Gardez ce message : il vaut preuve de votre commande. ' +
    'Anas Pizza Original — 10 allée Duguay Trouin, 44000 Nantes.');

  return { sujet, texte, html };
}

/* -------------------------------------------------------------------------- */
/* Envoi                                                                      */
/* -------------------------------------------------------------------------- */
async function envoyer(destinataire, message) {
  const r = await fetch(baseBrevo(), {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      sender: {
        email: process.env.EMAIL_EXPEDITEUR,
        name: process.env.EMAIL_NOM || 'Anas Pizza Original'
      },
      to: [{ email: destinataire }],
      subject: message.sujet,
      textContent: message.texte,
      htmlContent: message.html
    })
  });

  if (!r.ok) {
    const brut = await r.text().catch(() => '');
    throw new Error('Brevo ' + r.status + ' ' +
      brut.replace(/\s+/g, ' ').slice(0, 200));
  }
}

/**
 * Prévient le restaurant, et le client s'il a laissé une adresse.
 *
 * Un échec d'envoi ne remonte jamais au client : sa commande est payée et
 * l'écran de la cuisine l'affiche. Lui dire « erreur » à ce moment-là ne
 * ferait que l'inquiéter pour un courriel. On journalise, et on continue.
 *
 * @returns {{restaurant:boolean, client:boolean, motifs:string[]}}
 */
async function prevenir(commande, emailClient) {
  const bilan = { restaurant: false, client: false, motifs: [] };
  if (!courrielActif()) {
    bilan.motifs.push('courriel non configuré');
    return bilan;
  }

  const resto = process.env.EMAIL_RESTAURANT;
  if (adresseValide(resto)) {
    try {
      await envoyer(resto, pourRestaurant(commande));
      bilan.restaurant = true;
    } catch (e) {
      bilan.motifs.push('restaurant : ' + e.message);
    }
  } else {
    bilan.motifs.push('EMAIL_RESTAURANT absent ou invalide');
  }

  if (adresseValide(emailClient)) {
    try {
      await envoyer(String(emailClient).trim(), pourClient(commande));
      bilan.client = true;
    } catch (e) {
      bilan.motifs.push('client : ' + e.message);
    }
  }

  return bilan;
}

module.exports = { prevenir, courrielActif, adresseValide,
  pourRestaurant, pourClient };
