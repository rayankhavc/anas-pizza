/* ==========================================================================
   Ce que le site rapporte — quatre gestes, pas quarante.
   --------------------------------------------------------------------------
   Google Analytics compte tout seul les visites, les pages et la provenance.
   Il ne compte pas ce qui, dans une pizzeria, décide de la journée : qui a
   appuyé sur le numéro de téléphone. Ça, il faut le lui dire.

   Quatre événements, choisis parce qu'ils répondent chacun à une question
   qu'on se pose vraiment :

     clic_telephone     — combien d'appels le site déclenche.
                          C'est la vraie conversion : la plupart des
                          commandes passent encore par le téléphone.
     clic_commander     — combien de gens ont eu l'intention de commander.
     commande_demarree  — combien sont vraiment entrés dans le tunnel.
                          L'écart avec le précédent dit si la page rebute.
     clic_itineraire    — combien viennent sur place.

   Les commandes payées ne sont pas ici : elles sont déjà chez le
   prestataire de paiement, avec le montant exact. Les compter deux fois,
   c'est se donner deux chiffres qui finiront par diverger.

   Aucun envoi tant que le visiteur n'a pas accepté la mesure. La politique
   de confidentialité l'écrit ; ce fichier le fait.
   ========================================================================== */
(function () {
  'use strict';

  var CLE = 'anas-mesure';

  function accepte() {
    try { return localStorage.getItem(CLE) === 'oui'; } catch (e) { return false; }
  }

  /**
   * Envoie un événement, si et seulement si la mesure est acceptée.
   * Le libellé dit où l'on a cliqué — en-tête, barre du bas, pied de page —
   * parce que « 40 appels » sans savoir d'où ils partent ne dit pas quel
   * bouton garder.
   */
  function noter(nom, ou) {
    if (!accepte() || typeof window.gtag !== 'function') return;
    window.gtag('event', nom, ou ? { emplacement: ou } : {});
  }

  /** D'où vient ce clic, en français lisible dans les rapports. */
  function emplacement(el) {
    if (el.closest('.actionbar')) return 'barre du bas';
    if (el.closest('.header')) return 'en-tête';
    if (el.closest('.drawer')) return 'menu';
    if (el.closest('.footer')) return 'pied de page';
    if (el.closest('.hero')) return 'haut de page';
    return 'page';
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a, button');
    if (!a) return;

    var href = a.getAttribute('href') || '';

    if (href.indexOf('tel:') === 0) {
      return noter('clic_telephone', emplacement(a));
    }
    if (/(^|\/)commander(\.html)?($|[?#])/.test(href)) {
      return noter('clic_commander', emplacement(a));
    }
    if (href.indexOf('google.com/maps') !== -1) {
      return noter('clic_itineraire', emplacement(a));
    }

    // Le choix du mode ouvre le tunnel de commande. On le note une seule
    // fois par page : quelqu'un qui hésite entre livraison et retrait n'a
    // pas démarré deux commandes.
    var mode = a.dataset && a.dataset.mode;
    if (mode && a.classList.contains('mode') && !a.disabled && !noter.demarree) {
      noter.demarree = true;
      return noter('commande_demarree', mode === 'livraison' ? 'livraison' : 'à emporter');
    }
  });
})();
