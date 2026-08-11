/* ==========================================================================
   Écran cuisine — Anas Pizza Original
   --------------------------------------------------------------------------
   Un écran posé au comptoir, ouvert toute la soirée. Il interroge le serveur
   toutes les quinze secondes et sonne à chaque nouvelle commande payée.

   Deux exigences qui viennent de l'usage, pas du confort :
   - l'onglet ne doit jamais se mettre en veille sans qu'on le voie : l'état
     de la connexion est affiché en permanence, y compris en cas de panne ;
   - une commande déjà préparée reste barrée après rechargement, sinon un
     écran qui redémarre fait refaire toutes les pizzas du service.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var PERIODE = 15000;
  var CODE = 'anas-cuisine-code';
  var FAITES = 'anas-cuisine-faites';
  var SERVICE = 'anas-cuisine-service';

  var code = '';
  var connues = new Set();
  var faites = new Set();
  var service = '';
  var premierTour = true;
  var son = true;

  try {
    faites = new Set(JSON.parse(localStorage.getItem(FAITES) || '[]'));
    code = localStorage.getItem(CODE) || '';
    service = localStorage.getItem(SERVICE) || '';
  } catch (e) { /* stockage refusé : on repart de zéro à chaque ouverture */ }

  function garderFaites() {
    try { localStorage.setItem(FAITES, JSON.stringify(Array.from(faites))); } catch (e) {}
  }

  /**
   * Un nouveau service efface la mémoire de l'écran.
   *
   * Le serveur ne renvoie déjà que les commandes du service en cours : les
   * cartes d'hier disparaissent toutes seules. Mais la liste des commandes
   * marquées « préparée », elle, restait dans le navigateur — jour après
   * jour, mois après mois, sans jamais être vidée. Invisible, mais elle
   * grossit sans fin, et un écran qui tourne un an finirait par traîner des
   * milliers d'identifiants morts.
   *
   * Le serveur date chaque réponse du service auquel elle appartient. Quand
   * cette date change, on repart de zéro : mémoire vide, écran vide.
   */
  function nouveauService(dit) {
    if (!dit || dit === service) return false;
    service = dit;
    faites = new Set();
    connues = new Set();
    premierTour = true;      // on ne sonne pas pour un service qui commence
    try {
      localStorage.setItem(SERVICE, service);
      localStorage.removeItem(FAITES);
    } catch (e) {}
    return true;
  }

  /* --- sonnerie : trois notes générées, aucun fichier à charger ---------- */
  var audio = null;
  function sonner() {
    if (!son) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach(function (t, i) {
        var o = audio.createOscillator();
        var g = audio.createGain();
        o.type = 'sine';
        o.frequency.value = [880, 1175, 1568][i];
        g.gain.setValueAtTime(0.0001, audio.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.16);
        o.connect(g); g.connect(audio.destination);
        o.start(audio.currentTime + t);
        o.stop(audio.currentTime + t + 0.18);
      });
    } catch (e) { /* pas de son disponible : l'affichage suffit */ }
  }

  /* --- rendu ------------------------------------------------------------ */
  function carte(c) {
    var fait = faites.has(c.id);
    return '<article class="kit__c' + (fait ? ' est-faite' : '') + '" data-id="' + c.id + '">' +
      '<header class="kit__c-h">' +
        '<span class="kit__mode kit__mode--' + c.mode + '">' +
          (c.mode === 'livraison' ? 'Livraison' : 'À emporter') + '</span>' +
        '<span class="kit__h">' + c.heure + '</span>' +
        '<span class="kit__id">#' + c.id + '</span>' +
      '</header>' +
      '<ul class="kit__art">' +
        c.articles.map(function (a) {
          return '<li><b>' + a.n + '×</b> ' + a.texte + '</li>';
        }).join('') +
      '</ul>' +
      (c.commentaire ? '<p class="kit__com">⚠ ' + c.commentaire + '</p>' : '') +
      '<footer class="kit__c-f">' +
        '<p class="kit__cli"><b>' + c.nom + '</b> · <a href="tel:' + c.telephone + '">' +
          c.telephone + '</a></p>' +
        (c.mode === 'livraison' ? '<p class="kit__adr">' + c.adresse + '</p>' : '') +
        '<p class="kit__tot">' + c.total + '</p>' +
      '</footer>' +
      '<button class="kit__ok" type="button" data-fait="' + c.id + '">' +
        (fait ? 'Remettre en attente' : 'Marquer préparée') + '</button>' +
      '</article>';
  }

  function afficher(commandes) {
    var neuves = commandes.filter(function (c) { return !connues.has(c.id); });
    commandes.forEach(function (c) { connues.add(c.id); });
    if (neuves.length && !premierTour) sonner();
    premierTour = false;

    // les commandes préparées passent en bas
    var triees = commandes.slice().sort(function (a, b) {
      var fa = faites.has(a.id) ? 1 : 0, fb = faites.has(b.id) ? 1 : 0;
      return fa - fb || b.horodatage - a.horodatage;
    });

    $('#commandes').innerHTML = triees.map(carte).join('');
    $('#vide').hidden = commandes.length > 0;
  }

  /* --- interrogation ---------------------------------------------------- */
  function etat(txt, classe) {
    var e = $('#etat');
    e.textContent = txt;
    e.className = 'kit__etat' + (classe ? ' ' + classe : '');
  }

  function tour() {
    return fetch('/api/cuisine', { headers: { 'X-Cuisine-Code': code }, cache: 'no-store' })
      .then(function (r) {
        return r.json().then(function (d) { return { statut: r.status, d: d }; });
      })
      .then(function (x) {
        if (x.statut === 401) throw Object.assign(new Error('Code incorrect.'), { acces: true });
        if (x.statut !== 200) throw new Error(x.d.erreur || 'Erreur ' + x.statut);
        nouveauService(x.d.service);
        afficher(x.d.commandes || []);
        etat('À jour · ' + new Date().toLocaleTimeString('fr-FR',
          { hour: '2-digit', minute: '2-digit', second: '2-digit' }), 'est-ok');
        return true;
      })
      .catch(function (e) {
        if (e.acces) throw e;
        // une coupure réseau ne doit pas vider l'écran : on garde l'affichage
        etat('Hors ligne — nouvelle tentative…', 'est-ko');
        return false;
      });
  }

  function demarrer() {
    $('#acces').hidden = true;
    $('#tableau').hidden = false;
    tour();
    setInterval(tour, PERIODE);
    // au retour d'un écran mis en veille, on rafraîchit sans attendre
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tour();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('.page-cuisine')) return;

    $('#acces').addEventListener('submit', function (e) {
      e.preventDefault();
      code = $('#code').value.trim();
      var err = $('#err-acces');
      err.hidden = true;
      tour().then(function () {
        try { localStorage.setItem(CODE, code); } catch (x) {}
        demarrer();
      }).catch(function (x) {
        err.textContent = x.message;
        err.hidden = false;
      });
    });

    $('#commandes').addEventListener('click', function (e) {
      var b = e.target.closest('[data-fait]');
      if (!b) return;
      var id = b.dataset.fait;
      if (faites.has(id)) faites.delete(id); else faites.add(id);
      garderFaites();
      tour();
    });

    $('#son').addEventListener('click', function () {
      son = !son;
      this.setAttribute('aria-pressed', String(son));
      this.querySelector('span').textContent = son ? 'Son' : 'Muet';
      if (son) sonner();   // confirme que le haut-parleur fonctionne
    });

    // un code déjà saisi sur cet écran évite de le retaper chaque soir
    if (code) {
      tour().then(demarrer).catch(function () { $('#code').focus(); });
    } else {
      $('#code').focus();
    }
  });
})();
