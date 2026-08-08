/* ==========================================================================
   Anas Pizza Original — commande en ligne
   --------------------------------------------------------------------------
   Quatre étapes : formule, panier, coordonnées, paiement.

   Ce fichier ne fait qu'afficher et collecter. Les montants qu'il calcule
   servent à renseigner le client ; ils n'ont aucune valeur. Le serveur
   recalcule tout à partir d'assets/data/carte.json avant d'encaisser
   (voir api/_panier.js). Modifier un prix ici ne change rien à ce qui
   est payé.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var CLE = 'anas-panier-v1';
  var carte = null;
  var etat = { mode: null, lignes: [], client: {} };

  var euros = function (c) { return (c / 100).toFixed(2).replace('.', ',') + ' €'; };

  /* --- persistance ------------------------------------------------------ */
  function charger() {
    try {
      var v = JSON.parse(sessionStorage.getItem(CLE) || 'null');
      if (v && Array.isArray(v.lignes)) etat = v;
    } catch (e) { /* stockage indisponible : on repart d'un panier vide */ }
  }
  function sauver() {
    try { sessionStorage.setItem(CLE, JSON.stringify(etat)); } catch (e) {}
  }

  /* --- catalogue -------------------------------------------------------- */
  function platParId(id) {
    for (var i = 0; i < carte.categories.length; i++) {
      var c = carte.categories[i];
      for (var j = 0; j < c.plats.length; j++) {
        if (c.plats[j].id === id) return { plat: c.plats[j], cat: c };
      }
    }
    return null;
  }

  // Même calcul que le serveur — pour l'affichage seulement.
  function prixLigne(l) {
    var f = platParId(l.plat);
    if (!f) return 0;
    var u = f.cat.type === 'pizza'
      ? (f.cat.tailles.filter(function (t) { return t.id === l.taille; })[0] || {}).prix || 0
      : f.plat.prix;
    (l.supplements || []).forEach(function (s) {
      var g = carte.supplements.filter(function (x) { return x.id === s.groupe; })[0];
      if (g) u += g.prix;
    });
    return u * l.quantite;
  }

  function sousTotal() {
    return etat.lignes.reduce(function (s, l) { return s + prixLigne(l); }, 0);
  }
  function frais() {
    return etat.mode === 'livraison' ? carte.livraison.frais : 0;
  }
  function total() { return sousTotal() + frais(); }

  function libelle(l) {
    var f = platParId(l.plat);
    if (!f) return '';
    var s = f.plat.nom;
    if (l.taille) {
      var t = f.cat.tailles.filter(function (x) { return x.id === l.taille; })[0];
      if (t) s += ' — ' + t.nom;
    }
    if (l.supplements && l.supplements.length) {
      s += ' + ' + l.supplements.map(function (x) {
        var g = carte.supplements.filter(function (y) { return y.id === x.groupe; })[0];
        var c = g && g.choix.filter(function (y) { return y.id === x.choix; })[0];
        return c ? c.nom : '';
      }).filter(Boolean).join(', ');
    }
    return s;
  }

  // Deux lignes identiques fusionnent au lieu de s'empiler.
  function signature(l) {
    return [l.plat, l.taille || '', (l.supplements || []).map(function (s) {
      return s.groupe + ':' + s.choix;
    }).sort().join('|')].join('#');
  }

  /* --- étapes ----------------------------------------------------------- */
  var etape = 1;
  function aller(n) {
    etape = n;
    $$('.cmd__panel').forEach(function (p) {
      var on = Number(p.dataset.panel) === n;
      p.hidden = !on;
      p.classList.toggle('is-on', on);
    });
    $$('.steps__i').forEach(function (s) {
      var i = Number(s.dataset.step);
      s.classList.toggle('is-on', i === n);
      s.classList.toggle('is-done', i < n);
    });
    if (n === 3) preremplir();
    if (n === 4) dessinerRecap();
    majPanier();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* --- rendu de la carte ------------------------------------------------ */
  function dessinerCarte() {
    var tabs = $('#tabs');
    var zone = $('#produits');
    tabs.className = 'filters';
    tabs.innerHTML = '';
    zone.innerHTML = '';

    carte.categories.forEach(function (cat, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'filter';
      b.setAttribute('aria-pressed', String(i === 0));
      b.textContent = cat.nom;
      b.dataset.cible = cat.id;
      tabs.appendChild(b);

      var bloc = document.createElement('div');
      bloc.className = 'cmd__cat';
      bloc.id = 'cat-' + cat.id;
      bloc.hidden = i !== 0;

      var prix = cat.type === 'pizza'
        ? cat.tailles.map(function (t) {
            return '<span class="price-tag"><span>' + t.nom + '</span><b>' + euros(t.prix) + '</b></span>';
          }).join('')
        : '';
      bloc.innerHTML = '<div class="menu-cat__head"><h3 class="menu-cat__title">' + cat.nom +
        '</h3><div class="prices">' + prix + '</div></div>';

      var liste = document.createElement('div');
      liste.className = 'items';
      cat.plats.forEach(function (p) {
        var art = document.createElement('article');
        art.className = 'item';
        art.innerHTML =
          (p.photo ? '<img class="item__img" src="' + p.photo + '" alt="" loading="lazy" decoding="async" width="400" height="400">' : '') +
          '<div class="item__body"><p class="item__top"><span class="item__name">' + p.nom + '</span>' +
          (p.prix ? '<span class="item__price">' + euros(p.prix) + '</span>' : '') +
          p.badges.map(function (b) {
            return '<span class="badge badge--' + b.type + '">' + b.texte + '</span>';
          }).join('') +
          '</p><p class="item__desc">' + p.description + '</p></div>' +
          '<button class="item__more" type="button" data-choisir="' + p.id +
          '" aria-label="Ajouter : ' + p.nom + '"></button>';
        liste.appendChild(art);
      });
      bloc.appendChild(liste);
      zone.appendChild(bloc);
    });

    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cible]');
      if (!b) return;
      $$('button', tabs).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      $$('.cmd__cat', zone).forEach(function (x) { x.hidden = x.id !== 'cat-' + b.dataset.cible; });
    });
  }

  /* --- fiche produit ---------------------------------------------------- */
  var fiche = $('#produit');
  var courant = null;   // { plat, cat, taille, supplements:[], quantite }

  function ouvrirProduit(id) {
    var f = platParId(id);
    if (!f) return;
    courant = {
      plat: f.plat, cat: f.cat,
      taille: f.cat.type === 'pizza' ? f.cat.tailles[0].id : null,
      supplements: [], quantite: 1
    };

    var img = $('#p-img');
    if (f.plat.photo) {
      img.hidden = false;
      img.src = f.plat.photo.replace('-256.webp', '-720.webp');
    } else {
      img.hidden = true;
      img.removeAttribute('src');
    }

    $('#p-nom').textContent = f.plat.nom;
    $('#p-desc').textContent = f.plat.description;
    $('#p-badges').innerHTML = f.plat.badges.map(function (b) {
      return '<span class="badge badge--' + b.type + '">' + b.texte + '</span>';
    }).join('');

    // tailles
    var zt = $('#p-tailles');
    if (f.cat.type === 'pizza') {
      zt.innerHTML = '<h3 class="sheet__label">Taille</h3><div class="opts">' +
        f.cat.tailles.map(function (t, i) {
          return '<label class="opt"><input type="radio" name="taille" value="' + t.id + '"' +
            (i === 0 ? ' checked' : '') + '><span>' + t.nom + '<b>' + euros(t.prix) + '</b></span></label>';
        }).join('') + '</div>';
    } else {
      zt.innerHTML = '';
    }

    // suppléments — pizzas uniquement
    var zs = $('#p-supps');
    if (f.cat.type === 'pizza') {
      zs.innerHTML = '<h3 class="sheet__label">Suppléments <span class="sheet__opt">facultatif</span></h3>' +
        carte.supplements.map(function (g) {
          return '<p class="supp__t">' + g.nom + ' <b>+ ' + euros(g.prix) + '</b></p><div class="opts opts--wrap">' +
            g.choix.map(function (c) {
              return '<label class="opt opt--sm"><input type="checkbox" data-groupe="' + g.id +
                '" value="' + c.id + '"><span>' + c.nom + '</span></label>';
            }).join('') + '</div>';
        }).join('');
    } else {
      zs.innerHTML = '';
    }

    $('#p-qte').textContent = '1';
    majPrixFiche();
    if (typeof fiche.showModal === 'function') fiche.showModal();
    else fiche.setAttribute('open', '');
  }

  function lireFiche() {
    if (!courant) return null;
    var t = $('#p-tailles input[name="taille"]:checked');
    return {
      plat: courant.plat.id,
      taille: t ? t.value : null,
      supplements: $$('#p-supps input:checked').map(function (i) {
        return { groupe: i.dataset.groupe, choix: i.value };
      }),
      quantite: courant.quantite
    };
  }

  function majPrixFiche() {
    var l = lireFiche();
    $('#p-prix').textContent = l ? euros(prixLigne(l)) : '';
  }

  if (fiche) {
    fiche.addEventListener('change', majPrixFiche);
    fiche.addEventListener('click', function (e) {
      if (e.target === fiche || e.target.closest('[data-produit-close]')) { fiche.close(); return; }
      var q = e.target.closest('[data-qte]');
      if (q && courant) {
        courant.quantite = Math.min(20, Math.max(1, courant.quantite + Number(q.dataset.qte)));
        $('#p-qte').textContent = String(courant.quantite);
        majPrixFiche();
      }
    });
    $('#p-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var l = lireFiche();
      if (!l) return;
      var s = signature(l);
      var deja = etat.lignes.filter(function (x) { return signature(x) === s; })[0];
      if (deja) deja.quantite = Math.min(20, deja.quantite + l.quantite);
      else etat.lignes.push(l);
      sauver();
      majPanier();
      fiche.close();
    });
  }

  /* --- panier flottant -------------------------------------------------- */
  function majPanier() {
    var barre = $('#cart');
    if (!barre) return;
    var n = etat.lignes.reduce(function (s, l) { return s + l.quantite; }, 0);
    barre.hidden = n === 0 || etape === 1 || etape === 4;
    $('#cart-n').textContent = String(n);
    $('#cart-total').textContent = euros(total());
    $('#cart-go').textContent = etape === 2 ? 'Continuer' : 'Récapitulatif';

    var liste = $('#cart-list');
    liste.innerHTML = etat.lignes.map(function (l, i) {
      return '<div class="cart__line"><span class="cart__q">' + l.quantite + '×</span>' +
        '<span class="cart__n2">' + libelle(l) + '</span>' +
        '<span class="cart__pp">' + euros(prixLigne(l)) + '</span>' +
        '<button class="cart__x" type="button" data-oter="' + i + '" aria-label="Retirer ' + libelle(l) + '">✕</button></div>';
    }).join('') +
      '<div class="cart__sum"><span>Sous-total</span><b>' + euros(sousTotal()) + '</b></div>' +
      (frais() ? '<div class="cart__sum"><span>Livraison</span><b>' + euros(frais()) + '</b></div>' : '');

    // le minimum de commande doit se voir avant l'étape suivante, pas après
    var manque = etat.mode === 'livraison' ? carte.livraison.minimum - sousTotal() : 0;
    var av = $('#cart-avert');
    if (!av) {
      av = document.createElement('p');
      av.id = 'cart-avert';
      av.className = 'cart__avert';
      liste.parentNode.insertBefore(av, liste);
    }
    av.hidden = manque <= 0;
    av.textContent = manque > 0
      ? 'Minimum ' + euros(carte.livraison.minimum) + ' pour la livraison — il manque ' + euros(manque) + '.'
      : '';
    $('#cart-go').disabled = manque > 0;
  }

  /* --- coordonnées ------------------------------------------------------ */
  function preremplir() {
    var f = $('#coordonnees');
    Object.keys(etat.client || {}).forEach(function (k) {
      if (f.elements[k]) f.elements[k].value = etat.client[k];
    });
    $$('[data-si]').forEach(function (b) {
      b.hidden = b.dataset.si !== etat.mode;
      $$('input, textarea', b).forEach(function (i) { i.required = !b.hidden; });
    });
  }

  function verifierLocalement(c) {
    if (!c.nom || c.nom.trim().length < 2) return { m: 'Indiquez votre nom.', f: 'nom' };
    if (!/^0[1-9]\d{8}$/.test((c.telephone || '').replace(/[\s.\-()]/g, ''))) {
      return { m: 'Numéro de téléphone invalide (10 chiffres).', f: 'telephone' };
    }
    if (etat.mode === 'livraison') {
      if (!c.rue || c.rue.trim().length < 5) return { m: 'Indiquez votre adresse.', f: 'rue' };
      var ok = carte.livraison.communes.some(function (x) { return x.cp === (c.codePostal || '').trim(); });
      if (!ok) {
        return {
          m: 'Nous ne livrons pas encore le ' + (c.codePostal || '?') + '. La commande à emporter reste possible.',
          f: 'codePostal'
        };
      }
    }
    return null;
  }

  /* --- récapitulatif ---------------------------------------------------- */
  function dessinerRecap() {
    $('#recap').innerHTML = etat.lignes.map(function (l) {
      return '<div class="recap__l"><span>' + l.quantite + '× ' + libelle(l) + '</span><b>' +
        euros(prixLigne(l)) + '</b></div>';
    }).join('') +
      '<div class="recap__l recap__l--s"><span>Sous-total</span><b>' + euros(sousTotal()) + '</b></div>' +
      (frais() ? '<div class="recap__l recap__l--s"><span>Frais de livraison</span><b>' + euros(frais()) + '</b></div>' : '') +
      '<div class="recap__l recap__l--t"><span>Total à payer</span><b>' + euros(total()) + '</b></div>';

    var c = etat.client || {};
    $('#recap-client').innerHTML =
      '<h3 class="sheet__label">' + (etat.mode === 'livraison' ? 'Livraison' : 'Retrait sur place') + '</h3>' +
      '<p>' + (c.nom || '') + ' · ' + (c.telephone || '') + '</p>' +
      (etat.mode === 'livraison'
        ? '<p>' + [c.rue, c.complement, c.codePostal].filter(Boolean).join(', ') + '</p>' +
          '<p class="cmd__note">Délai estimé : ' + carte.livraison.delai + '.</p>'
        : '<p>10 allée Duguay Trouin, 44000 Nantes</p>') +
      (c.commentaire ? '<p class="recap__com">« ' + c.commentaire + ' »</p>' : '');
  }

  /* --- paiement --------------------------------------------------------- */
  function payer() {
    var b = $('#payer');
    var err = $('#err-paiement');
    b.disabled = true;
    b.textContent = 'Connexion au paiement…';
    err.hidden = true;

    fetch('/api/commande', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: etat.mode,
        // uniquement des identifiants : le serveur fixe les prix
        panier: etat.lignes.map(function (l) {
          return { plat: l.plat, taille: l.taille, quantite: l.quantite, supplements: l.supplements };
        }),
        client: etat.client
      })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (x) {
      if (x.ok && x.d.url) {
        try { sessionStorage.removeItem(CLE); } catch (e) {}
        window.location.href = x.d.url;
        return;
      }
      throw new Error(x.d.erreur || 'Le paiement n’a pas pu démarrer.');
    }).catch(function (e) {
      err.textContent = e.message;
      err.hidden = false;
      b.disabled = false;
      b.textContent = 'Commander avec obligation de paiement';
    });
  }

  /* --- démarrage -------------------------------------------------------- */
  function brancher() {
    $$('.mode').forEach(function (b) {
      b.addEventListener('click', function () {
        etat.mode = b.dataset.mode;
        sauver();
        aller(2);
      });
    });

    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { aller(Number(b.dataset.goto)); });
    });

    $('#produits').addEventListener('click', function (e) {
      var b = e.target.closest('[data-choisir]');
      if (b) ouvrirProduit(b.dataset.choisir);
    });

    $('#cart-see').addEventListener('click', function () {
      var l = $('#cart-list');
      l.hidden = !l.hidden;
      this.setAttribute('aria-expanded', String(!l.hidden));
    });

    $('#cart-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-oter]');
      if (!b) return;
      etat.lignes.splice(Number(b.dataset.oter), 1);
      sauver();
      majPanier();
    });

    $('#cart-go').addEventListener('click', function () { aller(etape === 2 ? 3 : 4); });

    $('#coordonnees').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var c = {};
      ['nom', 'telephone', 'rue', 'codePostal', 'complement', 'commentaire'].forEach(function (k) {
        if (f.elements[k]) c[k] = f.elements[k].value.trim();
      });
      var pb = verifierLocalement(c);
      var err = $('#err-form');
      if (pb) {
        err.textContent = pb.m;
        err.hidden = false;
        if (f.elements[pb.f]) f.elements[pb.f].focus();
        return;
      }
      err.hidden = true;
      etat.client = c;
      sauver();
      aller(4);
    });

    $('#payer').addEventListener('click', payer);

    var zone = $('[data-zone-resume]');
    if (zone) {
      var villes = [];
      carte.livraison.communes.forEach(function (c) {
        if (villes.indexOf(c.nom) === -1) villes.push(c.nom);
      });
      zone.textContent = villes.slice(0, 3).join(', ') +
        (villes.length > 3 ? ' et ' + (villes.length - 3) + ' communes' : '') +
        ' · dès ' + euros(carte.livraison.minimum);
    }
  }

  function demarrer() {
    if (!$('.page-commande')) return;
    charger();
    fetch('assets/data/carte.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('carte indisponible');
        return r.json();
      })
      .then(function (c) {
        carte = c;
        dessinerCarte();
        brancher();
        // un panier repris en cours de route redémarre à la carte
        aller(etat.mode && etat.lignes.length ? 2 : 1);
      })
      .catch(function () {
        $('#produits').innerHTML =
          '<p class="cmd__erreur">La carte n’a pas pu être chargée. ' +
          'Commandez par téléphone au <a href="tel:+33259100198">02 59 10 01 98</a>.</p>';
        aller(2);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', demarrer);
  } else {
    demarrer();
  }
})();
