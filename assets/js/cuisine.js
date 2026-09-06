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

  /* --- sonnerie : quatre notes générées, aucun fichier à charger --------- */
  var audio = null;

  /**
   * Réveille le moteur audio du navigateur.
   *
   * Un contexte audio créé sans que personne n'ait touché la page démarre
   * « suspendu » : les oscillateurs tournent, et il ne sort rien. Aucune
   * erreur, aucun message — juste le silence. C'est le défaut qui a fait
   * croire au restaurant que la sonnerie n'existait pas.
   *
   * On l'ouvre donc dès la saisie du code, qui est un geste de l'utilisateur,
   * et on le relance à chaque fois par précaution : un onglet mis en veille
   * revient parfois suspendu.
   */
  function reveiller() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      return true;
    } catch (e) {
      return false;   // pas de son disponible : l'alerte visuelle prend le relais
    }
  }

  function sonner() {
    if (!son || !reveiller()) return;
    try {
      // Quatre notes montantes plutôt que trois, et deux fois plus fort : à
      // vingt heures, dans une cuisine, un tintement discret ne s'entend pas.
      [0, 0.15, 0.30, 0.45].forEach(function (t, i) {
        var o = audio.createOscillator();
        var g = audio.createGain();
        o.type = 'sine';
        o.frequency.value = [880, 1175, 1568, 2093][i];
        g.gain.setValueAtTime(0.0001, audio.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.5, audio.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.18);
        o.connect(g); g.connect(audio.destination);
        o.start(audio.currentTime + t);
        o.stop(audio.currentTime + t + 0.2);
      });
    } catch (e) { /* pas de son disponible : l'affichage suffit */ }
  }

  /* --- l'alerte insiste jusqu'à ce que quelqu'un la voie ----------------- */

  /**
   * Une commande ratée, c'est une pizza payée que personne ne prépare. Un
   * seul tintement au moment précis où le four s'ouvre ne suffit pas : on
   * répète toutes les vingt secondes, et on arrête au premier geste sur
   * l'écran — toucher la page, c'est être devant.
   *
   * La répétition s'arrête d'elle-même au bout de cinq minutes. Passé ce
   * délai, personne n'est là, et une sonnerie qui hurle toute la nuit finit
   * par être coupée pour de bon — ce qui coûterait bien plus cher qu'une
   * alerte manquée. Le bandeau et le titre de l'onglet, eux, restent.
   */
  var RAPPEL = 20000;
  var MAX_RAPPELS = 15;          // cinq minutes
  var neuves = new Set();        // commandes vues mais pas encore acquittées
  var rappel = null;
  var rappelsFaits = 0;
  var titreOrigine = document.title;
  var clignote = null;

  function bandeau() {
    var b = $('#alerte');
    if (!b) return;
    var n = neuves.size;
    if (!n) { b.hidden = true; return; }
    b.textContent = n === 1
      ? '🔔 Nouvelle commande — touchez l’écran'
      : '🔔 ' + n + ' nouvelles commandes — touchez l’écran';
    b.hidden = false;
  }

  function titreAlerte() {
    clearInterval(clignote);
    if (!neuves.size) { document.title = titreOrigine; clignote = null; return; }
    var alt = false;
    clignote = setInterval(function () {
      alt = !alt;
      document.title = alt
        ? '(' + neuves.size + ') NOUVELLE COMMANDE'
        : titreOrigine;
    }, 1000);
  }

  function declencherAlerte() {
    bandeau();
    titreAlerte();
    sonner();
    rappelsFaits = 0;
    clearInterval(rappel);
    rappel = setInterval(function () {
      if (!neuves.size || ++rappelsFaits >= MAX_RAPPELS) {
        clearInterval(rappel); rappel = null; return;
      }
      sonner();
    }, RAPPEL);
  }

  function arreterAlerte() {
    if (!neuves.size) return;
    neuves.clear();
    clearInterval(rappel); rappel = null;
    bandeau();
    titreAlerte();
    // Les cartes ne se redessinent qu'au tour suivant : sans ce nettoyage,
    // une carte continuerait de battre jusqu'à quinze secondes après qu'on
    // a acquitté l'alerte. Le bandeau dit « vu », la carte dirait « pas vu ».
    Array.prototype.forEach.call(
      document.querySelectorAll('.kit__c.est-neuve'),
      function (el) { el.classList.remove('est-neuve'); }
    );
  }

  /* --- l'écran ne doit pas s'endormir ------------------------------------ */

  /**
   * Un téléphone posé au comptoir se verrouille au bout d'une minute. Écran
   * éteint, le navigateur gèle les minuteries : la page cesse d'interroger le
   * serveur, donc elle ne sonne plus. Elle rattrape au réveil, sans un bruit.
   *
   * C'est la première cause d'alerte manquée, et elle ne se voit pas — tout a
   * l'air de marcher quand on regarde l'écran. Le verrou de réveil demande au
   * système de garder l'écran allumé tant que la page est ouverte.
   */
  var verrou = null;
  function garderEcranAllume() {
    if (!navigator.wakeLock || verrou) return;
    navigator.wakeLock.request('screen').then(function (v) {
      verrou = v;
      v.addEventListener('release', function () { verrou = null; });
    }).catch(function () { /* refusé ou indisponible : on continue sans */ });
  }

  /* --- rendu ------------------------------------------------------------ */
  function carte(c) {
    var fait = faites.has(c.id);
    // Une carte non acquittée est signalée aussi à l'œil : si le haut-parleur
    // est coupé ou couvert par le bruit, c'est le regard qui rattrape.
    var neuve = neuves.has(c.id) && !fait;
    return '<article class="kit__c' + (fait ? ' est-faite' : '') +
      (neuve ? ' est-neuve' : '') + '" data-id="' + c.id + '">' +
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
    var arrivees = commandes.filter(function (c) { return !connues.has(c.id); });
    commandes.forEach(function (c) { connues.add(c.id); });

    if (arrivees.length && !premierTour) {
      arrivees.forEach(function (c) { neuves.add(c.id); });
      declencherAlerte();
    }
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
    garderEcranAllume();
    tour();
    setInterval(tour, PERIODE);

    // Au retour d'un écran mis en veille : on rafraîchit sans attendre, et on
    // reprend le verrou d'écran — le système le relâche à chaque veille, il
    // ne se redemande pas tout seul.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      garderEcranAllume();
      tour();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('.page-cuisine')) return;

    // Toucher l'écran, c'est être devant : l'alerte s'arrête. En phase de
    // capture, pour que le geste compte même s'il atterrit sur un bouton qui
    // fait autre chose.
    //
    // Le même geste rouvre le moteur audio. C'est indispensable le soir où
    // l'écran redémarre tout seul avec le code déjà en mémoire : personne ne
    // saisit rien, la page s'ouvre sans le moindre geste, et le son resterait
    // muet jusqu'au premier contact.
    function geste() {
      reveiller();
      arreterAlerte();
    }
    ['pointerdown', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, geste, true);
    });

    $('#acces').addEventListener('submit', function (e) {
      e.preventDefault();
      // La saisie du code est le premier geste de la soirée : c'est le seul
      // moment garanti pour ouvrir le moteur audio, que les navigateurs
      // refusent d'activer sans une action de l'utilisateur.
      reveiller();
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
      neuves.delete(id);
      garderFaites();
      tour();
    });

    // Ce bouton fait deux choses d'un seul appui : il coupe ou remet la
    // sonnerie, et il l'essaie. C'est le geste à faire en ouvrant l'écran —
    // entendre les quatre notes prouve que le haut-parleur marche, que le
    // volume est monté et que le téléphone n'est pas en mode silencieux.
    $('#son').addEventListener('click', function () {
      son = !son;
      this.setAttribute('aria-pressed', String(son));
      this.querySelector('span').textContent = son ? 'Son' : 'Muet';
      if (son) sonner();
    });

    // un code déjà saisi sur cet écran évite de le retaper chaque soir
    if (code) {
      tour().then(demarrer).catch(function () { $('#code').focus(); });
    } else {
      $('#code').focus();
    }
  });
})();
