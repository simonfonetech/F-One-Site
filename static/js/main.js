document.addEventListener('DOMContentLoaded', function () {
  // mobile nav toggle
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.querySelector('.main-navigation');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      // Services is the main destination, so its cards are already showing
      // when the menu opens rather than needing a second tap on "Services"
      // (which still collapses/expands them). Closing the menu resets the
      // cards so it reopens at the top level next time.
      nav.querySelectorAll('.mega-services').forEach(function (li) {
        li.classList.toggle('is-open', open);
      });
      if (!open) {
        nav.querySelectorAll('.mega-float-card.is-open').forEach(function (card) {
          card.classList.remove('is-open');
          clearCard(card);
        });
      }
    });
    nav.querySelectorAll('li').forEach(function (li) {
      var link = li.querySelector(':scope > a');
      var sub = li.querySelector(':scope > .mega-menu');
      if (sub && link) {
        link.addEventListener('click', function (e) {
          if (window.innerWidth <= 1024) {
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
  // Forget whatever was drilled into once the panel has genuinely closed,
  // so the next time any card opens it starts back at its own top level
  // instead of silently resuming wherever a previous visit left off deep
  // inside Elevate. `.mega-float-nested.is-open` is a global selector,
  // not scoped to one card, since more than one card can have been
  // drilled into before the panel closed.
  //
  // This is called ONLY from the delayed branch of `release()` below, not
  // the immediate one -- `release(true)` also runs on every ordinary
  // click inside the menu (a trigger link opening a level, "View all",
  // anything), as a "don't strand the panel open" safety net, not as a
  // signal the visitor is actually leaving. Resetting there ran on every
  // single click, wiping out a level's `.is-open` in the same tick the
  // click handler that opened it had just set it. The delayed branch only
  // ever completes if `hold()` (mouseenter) hasn't cancelled it for a
  // full `MEGA_CLOSE_DELAY` -- i.e. the pointer genuinely left and didn't
  // come back -- which is the actual "visitor is done with this menu"
  // signal this needs.
  function resetDrilldowns() {
    document.querySelectorAll('.mega-float-nested.is-open').forEach(function (li) {
      li.classList.remove('is-open');
    });
  }
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
      timer = setTimeout(function () {
        li.classList.remove('is-hover');
        resetDrilldowns();
      }, MEGA_CLOSE_DELAY);
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
  // "Hardware", ...) unreachable. Below the same 1024px breakpoint the
  // rest of this mega-menu already switches to a mobile layout at,
  // intercept that tap and toggle the card open instead; the "View all"
  // link already inside .mega-float-drop covers the direct-navigation
  // case the link would otherwise have handled.
  document.querySelectorAll('.mega-float-card').forEach(function (card) {
    // The whole card is the tap target, not just the title link: theme.css
    // gives every nav <a> `width: max-content`, so the link only covered
    // the icon and title and a tap on the rest of the row did nothing.
    // Taps inside the expanded list belong to its own links/back buttons.
    card.addEventListener('click', function (e) {
      if (window.innerWidth > 1024) return;
      if (e.target.closest('.mega-float-drop')) return;
      e.preventDefault();
      var opening = !card.classList.contains('is-open');
      // one card at a time, as on desktop where only the hovered card shows
      document.querySelectorAll('.mega-float-card.is-open').forEach(function (other) {
        if (other !== card) {
          other.classList.remove('is-open');
          clearCard(other);
        }
      });
      card.classList.toggle('is-open', opening);
      if (opening) {
        resizeDropInner(card.querySelector('.mega-float-drop-inner'));
      } else {
        clearCard(card);
      }
    });
  });

  // Cloud Phone Systems (v17 swing-drilldown): clicking a sub-item with its
  // own children slides its list in over whichever list it lived in, and a
  // small back button (below) returns to that list. Works at every width:
  // on mobile the card is opened by tap (above) and the same panels slide
  // inside it. Accordion behaviour: opening one closes its siblings at the same
  // level, so `li.parentElement.children` -- not a global querySelectorAll
  // -- is what's closed. A closing sibling also clears `is-open` from any
  // of *its own* descendants, so reopening it later starts collapsed
  // rather than remembering whatever was drilled into inside it last time.
  //
  // `.mega-float-drop-inner`'s own height is JS-managed (not CSS) because
  // the panels stacked inside it are `position:absolute` (so one can slide
  // over another) and absolutely-positioned boxes don't contribute to a
  // parent's auto height -- nothing would hold the card open at the right
  // size once a nested panel became the only thing worth measuring.
  // `findActivePanelHeight` walks down through whichever chain of `.is-open`
  // nodes is currently drilled into and measures that deepest panel's own
  // back button + list span; `resizeDropInner` (called after every open/
  // close/back, and once up front for the initial closed state) writes
  // that to `.mega-float-drop-inner`'s inline height, which its own CSS
  // transitions smoothly -- see style.css for the matching half of this.
  //
  // `spanHeight` measures the real rendered distance from one element's
  // top to another's bottom, rather than summing their own `scrollHeight`s
  // -- summing misses any margin/gap CSS puts *between* them (`.mega-
  // float-cta`'s `margin-top: 10px`, `.mega-float-back`'s `margin-bottom:
  // 6px`), which under-measured the panel by exactly that much and left
  // "View all" (or the last item of a drilled-in list) clipped by
  // `overflow:hidden` at the bottom of the card.
  function spanHeight(first, last) {
    if (!first || !last) return (first || last) ? (first || last).scrollHeight : 0;
    return last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
  }

  function findActivePanelHeight(li) {
    var drop = li.querySelector(':scope > .mega-float-nested-drop');
    if (!drop) return 0;
    var ul = drop.querySelector(':scope > ul');
    var back = drop.querySelector(':scope > .mega-float-back');
    var openChild = null;
    if (ul) {
      Array.prototype.forEach.call(ul.children, function (child) {
        if (!openChild && child.classList && child.classList.contains('mega-float-nested') && child.classList.contains('is-open')) {
          openChild = child;
        }
      });
    }
    if (openChild) return findActivePanelHeight(openChild);
    return spanHeight(back || ul, ul || back);
  }

  function resizeDropInner(dropInner) {
    if (!dropInner) return;
    var ul = dropInner.querySelector(':scope > ul');
    var cta = dropInner.querySelector(':scope > .mega-float-cta');
    var openChild = null;
    if (ul) {
      Array.prototype.forEach.call(ul.children, function (child) {
        if (!openChild && child.classList && child.classList.contains('mega-float-nested') && child.classList.contains('is-open')) {
          openChild = child;
        }
      });
    }
    var height = openChild
      ? findActivePanelHeight(openChild)
      : spanHeight(ul || cta, cta || ul);
    // Math.ceil, not the raw float getBoundingClientRect gives back: the
    // browser rounds an assigned `height: 172.4px` down to whole device
    // pixels for layout, and rounding *down* is exactly what clipped
    // "View all" by a hair even after fixing the gap this measures.
    dropInner.style.height = Math.ceil(height) + 'px';
  }

  // Gives the explicit height back (so `grid-template-rows: 0fr` can
  // actually collapse the row -- see the note above the resize handler)
  // and forgets whatever this card had drilled into.
  function clearCard(card) {
    var dropInner = card.querySelector('.mega-float-drop-inner');
    if (dropInner) dropInner.style.height = '';
    card.querySelectorAll('.mega-float-nested.is-open').forEach(function (li) {
      li.classList.remove('is-open');
    });
  }

  // `event.detail` is the click-count for a real mouse click (>=1) but is
  // always 0 for a "click" synthesised by activating a focused element
  // from the keyboard (Enter/Space) -- the standard, reliable way to tell
  // the two apart. It's what `blurIfMouse` (used by both handlers below)
  // uses to blur only a genuine mouse click: leaving a clicked link/button
  // focused is what let `.mega-float-card:focus-within` (the CSS rule
  // that also keeps the card revealed while a keyboard user is tabbed
  // into it, same as :hover does for a mouse) hold a card open forever
  // after the pointer had already moved away and stopped hovering it --
  // "sticks open" until something else happened to steal focus. Blurring
  // unconditionally would fix that too, but would just as surely break
  // keyboard use: Enter-ing a link would immediately blur itself, closing
  // the very panel a keyboard user just opened before they could tab
  // further into it.
  function blurIfMouse(e) {
    if (e.detail > 0 && document.activeElement) document.activeElement.blur();
  }

  document.querySelectorAll('.mega-float-nested').forEach(function (li) {
    var trigger = li.querySelector(':scope > a');
    if (!trigger) return;
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      var opening = !li.classList.contains('is-open');
      if (opening) {
        Array.prototype.forEach.call(li.parentElement.children, function (sibling) {
          if (sibling === li) return;
          sibling.classList.remove('is-open');
          sibling.querySelectorAll('.mega-float-nested').forEach(function (descendant) {
            descendant.classList.remove('is-open');
          });
        });
      }
      li.classList.toggle('is-open');
      resizeDropInner(li.closest('.mega-float-drop-inner'));
      blurIfMouse(e);
    });
  });

  document.querySelectorAll('.mega-float-back').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var drop = btn.closest('.mega-float-nested-drop');
      var li = drop ? drop.closest('.mega-float-nested') : null;
      if (!li) return;
      li.classList.remove('is-open');
      li.querySelectorAll('.mega-float-nested').forEach(function (descendant) {
        descendant.classList.remove('is-open');
      });
      resizeDropInner(li.closest('.mega-float-drop-inner'));
      blurIfMouse(e);
    });
  });

  // Deliberately NOT a `document.querySelectorAll('.mega-float-drop-inner')
  // .forEach(resizeDropInner)` pass here at load. `.mega-float-drop`'s own
  // `grid-template-rows: 0fr` collapse (its closed state) only actually
  // reads as 0px while `.mega-float-drop-inner` has NO explicit `height`
  // at all -- an `fr` track still grows to fit a grid item's own specified
  // `height`, `overflow:hidden`/`min-height:0` on the item notwithstanding
  // (confirmed directly: clearing an inline height on an already-"closed"
  // card immediately re-collapsed its grid row from a stale 163px to 0).
  // Measuring and setting that height unconditionally for every card on
  // load -- what this used to do -- left every one of them permanently
  // expanded to its own full content height regardless of hover, the
  // "full-sized white window behind the menu" report: nothing ever
  // cleared that first inline height, so the 0fr collapse it was
  // defeating never got a chance to work even once. Sizing lazily, only
  // right before a card is about to reveal (below), and clearing it again
  // once a card genuinely closes (further down) is what keeps an unopened
  // or closed card's row free to actually collapse to 0.
  window.addEventListener('resize', function () {
    document.querySelectorAll('.mega-float-card').forEach(function (card) {
      var revealed = window.innerWidth > 1024
        ? (card.matches(':hover') || card.matches(':focus-within'))
        : card.classList.contains('is-open');
      if (revealed) resizeDropInner(card.querySelector('.mega-float-drop-inner'));
    });
  });
  // Mouse/focus-driven sizing is desktop-only: a touch tap fires compat
  // mouseenter/mouseleave too, which would size and then clear the card
  // out from under the tap handler that owns .is-open below 1025px.
  function isDesktop() { return window.innerWidth > 1024; }
  document.querySelectorAll('.mega-float-card').forEach(function (card) {
    var dropInner = card.querySelector('.mega-float-drop-inner');
    if (!dropInner) return;
    card.addEventListener('mouseenter', function () { if (isDesktop()) resizeDropInner(dropInner); });
    card.addEventListener('focusin', function () { if (isDesktop()) resizeDropInner(dropInner); });
    // Give back the explicit height as soon as the card actually starts
    // closing, not after a delay: a delay was the wrong instinct here --
    // it doesn't protect the close animation, it BREAKS it. While the old
    // (large) inline height is still in place, `grid-template-rows: 0fr`
    // (the closing target) resolves to that same large pixel value, same
    // as `1fr` did while open (the whole reason a leftover inline height
    // defeats the collapse at all -- see the note above), so for as long
    // as the height goes on being deferred, the "closed" and "open"
    // targets are numerically identical and nothing visibly moves; the
    // collapse only actually starts once the height is finally cleared.
    // That's the "delay before the dropdown minimises" this replaced.
    // Clearing it in the same tick as the state change costs nothing: a
    // CSS transition animates from whatever the property's rendered value
    // was a moment ago to its new one regardless of what caused either
    // value, so `grid-template-rows` still eases from ~163px down to the
    // real 0px over its own .32s -- it just starts immediately instead of
    // 350ms late.
    // Forgets whatever THIS card had drilled into, same moment its height
    // gets cleared. Originally this only happened via `resetDrilldowns()`
    // on the whole panel closing (see that function's own comment,
    // further up) -- reasonable for the panel itself, but a visitor who
    // drilled into Elevate > Hardware, then moved across to a *different*
    // card without ever leaving the menu overall, found Cloud Phone
    // Systems still sitting there mid-drill the next time they came back
    // to it, which is the "still popped out" a card-scoped reset here
    // fixes: a card forgets its own drill state as soon as attention
    // moves off THAT card, not only once the whole menu is done with.
    function closeCard() { clearCard(card); }
    card.addEventListener('mouseleave', function () {
      if (isDesktop() && !card.matches(':focus-within')) closeCard();
    });
    // focusout fires before the browser has necessarily settled which
    // element (if any) is about to receive focus next, so -- unlike
    // mouseleave, where :hover is already unambiguous -- this one still
    // needs a tick to let :focus-within reflect where focus actually
    // landed before deciding whether the card really closed.
    card.addEventListener('focusout', function () {
      if (!isDesktop()) return;
      setTimeout(function () {
        if (!card.matches(':hover') && !card.matches(':focus-within')) {
          closeCard();
        }
      }, 0);
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

      // Products & Services cards: one shared height at every width. The
      // CSS min-height (style.css) is the standard; if a card's copy
      // outgrows it at some width, every card is raised to match the
      // tallest instead of the row going ragged. Re-measured on Slick's
      // setPosition (fires on resize and breakpoint changes) and again on
      // window load, once web fonts have settled the line wrapping.
      if ($el.hasClass('our-services-slider')) {
        var $cards = $el.find('.wp-block-cb-slide > .gb-container');
        var equalise = function () {
          $cards.css('min-height', '');
          var max = 0;
          $cards.each(function () { max = Math.max(max, this.getBoundingClientRect().height); });
          if (max) $cards.css('min-height', Math.ceil(max) + 'px');
        };
        $el.on('setPosition', equalise);
        $(window).on('load', equalise);
        equalise();
      }

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
