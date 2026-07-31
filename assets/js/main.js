/* ==========================================================================
   Anas Pizza Original — Nantes
   JavaScript unique, sans dépendance. Chargé en `defer`.
   Tout est défensif : chaque bloc ne s'exécute que si son markup existe,
   afin de partager ce fichier entre l'accueil et les pages légales.
   ========================================================================== */
(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ *
   * 1. Horaires — source de vérité unique (fuseau Europe/Paris)
   *    minutes depuis minuit ; une fermeture > 1440 déborde sur le lendemain
   * ------------------------------------------------------------------ */
  var HOURS = [
    { open: 690, close: 1440 }, // dimanche  11:30 – 00:00
    { open: 690, close: 1440 }, // lundi     11:30 – 00:00
    { open: 690, close: 1440 }, // mardi     11:30 – 00:00
    { open: 690, close: 1440 }, // mercredi  11:30 – 00:00
    { open: 690, close: 1440 }, // jeudi     11:30 – 00:00
    { open: 690, close: 1560 }, // vendredi  11:30 – 02:00
    { open: 690, close: 1560 }  // samedi    11:30 – 02:00
  ];
  var DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  function parisNow() {
    // Renvoie { day: 0-6, minutes: 0-1439 } à l'heure de Paris, quel que soit
    // le fuseau du visiteur.
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit',
        minute: '2-digit', hour12: false
      }).formatToParts(new Date());
      var map = {};
      parts.forEach(function (p) { map[p.type] = p.value; });
      var idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[map.weekday];
      var h = parseInt(map.hour, 10) % 24;
      return { day: idx, minutes: h * 60 + parseInt(map.minute, 10) };
    } catch (e) {
      var d = new Date();
      return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
    }
  }

  function fmt(mins) {
    var m = ((mins % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + 'h' +
           (m % 60 ? String(m % 60).padStart(2, '0') : '');
  }

  function openState() {
    var now = parisNow();
    var today = HOURS[now.day];
    var yday = HOURS[(now.day + 6) % 7];

    // Reste de la nuit de la veille (ex. vendredi 01h00 → service du jeudi soir)
    if (yday.close > 1440 && now.minutes < yday.close - 1440) {
      return { open: true, until: yday.close - 1440 };
    }
    if (now.minutes >= today.open && now.minutes < Math.min(today.close, 1440)) {
      return { open: true, until: today.close };
    }
    if (now.minutes < today.open) {
      return { open: false, next: today.open, nextDay: null };
    }
    return { open: false, next: HOURS[(now.day + 1) % 7].open, nextDay: 'demain' };
  }

  /* Pastille « Ouvert / Fermé » -------------------------------------- */
  var statusEl = $('[data-status]');
  if (statusEl) {
    var paint = function () {
      var s = openState();
      var label = $('[data-status-label]', statusEl);
      var sub = $('[data-status-sub]', statusEl);
      statusEl.classList.toggle('is-open', s.open);
      statusEl.classList.toggle('is-closed', !s.open);
      if (label) label.textContent = s.open ? 'Ouvert maintenant' : 'Fermé';
      if (sub) {
        sub.textContent = s.open
          ? '· jusqu’à ' + fmt(s.until)
          : '· ouvre ' + (s.nextDay ? s.nextDay + ' ' : '') + 'à ' + fmt(s.next);
      }
    };
    paint();
    setInterval(paint, 60000);
  }

  /* Ligne du jour dans le tableau des horaires ----------------------- */
  var todayRow = $$('[data-day]');
  if (todayRow.length) {
    var d = parisNow().day;
    todayRow.forEach(function (row) {
      row.classList.toggle('is-today', DAY_NAMES[d] === row.getAttribute('data-day'));
    });
  }

  /* ------------------------------------------------------------------ *
   * 2. En-tête : état « collé »
   * ------------------------------------------------------------------ */
  var header = $('.header');
  if (header) {
    var onScrollHeader = function () {
      header.classList.toggle('is-stuck', window.scrollY > 12);
    };
    onScrollHeader();
    window.addEventListener('scroll', onScrollHeader, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   * 3. Tiroir de navigation mobile
   * ------------------------------------------------------------------ */
  var drawer = $('#drawer');
  var burger = $('[data-drawer-open]');
  if (drawer && burger) {
    var lastFocus = null;
    var setDrawer = function (open) {
      drawer.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
      drawer.setAttribute('aria-hidden', String(!open));
      document.body.classList.toggle('is-locked', open);
      if (open) {
        lastFocus = document.activeElement;
        var first = $('a, button', drawer);
        if (first) setTimeout(function () { first.focus(); }, 120);
      } else if (lastFocus) {
        lastFocus.focus();
      }
    };
    burger.addEventListener('click', function () {
      setDrawer(!drawer.classList.contains('is-open'));
    });
    drawer.addEventListener('click', function (e) {
      if (e.target === drawer || e.target.closest('[data-drawer-close]') || e.target.closest('a')) {
        setDrawer(false);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('is-open')) setDrawer(false);
    });
  }

  /* ------------------------------------------------------------------ *
   * 4. Apparitions au défilement
   * ------------------------------------------------------------------ */
  var revealables = $$('[data-reveal]');
  if (revealables.length) {
    if (!('IntersectionObserver' in window) || reduced) {
      revealables.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

      revealables.forEach(function (el, i) {
        // décalage automatique pour les éléments frères d'une même grille
        if (!el.style.getPropertyValue('--d')) {
          var sibs = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : i;
          el.style.setProperty('--d', String(Math.min(sibs, 6) * 80));
        }
        io.observe(el);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 5. Compteurs animés
   * ------------------------------------------------------------------ */
  var counters = $$('[data-count]');
  if (counters.length) {
    var run = function (el) {
      var target = parseFloat(el.getAttribute('data-count'));
      var suffix = el.getAttribute('data-suffix') || '';
      if (reduced) { el.textContent = target + suffix; return; }
      var t0 = null, dur = 1200;
      var step = function (ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min((ts - t0) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if ('IntersectionObserver' in window) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          run(e.target);
          cio.unobserve(e.target);
        });
      }, { threshold: 0.5 });
      counters.forEach(function (el) { cio.observe(el); });
    } else {
      counters.forEach(run);
    }
  }

  /* ------------------------------------------------------------------ *
   * 6. Navigation active selon la section visible
   * ------------------------------------------------------------------ */
  var navLinks = $$('.nav a[href^="#"]');
  if (navLinks.length && 'IntersectionObserver' in window) {
    var sections = navLinks
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ------------------------------------------------------------------ *
   * 7. La carte : filtres par catégorie + recherche d'ingrédient
   * ------------------------------------------------------------------ */
  var menu = $('#carte');
  if (menu) {
    var cats = $$('.menu-cat', menu);
    var items = $$('.item', menu);
    var filters = $$('.filter', menu);
    var searchWrap = $('.menu-search', menu);
    var search = searchWrap ? $('input', searchWrap) : null;
    var clearBtn = searchWrap ? $('.menu-search__clear', searchWrap) : null;
    var empty = $('.menu-empty', menu);
    var activeCat = 'all';

    // index de recherche : nom + description, sans accents
    var norm = function (s) {
      return s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                         : s.toLowerCase();
    };
    items.forEach(function (it) { it._q = norm(it.textContent); });

    var apply = function () {
      var q = search ? norm(search.value.trim()) : '';
      var total = 0;

      cats.forEach(function (cat) {
        var catId = cat.getAttribute('data-cat');
        var catMatch = activeCat === 'all' || activeCat === catId;
        var shown = 0;

        $$('.item', cat).forEach(function (it) {
          var ok = catMatch && (!q || it._q.indexOf(q) > -1);
          it.hidden = !ok;
          if (ok) shown++;
        });

        cat.hidden = shown === 0;
        total += shown;
      });

      if (empty) empty.classList.toggle('is-shown', total === 0);
      if (searchWrap) searchWrap.classList.toggle('has-value', !!q);
    };

    filters.forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeCat = btn.getAttribute('data-filter');
        filters.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        apply();
        var head = $('.menu-tools', menu);
        if (activeCat !== 'all' && head) {
          var target = $('.menu-cat[data-cat="' + activeCat + '"]', menu);
          if (target) target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        }
      });
    });

    if (search) {
      var timer;
      search.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(apply, 110);
      });
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { search.value = ''; apply(); }
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (search) { search.value = ''; search.focus(); }
        apply();
      });
    }
    apply();
  }

  /* ------------------------------------------------------------------ *
   * 8. Barre d'action mobile : visible dès qu'on quitte le haut de page
   * ------------------------------------------------------------------ */
  var bar = $('.actionbar');
  if (bar) {
    var toggleBar = function () {
      bar.classList.toggle('is-shown', window.scrollY > 220);
    };
    toggleBar();
    window.addEventListener('scroll', toggleBar, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   * 9. Photos optionnelles : si le fichier n'existe pas encore, on garde
   *    l'emplacement stylé plutôt qu'une image cassée.
   * ------------------------------------------------------------------ */
  $$('.shot img').forEach(function (img) {
    img.addEventListener('error', function () {
      var ph = img.parentElement ? img.parentElement.querySelector('.shot__ph') : null;
      img.remove();
      if (ph) ph.hidden = false;
    });
    if (img.complete && img.naturalWidth === 0) img.dispatchEvent(new Event('error'));
  });

  /* ------------------------------------------------------------------ *
   * 10. Année courante dans le pied de page
   * ------------------------------------------------------------------ */
  $$('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
