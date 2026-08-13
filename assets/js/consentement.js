/* ==========================================================================
   Bandeau de consentement — chargé uniquement si la mesure d'audience
   est activée (voir outils/mesure-audience.js).
   --------------------------------------------------------------------------
   Trois règles de la CNIL, et elles se voient dans le code :

   - refuser doit être aussi simple qu'accepter. Les deux boutons ont donc
     la même taille, la même place et le même poids visuel — pas un bouton
     plein contre un lien gris ;
   - rien n'est déposé avant la réponse. C'est déjà réglé plus haut, dans
     l'en-tête : le mode consentement de Google est posé à « refusé » avant
     le chargement de la balise. Ce fichier ne fait que relever la réponse ;
   - le choix doit pouvoir être retiré aussi facilement qu'il a été donné.
     D'où le lien « Cookies » du pied de page, qui rouvre le bandeau.

   Le refus est mémorisé comme l'acceptation. Redemander à chaque visite à
   quelqu'un qui a déjà dit non, c'est le harceler jusqu'à ce qu'il cède —
   et c'est précisément ce que la CNIL sanctionne.
   ========================================================================== */
(function () {
  'use strict';

  var CLE = 'anas-mesure';
  var reponse = null;

  try { reponse = localStorage.getItem(CLE); } catch (e) { /* stockage refusé */ }

  function retenir(valeur) {
    try { localStorage.setItem(CLE, valeur); } catch (e) {}
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        analytics_storage: valeur === 'oui' ? 'granted' : 'denied'
      });
    }
  }

  function fermer(boite) {
    boite.remove();
    // On rend le clavier à la page : sans cela, la tabulation repart du
    // début du document au lieu de reprendre où elle était.
    var lien = document.querySelector('a[href*="#cookies"]');
    if (lien) lien.focus({ preventScroll: true });
  }

  function afficher() {
    if (document.getElementById('consentement')) return;

    var b = document.createElement('div');
    b.id = 'consentement';
    b.className = 'consent';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-modal', 'false');
    b.setAttribute('aria-labelledby', 'consent-t');
    b.innerHTML =
      '<p class="consent__t" id="consent-t"><b>Mesure d’audience</b></p>' +
      '<p class="consent__d">Nous aimerions compter les visites pour savoir ce qui est utile ' +
        'sur ce site. Cela dépose un cookie. Le site fonctionne exactement pareil si vous refusez. ' +
        '<a href="politique-de-confidentialite.html#cookies">En savoir plus</a></p>' +
      '<div class="consent__b">' +
        '<button type="button" data-consent="non">Refuser</button>' +
        '<button type="button" data-consent="oui">Accepter</button>' +
      '</div>';

    b.addEventListener('click', function (e) {
      var bouton = e.target.closest('[data-consent]');
      if (!bouton) return;
      retenir(bouton.dataset.consent);
      fermer(b);
    });

    document.body.appendChild(b);
  }

  /**
   * Le lien « Cookies » du pied de page mène à la section correspondante de
   * la politique de confidentialité. Il change donc de page — c'est à
   * l'arrivée qu'il faut rouvrir le choix, pas au clic : un bandeau ajouté
   * juste avant une navigation part avec la page qu'on quitte.
   *
   * Deux cas, donc : on arrive avec « #cookies » dans l'adresse, ou on
   * clique le lien alors qu'on est déjà sur cette page — auquel cas il n'y a
   * pas de navigation, seulement un changement d'ancre.
   */
  document.addEventListener('DOMContentLoaded', function () {
    var jamaisRepondu = reponse !== 'oui' && reponse !== 'non';
    if (jamaisRepondu || location.hash === '#cookies') afficher();

    window.addEventListener('hashchange', function () {
      if (location.hash === '#cookies') afficher();
    });
  });
})();
