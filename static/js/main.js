document.addEventListener('DOMContentLoaded', function () {
  // mobile nav toggle
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.querySelector('.main-navigation');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', nav.classList.contains('is-open') ? 'true' : 'false');
    });
    nav.querySelectorAll('li').forEach(function (li) {
      var link = li.querySelector(':scope > a');
      var sub = li.querySelector(':scope > .mega-menu');
      if (sub && link) {
        link.addEventListener('click', function (e) {
          if (window.innerWidth <= 991) {
            e.preventDefault();
            li.classList.toggle('is-open');
          }
        });
      }
    });
  }

  // Floating social rail: on narrow screens it tucks away while scrolling down
  // and comes back on the way up, so it never sits over the content. Above
  // 768px it stays put. Mirrors live's behaviour; theme.css does the animating
  // via .hidden.
  var socialRail = document.querySelector('.f-one-social-buttons');
  if (socialRail) {
    var lastY = window.scrollY;
    var onScroll = function () {
      if (window.innerWidth >= 768) {
        socialRail.classList.remove('hidden');
        return;
      }
      var y = window.scrollY;
      socialRail.classList.toggle('hidden', y > lastY);
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
  }

  // Services mega-menu: keep the panel open while the cursor travels to it.
  //
  // CSS :hover cannot cover this on its own. The "Services" item is only ~65px
  // wide while the panel below it is 740px, so any diagonal towards the panel
  // leaves the item sideways -- crossing the header and then the page, neither
  // of which is a descendant -- and the panel closes before you arrive. Holding
  // it open briefly after mouseleave bridges the journey; re-entering the item
  // *or* the panel (both are inside .mega-services) cancels the close.
  // Generous on purpose. Leaving "Services" diagonally means ~5 of the ~14
  // pointer steps to the panel land on neither element, so a hesitant cursor
  // can spend well over 300ms in transit. 260ms measured as a coin flip.
  var MEGA_CLOSE_DELAY = 500;
  document.querySelectorAll('.mega-services').forEach(function (li) {
    var timer = null;

    function hold() {
      clearTimeout(timer);
      li.classList.add('is-hover');
    }
    function release(immediate) {
      clearTimeout(timer);
      if (immediate) {
        li.classList.remove('is-hover');
        return;
      }
      timer = setTimeout(function () { li.classList.remove('is-hover'); }, MEGA_CLOSE_DELAY);
    }

    li.addEventListener('mouseenter', hold);
    li.addEventListener('mouseleave', function () { release(false); });
    // don't strand the panel open if the pointer never comes back
    li.addEventListener('click', function () { release(true); });
    // Explicit per-link listener rather than relying on this click bubbling
    // up from a link inside the panel: a same-page link (the CE-quiz
    // trigger, any #anchor link) calls preventDefault() and handles its
    // own navigation in JS, and while preventDefault() doesn't itself
    // stop bubbling, closing here directly -- rather than depending on
    // that bubble reaching the li -- means a selection always closes the
    // panel immediately, however that link's own handler behaves. Left
    // open, the panel sits over the top of the page and was blocking the
    // very scroll a selection is supposed to trigger.
    li.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { release(true); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') release(true);
    });
  });

  // Services mega-menu on mobile: .mega-float-card's reveal is
  // :hover/:focus-within driven (see style.css), which nothing on a touch
  // screen ever triggers -- .mega-float-main is a plain link straight to
  // the service's own page, so a tap just navigated there immediately,
  // with every child link inside the card ("Phone System Basics",
  // "Hardware", ...) unreachable. Below the same 991px breakpoint the
  // rest of this mega-menu already switches to a mobile layout at,
  // intercept that tap and toggle the card open instead; the "View all"
  // link already inside .mega-float-drop covers the direct-navigation
  // case the link would otherwise have handled.
  document.querySelectorAll('.mega-float-card').forEach(function (card) {
    var main = card.querySelector(':scope > .mega-float-main');
    if (!main) return;
    main.addEventListener('click', function (e) {
      if (window.innerWidth > 991) return;
      e.preventDefault();
      card.classList.toggle('is-open');
    });
  });

  // Services mega-menu: switch the right-hand panel to match the hovered/clicked tab
  document.querySelectorAll('.mega-tab').forEach(function (tab) {
    function activate() {
      var group = tab.closest('.mega-menu');
      group.querySelectorAll('.mega-tab').forEach(function (t) { t.classList.remove('is-active'); });
      group.querySelectorAll('.mega-panel').forEach(function (p) { p.classList.remove('is-active'); });
      tab.classList.add('is-active');
      var panel = group.querySelector('#' + tab.getAttribute('data-panel'));
      if (panel) panel.classList.add('is-active');
    }
    tab.addEventListener('mouseenter', activate);
    tab.addEventListener('click', activate);
  });

  // Carousel Block sliders (Slick-powered) -- each element already carries its
  // own data-slick config, generated by the original WP plugin; Slick reads it
  // automatically when initialized with no arguments
  if (window.jQuery && window.jQuery.fn && window.jQuery.fn.slick) {
    var $ = window.jQuery;

    $('.wp-block-cb-carousel').each(function () {
      var el = this;
      var $el = $(el);
      if ($el.hasClass('slick-initialized')) return;

      var opts = {};
      try {
        opts = JSON.parse(el.getAttribute('data-slick') || '{}');
      } catch (e) {
        opts = {};
      }

      // waitForAnimate defaults to true, which makes Slick swallow every drag
      // and click until the current transition finishes -- with autoplay running
      // a 1000ms transition every 3s the track is unresponsive much of the time.
      opts.waitForAnimate = false;
      if (opts.draggable === undefined) opts.draggable = true;
      if (opts.swipeToSlide === undefined) opts.swipeToSlide = true;
      if (opts.pauseOnHover === undefined) opts.pauseOnHover = true;

      $el.slick(opts);

      // ---- make the track grabbable mid-animation ----
      // waitForAnimate:false lets Slick accept the input, but the track still
      // carries the inline `transition` from the running slide animation, so it
      // eases towards each dragged position instead of following the pointer.
      // The result overshoots and feels disconnected. Clearing the transition
      // for the duration of the grab makes the drag 1:1; Slick re-applies its
      // own transition on the next slideHandler, so nothing needs restoring.
      //
      // Autoplay is paused while held, otherwise it keeps firing slide changes
      // that fight the pointer.
      var downX = null;
      var downY = null;
      var autoplays = opts.autoplay !== false;

      function grab(e) {
        var point = e.touches ? e.touches[0] : e;
        downX = point.clientX;
        downY = point.clientY;
        $el.addClass('is-dragging');

        // Slick's swipeMove refuses to move the track while an animation is in
        // flight -- `if (_.animating === true) { _.swipeLeft = null; return false; }`
        // -- so a grab mid-transition registers (dragging goes true, swipeLength
        // counts up) but the track never budges. waitForAnimate only gates
        // slideHandler, not this. Clearing the transition parks the track at its
        // target straight away, so declaring the animation done is accurate and
        // hands control to the pointer.
        $el.find('.slick-track').css({
          '-webkit-transition': 'none',
          'transition': 'none'
        });
        try {
          var slick = $el.slick('getSlick');
          if (slick && slick.animating) slick.animating = false;
        } catch (err) {}

        if (autoplays) {
          try { $el.slick('slickPause'); } catch (err) {}
        }
      }

      function letGo() {
        $el.removeClass('is-dragging');
        if (autoplays) {
          try { $el.slick('slickPlay'); } catch (err) {}
        }
      }

      $el.on('mousedown', grab);
      $el.on('touchstart', grab);
      $(document).on('mouseup', letGo);
      $(document).on('touchend', letGo);

      $el.on('click', function (e) {
        // never hijack a click on something interactive
        if ($(e.target).closest('a, button, input, textarea, select, .slick-arrow, .slick-dots').length) {
          return;
        }
        // ignore the click Slick emits at the end of a swipe
        if (downX !== null &&
            (Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8)) {
          downX = downY = null;
          return;
        }
        downX = downY = null;

        var rect = el.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var zone = Math.max(60, rect.width * 0.15);

        if (x < zone) {
          $el.slick('slickPrev');
        } else if (x > rect.width - zone) {
          $el.slick('slickNext');
        }
      });
    });
  }

  // accordions (works for every .gb-accordion on the page)
  document.querySelectorAll('.gb-accordion__toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.gb-accordion-item');
      if (!item) return;
      var content = item.querySelector('.gb-accordion-content');
      var isOpen = item.classList.contains('is-open');
      if (isOpen) {
        if (content) content.style.maxHeight = null;
        item.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      } else {
        if (content) content.style.maxHeight = content.scrollHeight + 'px';
        item.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
});
