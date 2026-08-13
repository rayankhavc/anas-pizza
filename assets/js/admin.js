/* ==========================================================================
   Espace de gestion — Anas Pizza Original
   --------------------------------------------------------------------------
   Un écran de téléphone, tenu d'une main, souvent derrière un comptoir. Trois
   règles en découlent :

   - toute action est un seul appui, jamais un formulaire à valider — sauf les
     prix, où l'on veut justement que la main hésite ;
   - le serveur décide seul de ce qui est permis : cette page cache les blocs
     interdits pour ne pas encombrer, mais un bloc caché n'est pas une
     protection, c'est du rangement ;
   - rien n'est enregistré ici. L'état affiché est toujours celui que le
     serveur vient de renvoyer, jamais celui qu'on espère.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var CODE = 'anas-admin-code';

  var code = '';
  var etat = null;          // dernière réponse complète du serveur
  var photoChoisie = null;  // data URL prête à partir

  try { code = sessionStorage.getItem(CODE) || ''; } catch (e) {}

  /* --- dialogue avec le serveur ----------------------------------------- */

  function appeler(methode, corps) {
    return fetch('/api/admin', {
      method: methode,
      headers: {
        'X-Admin-Code': code,
        'Content-Type': 'application/json'
      },
      cache: 'no-store',
      body: corps ? JSON.stringify(corps) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401) throw Object.assign(new Error('Code incorrect.'), { acces: true });
        if (!r.ok) throw new Error(d.erreur || 'Erreur ' + r.status);
        return d;
      });
    });
  }

  function dire(texte, mauvais) {
    var n = $('#note');
    n.textContent = texte;
    n.className = 'adm__note' + (mauvais ? ' est-ko' : ' est-ok');
    n.hidden = false;
    clearTimeout(dire.t);
    dire.t = setTimeout(function () { n.hidden = true; }, 6000);
  }

  /** Envoie une action, puis redessine à partir de la réponse. */
  function agir(corps, resume) {
    return appeler('POST', corps).then(function (d) {
      if (d.carte) { etat.carte = d.carte; etat.pilotage = d.pilotage; }
      dessiner();
      dire(d.message || resume || 'Enregistré.');
      return d;
    }).catch(function (e) {
      if (e.acces) return deconnecter(e.message);
      dire(e.message, true);
      dessiner();   // l'affichage revient à l'état réel du serveur
      throw e;
    });
  }

  /* --- prix : centimes d'un côté, euros de l'autre ---------------------- */

  var euros = function (c) { return (c / 100).toFixed(2).replace('.', ',') + ' €'; };

  /**
   * Lit un prix tapé à la main.
   * « 12 », « 12,5 », « 12.50 » et « 12,50 € » donnent tous 1250. Un gérant
   * ne tape pas des centimes, il tape le prix qu'il affiche en vitrine.
   * @returns {number|null} null si la saisie n'est pas un prix
   */
  function enCentimes(txt) {
    var t = String(txt || '').replace(/[^\d,.]/g, '').replace(',', '.');
    if (!t || !/^\d+(\.\d{0,2})?$/.test(t)) return null;
    return Math.round(parseFloat(t) * 100);
  }

  /* --- rendu ------------------------------------------------------------ */

  function echapper(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function dessinerService() {
    var s = etat.pilotage.service;
    var ouvert = s.ouvert !== false;
    $('#service').innerHTML =
      '<p class="adm__feu ' + (ouvert ? 'est-ouvert' : 'est-ferme') + '">' +
        (ouvert
          ? 'Les commandes en ligne sont <b>ouvertes</b>, aux horaires habituels.'
          : 'Les commandes en ligne sont <b>suspendues</b>.' +
            (s.motif ? ' <span class="adm__motif">« ' + echapper(s.motif) + ' »</span>' : '')) +
      '</p>' +
      (ouvert
        ? '<p class="champ"><label for="motif">Motif affiché aux clients (facultatif)</label>' +
          '<input id="motif" type="text" maxlength="160" placeholder="Ex. : fermeture exceptionnelle" autocomplete="off"></p>' +
          '<button class="btn btn--sm btn--danger" type="button" id="fermer">Suspendre les commandes</button>'
        : '<button class="btn btn--sm" type="button" id="ouvrir">Rouvrir les commandes</button>');

    var f = $('#fermer');
    if (f) f.addEventListener('click', function () {
      agir({ action: 'service', ouvert: false, motif: ($('#motif') || {}).value || '' });
    });
    var o = $('#ouvrir');
    if (o) o.addEventListener('click', function () {
      agir({ action: 'service', ouvert: true });
    });
  }

  function dessinerRecette() {
    var r = etat.recette || {};
    if (!r.disponible) {
      $('#recette').innerHTML = '<p class="adm__aide">' +
        echapper(r.erreur || 'Chiffre du jour indisponible.') + '</p>';
      return;
    }
    $('#recette').innerHTML =
      '<dl class="adm__chiffres">' +
        '<div><dt>Commandes du service</dt><dd>' + r.commandes + '</dd></div>' +
        '<div><dt>dont livraisons</dt><dd>' + r.livraisons + '</dd></div>' +
        '<div><dt>Encaissé en ligne</dt><dd>' + echapper(r.total) + '</dd></div>' +
      '</dl>' +
      '<p class="adm__aide">Commandes payées en ligne depuis l’ouverture du service. ' +
      'Les encaissements au comptoir ne sont pas comptés ici.</p>';
  }

  function dessinerRuptures() {
    var filtre = ($('#cherche-plat').value || '').trim().toLowerCase();
    var html = etat.carte.categories.map(function (cat) {
      var plats = cat.plats.filter(function (p) {
        return !filtre || p.nom.toLowerCase().indexOf(filtre) !== -1;
      });
      if (!plats.length) return '';
      return '<div class="adm__cat"><h3>' + echapper(cat.nom) + '</h3><div class="adm__plats">' +
        plats.map(function (p) {
          return '<button class="adm__plat' + (p.rupture ? ' est-rupture' : '') + '" type="button" ' +
            'data-plat="' + echapper(p.id) + '" data-rupture="' + (p.rupture ? '0' : '1') + '" ' +
            'aria-pressed="' + (p.rupture ? 'true' : 'false') + '">' +
            echapper(p.nom) + '</button>';
        }).join('') +
      '</div></div>';
    }).join('');
    $('#ruptures').innerHTML = html || '<p class="adm__aide">Aucun plat ne correspond.</p>';
  }

  /**
   * Une ligne de prix.
   * @param {Object} x  { cle, nom, prix, origine, complet? }
   * `complet` sert d'étiquette parlée : à l'écran, le titre de la famille est
   * juste au-dessus et « Large » suffit, mais lu à voix haute hors contexte,
   * « Large » ne veut rien dire.
   */
  function ligneprix(x) {
    var change = x.prix !== x.origine;
    return '<div class="adm__prix-l' + (change ? ' est-change' : '') + '">' +
      '<span class="adm__prix-n">' + echapper(x.nom) + '</span>' +
      '<span class="adm__prix-v">' +
        '<input class="adm__prix-c" type="text" inputmode="decimal" autocomplete="off" ' +
          'data-cle="' + echapper(x.cle) + '" value="' + euros(x.prix).replace(' €', '') + '" ' +
          'aria-label="Prix de ' + echapper(x.complet || x.nom) + ', en euros">' +
        '<span class="adm__prix-u" aria-hidden="true">€</span>' +
      '</span>' +
      (change
        ? '<button class="adm__prix-r" type="button" data-remettre="' + echapper(x.cle) + '" ' +
          'title="Revenir au prix d’origine">↺ revenir à ' + euros(x.origine) + '</button>'
        : '') +
    '</div>';
  }

  function dessinerPrix() {
    if (!etat.droits.prix) {
      $('#bloc-prix').hidden = true;
      $('#bloc-livraison').hidden = true;
      return;
    }
    $('#bloc-prix').hidden = false;
    $('#bloc-livraison').hidden = false;
    $('#aide-prix').textContent =
      'Toutes les pizzas d’une même famille partagent le même prix. Modifier ' +
      '« Tomate — Large » modifie donc les douze pizzas à base tomate.';

    var html = etat.carte.categories.map(function (cat) {
      var lignes = cat.type === 'pizza'
        ? cat.tailles.map(function (t) {
            return ligneprix({ cle: t.cle, nom: t.nom, complet: cat.nom + ' — ' + t.nom,
                               prix: t.prix, origine: t.origine });
          })
        : cat.plats.map(function (p) {
            return ligneprix({ cle: p.cle, nom: p.nom, prix: p.prix, origine: p.origine });
          });
      return '<div class="adm__cat"><h3>' + echapper(cat.nom) + '</h3>' + lignes.join('') + '</div>';
    }).join('');

    html += '<div class="adm__cat"><h3>Suppléments</h3>' +
      etat.carte.supplements.map(ligneprix).join('') + '</div>';

    $('#prix').innerHTML = html;

    var l = etat.carte.livraison;
    $('#l-min').value = euros(l.minimum).replace(' €', '');
    $('#l-frais').value = euros(l.frais).replace(' €', '');
  }

  function dessinerPhotos() {
    if (!etat.droits.photos) { $('#bloc-photos').hidden = true; return; }
    $('#bloc-photos').hidden = false;
    if ($('#photo-plat').options.length) return;   // la liste ne bouge pas

    // Les photos du restaurant d'abord : ce sont celles qu'on change le plus
    // souvent, et les seules qu'un client voit avant d'avoir faim.
    var html = '<optgroup label="Photos du restaurant">' +
      (etat.scenes || []).map(function (s) {
        return '<option value="' + echapper(s.id) + '">' + echapper(s.nom) + '</option>';
      }).join('') + '</optgroup>';

    html += etat.carte.categories.map(function (cat) {
      return '<optgroup label="' + echapper(cat.nom) + '">' +
        cat.plats.map(function (p) {
          return '<option value="' + echapper(p.id) + '">' + echapper(p.nom) + '</option>';
        }).join('') + '</optgroup>';
    }).join('');
    $('#photo-plat').innerHTML = html;
  }

  function dessiner() {
    dessinerService();
    dessinerRecette();
    dessinerRuptures();
    dessinerPrix();
    dessinerPhotos();

    if (!etat.publication) {
      dire('Les modifications ne peuvent pas être publiées : il manque la clé ' +
           'GitHub dans les réglages du site.', true);
    }
  }

  /* --- photos : réduction dans le navigateur ---------------------------- */

  /**
   * Réduit une photo avant l'envoi.
   *
   * Une photo de téléphone pèse quatre mégaoctets pour 4 000 pixels de large ;
   * le site l'affiche sur 720. L'envoyer entière, c'est faire payer au gérant
   * trente secondes de données mobiles pour rien, et risquer un refus du
   * serveur au bout. La réduction se fait donc ici, où l'image est déjà
   * chargée, et non à l'arrivée.
   */
  function reduire(fichier) {
    return new Promise(function (ok, non) {
      var url = URL.createObjectURL(fichier);
      var img = new Image();
      img.onload = function () {
        var LARGE = 1280;
        var w = img.naturalWidth, h = img.naturalHeight;
        if (w > LARGE) { h = Math.round(h * LARGE / w); w = LARGE; }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try {
          ok(c.toDataURL('image/jpeg', 0.82));
        } catch (e) {
          non(new Error('Photo illisible.'));
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        non(new Error('Ce fichier n’est pas une image.'));
      };
      img.src = url;
    });
  }

  /* --- session ---------------------------------------------------------- */

  function deconnecter(message) {
    code = '';
    etat = null;
    try { sessionStorage.removeItem(CODE); } catch (e) {}
    $('#bord').hidden = true;
    $('#profil').hidden = true;
    $('#sortir').hidden = true;
    $('#acces').hidden = false;
    if (message) {
      $('#err-acces').textContent = message;
      $('#err-acces').hidden = false;
    }
    $('#code').focus();
  }

  function entrer() {
    return appeler('GET').then(function (d) {
      etat = d;
      try { sessionStorage.setItem(CODE, code); } catch (e) {}
      $('#acces').hidden = true;
      $('#bord').hidden = false;
      $('#profil').textContent = d.titre;
      $('#profil').hidden = false;
      $('#sortir').hidden = false;
      dessiner();
    });
  }

  /* --- branchements ----------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('.page-admin')) return;

    $('#acces').addEventListener('submit', function (e) {
      e.preventDefault();
      code = $('#code').value.trim();
      $('#err-acces').hidden = true;
      entrer().catch(function (x) {
        $('#err-acces').textContent = x.message;
        $('#err-acces').hidden = false;
      });
    });

    $('#sortir').addEventListener('click', function () { deconnecter(''); });

    // ruptures : un appui suffit
    $('#ruptures').addEventListener('click', function (e) {
      var b = e.target.closest('[data-plat]');
      if (!b) return;
      b.disabled = true;
      agir({ action: 'rupture', plat: b.dataset.plat, rupture: b.dataset.rupture === '1' })
        .catch(function () {});
    });

    $('#cherche-plat').addEventListener('input', function () {
      if (etat) dessinerRuptures();
    });

    // prix : on valide au départ du champ ou à la touche Entrée, jamais à la
    // frappe — un prix à moitié tapé ne doit pas partir.
    $('#prix').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('.adm__prix-c')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    $('#prix').addEventListener('focusout', function (e) {
      if (!e.target.matches('.adm__prix-c')) return;
      var cle = e.target.dataset.cle;
      var valeur = enCentimes(e.target.value);
      if (valeur === null) { dire('Prix illisible : « ' + e.target.value +' ».', true); dessiner(); return; }

      var actuel = null;
      etat.carte.categories.forEach(function (cat) {
        cat.tailles.forEach(function (t) { if (t.cle === cle) actuel = t.prix; });
        cat.plats.forEach(function (p) { if (p.cle === cle) actuel = p.prix; });
      });
      etat.carte.supplements.forEach(function (g) { if (g.cle === cle) actuel = g.prix; });
      if (actuel === valeur) return;    // rien n'a changé, rien à publier

      agir({ action: 'prix', cle: cle, prix: valeur }).catch(function () {});
    });
    $('#prix').addEventListener('click', function (e) {
      var b = e.target.closest('[data-remettre]');
      if (!b) return;
      agir({ action: 'prix', cle: b.dataset.remettre, prix: null }).catch(function () {});
    });

    $('#form-livraison').addEventListener('submit', function (e) {
      e.preventDefault();
      var min = enCentimes($('#l-min').value);
      var frais = enCentimes($('#l-frais').value);
      if (min === null || frais === null) { dire('Montant illisible.', true); return; }
      agir({ action: 'livraison', minimum: min, frais: frais }).catch(function () {});
    });

    // photos
    $('#photo-fichier').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      reduire(f).then(function (url) {
        photoChoisie = url;
        $('#photo-img').src = url;
        $('#photo-apercu').hidden = false;
      }).catch(function (e) {
        photoChoisie = null;
        $('#photo-apercu').hidden = true;
        dire(e.message, true);
      });
    });

    $('#photo-envoyer').addEventListener('click', function () {
      if (!photoChoisie) return;
      var b = this;
      b.disabled = true;
      agir({ action: 'photo', plat: $('#photo-plat').value, image: photoChoisie })
        .then(function () {
          photoChoisie = null;
          $('#photo-apercu').hidden = true;
          $('#photo-fichier').value = '';
        })
        .catch(function () {})
        .then(function () { b.disabled = false; });
    });

    // un code déjà saisi dans cet onglet évite de le retaper
    if (code) {
      entrer().catch(function () { deconnecter(''); });
    } else {
      $('#code').focus();
    }
  });
})();
