document.addEventListener('DOMContentLoaded', function () {
  // ---------- panel open/close ----------
  // In-page expand/collapse (CSS grid-template-rows 0fr->1fr on
  // .ce-quiz-panel), not a fixed overlay -- opening it pushes the rest
  // of the page down instead of floating on top of it.
  const trigger = document.getElementById('ce-quiz-trigger');
  const panel = document.getElementById('ce-quiz-panel');
  const closeBtn = document.getElementById('ce-quiz-close');

  if (!panel) return; // everything below only matters where the quiz markup exists

  // True for the ~1.4s the panel's own grid-template-rows open/close
  // transition is actively running. getBoundingClientRect() on the
  // heading above it mid-transition can read a transient, interpolated
  // value rather than its true at-rest position (the heading itself is
  // engineered to sit at a fixed spot regardless of the panel's state --
  // see gb-container-b72a280d below -- but that invariant only holds once
  // the transition has actually finished, not while grid-template-rows is
  // still animating between 0fr and 1fr). Reading it at the wrong moment
  // and "correcting" scrollY based on that bad reading is what caused a
  // correction to fire mid-open and throw the page to a wildly wrong
  // position further down the page.
  let panelTransitioning = false;
  panel.addEventListener('transitionend', function (e) {
    if (e.target === panel && e.propertyName === 'grid-template-rows') panelTransitioning = false;
  });

  // ---------- robust scrolling to the heading ----------
  // Shared by every path that needs to land on #cyber-essentials-heading:
  // opening (from the on-page trigger or the "Free Cyber Essentials
  // Report" mega-menu link, from this page or another one) and closing.
  //
  // Getting this right fights the browser's own native jump-to-# behaviour
  // on multiple fronts:
  //  - style.css sets `html { scroll-behavior: smooth }` site-wide, so
  //    both the browser's native jump to a URL fragment matching an
  //    element id (which happens independently of this script, for a
  //    fresh navigation *and* for same-page anchor clicks) and any scroll
  //    this code performs animate smoothly and can overlap.
  //  - A fresh cross-page navigation's native fragment-scroll is queued as
  //    part of loading the document itself, before this script even runs
  //    -- so it can still land *after* this code has already finished,
  //    overriding it.
  //  - The page is long and loads a webfont (proxima-nova, via Adobe
  //    Typekit) asynchronously; text reflowing once it swaps in can shift
  //    everything below it by a couple hundred px, invalidating a
  //    scroll position that looked correct the instant it was set.
  // whenScrollSettled polls scrollY across animation frames and only
  // fires once it's held steady for a few frames running, i.e. once
  // nothing else is actively scrolling the page any more, from any
  // source, however long that takes -- no fixed delay to guess wrong.
  function whenScrollSettled(cb) {
    let lastY = window.scrollY;
    let stableFrames = 0;
    function check() {
      const y = window.scrollY;
      if (y === lastY) {
        stableFrames++;
      } else {
        stableFrames = 0;
        lastY = y;
      }
      if (stableFrames >= 4) { cb(); return; }
      window.requestAnimationFrame(check);
    }
    window.requestAnimationFrame(check);
  }

  // This page has ~350 <img> elements in total once the "Proud to
  // Support These Businesses" client-logo carousel is counted (Slick
  // clones each logo ~6x for its infinite-loop effect). Those carousel
  // images are marked loading="lazy" and sit in a row with a CSS-fixed
  // height regardless of their own size, so they're excluded from the
  // checks below on purpose -- waiting on ~300 of them was previously
  // adding several seconds for no visual benefit. The handful of images
  // that actually sit above #cyber-essentials-heading in normal flow
  // (the hero icon and the section images either side of it) do have
  // width/height reserved and are NOT lazy, so criticalImagesComplete()
  // below only has a small, real set left to wait on.
  //
  // Even with that, a lingering periodic correction after arrival is
  // kept as a last line of insurance: correctPosition() runs every
  // 350ms for ~6.5s, snapping the heading back into place if anything
  // still nudges it after the fact (a font swap, a slow asset). cb()
  // fires as soon as the first check finds nothing to correct, so
  // opening the panel doesn't wait on the full 6.5s window.
  // Animates window scroll from wherever it currently is to an exact,
  // already-known target over a fixed duration, easing out (same cubic
  // curve as animateCount() further down, for a consistent feel). Used
  // instead of trusting the browser's own smooth-scroll heuristics
  // (`scroll-behavior: smooth`, or scrollIntoView({behavior:'smooth'}))
  // to pick a good stopping point themselves: measured directly on this
  // page, that native animation overshoots its own target by ~300px on
  // a ~5500px jump, consistently, not just occasionally -- the actual
  // cause of "shoots past where it should". Driving every frame here
  // explicitly means it always ends exactly on targetY, with nothing
  // left to overshoot, however far away it started.
  function animatedScrollTo(targetY, duration, cb) {
    const startY = window.scrollY;
    const delta = targetY - startY;
    if (Math.abs(delta) < 1) { if (cb) cb(); return; }
    const startTime = performance.now();
    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      window.scrollTo({ top: startY + delta * eased, behavior: 'instant' });
      if (progress < 1) {
        window.requestAnimationFrame(tick);
      } else if (cb) {
        cb();
      }
    }
    window.requestAnimationFrame(tick);
  }

  function scrollToHeading(cb) {
    const heading = document.getElementById('cyber-essentials-heading');
    if (!heading) { if (cb) cb(); return; }
    // document.fonts.ready is a genuine hang risk, not just a slow one: on a
    // slow connection, a blocked font CDN request, or a browser/extension
    // that never settles it for some other reason, this promise can simply
    // never resolve -- and without a fallback, that means this whole
    // scroll-then-open sequence never runs at all, leaving only the
    // browser's own uncontrolled native scroll (the entire reason this
    // function exists) as whatever moved the page. Racing it against a
    // timeout means a slow font load only ever costs up to 1.2s, never an
    // indefinite hang.
    const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    const timeout = new Promise(function (resolve) { window.setTimeout(resolve, 1200); });

    // The browser's own scroll anchoring is normally helpful (it keeps
    // whatever you're reading in place when something loads above it),
    // but here it's a direct competitor: as the ~350 images further up
    // this page (see note above) finish loading during our own animated
    // scroll, anchoring tries to compensate by nudging scrollY on its
    // own -- fighting the position we're actively driving frame by frame
    // and producing exactly the "shoots past, then snaps back" look this
    // whole function exists to avoid. The longer the animation runs, the
    // more of those image loads land mid-scroll, so it only got more
    // visible once the animation was slowed down. Switched off for the
    // duration of our own scroll handling, restored once it's done.
    const prevOverflowAnchor = document.documentElement.style.overflowAnchor;
    document.documentElement.style.overflowAnchor = 'none';
    function restoreOverflowAnchor() {
      document.documentElement.style.overflowAnchor = prevOverflowAnchor;
    }

    function targetY() {
      const cs = window.getComputedStyle(heading);
      const wantTop = parseFloat(cs.scrollMarginTop) || 0;
      return heading.getBoundingClientRect().top + window.scrollY - wantTop;
    }

    // Instant, silent snap -- used only for the *background* correction
    // checks after the visible animation below has already finished (see
    // the periodic interval further down): those exist purely to absorb
    // images still loading well after arrival, and re-animating every
    // 350ms for that would be far more distracting than the drift itself.
    function correctPosition() {
      if (panelTransitioning) return false; // see panelTransitioning above -- reading now would be unreliable
      const actualTop = heading.getBoundingClientRect().top;
      const cs = window.getComputedStyle(heading);
      const wantTop = parseFloat(cs.scrollMarginTop) || 0;
      if (Math.abs(actualTop - wantTop) > 2) {
        window.scrollTo({ top: window.scrollY + (actualTop - wantTop), behavior: 'instant' });
        return true; // was off, and has now been corrected
      }
      return false; // already on target
    }

    // A fixed "wait N ms before trusting targetY()" turned out to be a
    // moving target itself -- it only ever worked for as long as this
    // page's specific mix of assets happened to finish settling within
    // that window, and broke again the moment that mix changed (exactly
    // what happened here when the images above the heading were later
    // compressed and started arriving *faster*, shifting the point where
    // the page actually finishes settling to earlier than expected).
    // Rather than re-tune a magic number every time page content
    // changes, poll targetY() itself and only commit to it once it's
    // stopped moving -- self-verifying instead of guessed, so it adapts
    // automatically to whatever this page's assets do in the future.
    // "Hasn't moved in the last 300ms" and "has genuinely finished
    // settling" turned out to be different things: right after
    // navigation, before any image above the heading has even started
    // downloading, targetY() reads as perfectly stable too -- there's
    // simply nothing happening *yet* to move it. That false stability is
    // exactly what let this commit to a target several images too early
    // in testing. Layering on an explicit "have the images that actually
    // sit above the heading finished loading" check closes that gap --
    // lazy-loaded ones (the logo carousel, deliberately deferred and
    // fixed-height regardless of when they arrive) are excluded, since
    // waiting on those would just reintroduce the delay this was meant
    // to remove.
    function criticalImagesComplete() {
      const headingTop = heading.getBoundingClientRect().top + window.scrollY;
      const images = document.images;
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.loading === 'lazy') continue;
        const imgTop = img.getBoundingClientRect().top + window.scrollY;
        if (imgTop < headingTop && !img.complete) return false;
      }
      return true;
    }

    function waitForStableTarget(cb2) {
      let lastTarget = targetY();
      let stableChecks = 0;
      let totalChecks = 0;
      const interval = window.setInterval(function () {
        totalChecks++;
        const t = targetY();
        if (Math.abs(t - lastTarget) < 2 && criticalImagesComplete()) {
          stableChecks++;
        } else {
          stableChecks = 0;
          lastTarget = t;
        }
        // 3 consecutive agreeing reads (300ms of no movement) with every
        // above-heading image loaded, or a hard 2s cap so a page that
        // never fully settles still doesn't hang.
        if (stableChecks >= 3 || totalChecks >= 20) {
          window.clearInterval(interval);
          cb2(lastTarget);
        }
      }, 100);
    }

    Promise.race([fontsReady, timeout]).then(function () {
      whenScrollSettled(function () {
        // Page is confirmed stable (whenScrollSettled) and fonts are
        // done, but targetY() itself can still be mid-flight (see
        // waitForStableTarget above) -- confirm it's actually settled
        // before committing the animation to it.
        waitForStableTarget(function (finalTargetY) {
        animatedScrollTo(finalTargetY, 1900, function () {
          correctPosition();
          if (cb) cb();
          // Never fight a visitor who's actually trying to scroll during
          // this window: the first sign of deliberate scroll input (wheel,
          // touch, or a scroll-moving key) cancels the remaining checks
          // immediately, leaving them wherever they've scrolled to.
          let checksLeft = 18; // ~6.5s at 350ms apart
          const interval = window.setInterval(function () {
            correctPosition();
            checksLeft--;
            if (checksLeft <= 0) stopCorrecting();
          }, 350);
          const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
          function onUserInput(e) {
            if (e.type === 'keydown' && scrollKeys.indexOf(e.key) === -1) return;
            stopCorrecting();
          }
          // Clicking any other link on the page (a nav item, a same-page
          // anchor elsewhere) is just as deliberate a signal as scrolling
          // by hand -- the visitor has decided where they want to be next.
          // Without this, clicking straight to e.g. "Microsoft 365 Licence
          // Management" moments after arriving here would scroll there
          // correctly for an instant, then this loop's next 350ms tick
          // would find the CE heading off its expected mark and snap the
          // page straight back to it, undoing the very navigation the
          // click just asked for. Capture phase so this still fires even
          // if the link's own handler stops the event from bubbling.
          function onLinkClick(e) {
            if (e.target.closest('a[href]')) stopCorrecting();
          }
          function stopCorrecting() {
            window.clearInterval(interval);
            window.removeEventListener('wheel', onUserInput);
            window.removeEventListener('touchstart', onUserInput);
            window.removeEventListener('keydown', onUserInput);
            document.removeEventListener('click', onLinkClick, true);
            restoreOverflowAnchor();
          }
          window.addEventListener('wheel', onUserInput, { passive: true });
          window.addEventListener('touchstart', onUserInput, { passive: true });
          window.addEventListener('keydown', onUserInput);
          document.addEventListener('click', onLinkClick, true);
        });
        });
      });
    });
  }

  function openPanel() {
    panelTransitioning = true;
    panel.classList.add('ce-quiz-open');
    panel.setAttribute('aria-hidden', 'false');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }

  // Scrolls to the heading first and only opens the panel once that scroll
  // has actually arrived -- so the panel doesn't start growing underneath
  // a page that's still moving toward it. The heading sits at the same
  // position whether the panel is open or collapsed (the fixed 288px
  // margin on gb-container-b72a280d below), so scrolling to it before
  // opening lands in exactly the same place as scrolling after; only the
  // visual sequence changes.
  function goToReport() {
    scrollToHeading(function () {
      if (!panel.classList.contains('ce-quiz-open')) openPanel();
    });
  }

  function closePanel({ refocusTrigger, pauseBeforeCollapse } = {}) {
    // Closing can happen from anywhere in a long quiz + report, scrolled
    // well past the section it lives in -- send the user back to the
    // heading itself rather than leaving them stranded, the same robust
    // scroll every other path here uses.
    scrollToHeading();

    function collapse() {
      panelTransitioning = true;
      panel.classList.remove('ce-quiz-open');
      panel.setAttribute('aria-hidden', 'true');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (refocusTrigger && trigger) trigger.focus({ preventScroll: true });
      // Updates the URL to match without using location.hash directly --
      // setting location.hash to a value it's *already* set to is a
      // no-op in every browser (no scroll, no event), which is why this
      // only ever worked on the first close and silently did nothing on
      // the second, third, etc. pushState always updates the URL, and
      // (unlike location.hash) never triggers its own native jump that
      // could fight the scroll above.
      if (window.history && window.history.pushState) {
        window.history.pushState(null, '', '#cyber-essentials-heading');
      }
    }

    if (pauseBeforeCollapse) {
      // The "Close quiz" button sits at the bottom of a long report,
      // scrolled well past the heading -- collapsing the panel right
      // away would shrink it out from under the user mid-scroll,
      // fighting the very scroll just kicked off above. Giving the
      // scroll a clear beat to land first means the user visibly
      // arrives back at the heading before anything moves under them;
      // the panel then closes as normal.
      window.setTimeout(collapse, 1200);
    } else {
      collapse();
    }
  }

  if (trigger) {
    trigger.addEventListener('click', () => {
      if (panel.classList.contains('ce-quiz-open')) closePanel();
      else goToReport();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', () => closePanel({ refocusTrigger: true, pauseBeforeCollapse: true }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('ce-quiz-open')) closePanel({ refocusTrigger: true });
  });

  // "Free Cyber Essentials Report" in the Services mega-menu links to
  // /it-essentials/?ce-quiz=open -- a query parameter, not a #hash. A
  // #hash matching an element id is *always* auto-scrolled to by the
  // browser itself, independent of anything this script does, and that
  // native jump is what every earlier version of this fix was really
  // fighting: it races this script's own scroll on a fresh navigation
  // with timing this script can't fully control (queued as part of
  // loading the document, sometimes landing *after* this script has
  // already finished), and no amount of adjusting the target position
  // fixed that, because the position was never the actual problem. A
  // query string has zero built-in browser scroll behaviour attached to
  // it at all, so there's nothing left to race -- this sidesteps the
  // problem outright instead of continuing to compensate for it.
  //
  // The mega-menu link with this href renders on every page site-wide,
  // but only /it-essentials/ has the panel/trigger to act on -- the click
  // listener attached to it below is only ever reached on this page (this
  // whole file returns early above on any page without the panel), so on
  // every other page the link stays a plain, normal one that navigates
  // here, landing on the check below once it arrives.
  const quizParams = new URLSearchParams(window.location.search);
  if (quizParams.get('ce-quiz') === 'open') {
    // Per instruction: land at the very top of the page first -- the same
    // starting point any other visit to /it-essentials/ would have --
    // then scrollToHeading()'s own animation carries the visitor down to
    // the report, reading as a deliberate "arrive, then travel to it"
    // rather than a guess at landing directly on it.
    window.scrollTo({ top: 0, behavior: 'instant' });
    // scrollToHeading()'s own waitForStableTarget() already waits out
    // any icons/images still popping in above the heading before
    // committing to an animation target, so there's no separate fixed
    // delay needed here on top of that -- go straight to it.
    goToReport();
  }
  // Clicking that same link while already on this page: no native jump
  // to worry about here either (same reason), so this just intercepts
  // the click and calls the exact same goToReport() the trigger button
  // uses -- no top-of-page scroll first, since there's nowhere jarring
  // to arrive from, and no URL bookkeeping needed either.
  document.querySelectorAll('a[href*="ce-quiz=open"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      goToReport();
    });
  });

  // Browsers can restore this exact page (DOM, scroll position, JS state
  // and all) from the back-forward cache when returning via back/forward,
  // rather than reloading it -- if the panel was left open, coming back
  // that way would show it still open. Collapsing it on the way out means
  // any such restore always finds it closed, so navigating here fresh
  // always looks the same regardless of how the panel was left last time.
  // Only the open/closed class changes -- selected answers are left alone,
  // so a visitor who comes back still finds their progress, just collapsed
  // rather than lost.
  window.addEventListener('pagehide', function () {
    panel.classList.remove('ce-quiz-open');
    panel.setAttribute('aria-hidden', 'true');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });

  // ---------- option selection ----------
  const radios = Array.from(document.querySelectorAll('.ce-quiz input[type="radio"]'));
  function updateGroup(name) {
    const group = document.querySelectorAll(`.ce-quiz input[name="${name}"]`);
    group.forEach(r => {
      const label = r.closest('.ce-quiz-option');
      if (!label) return;
      label.classList.toggle('selected', r.checked);
    });
  }

  radios.forEach(r => {
    updateGroup(r.name);
    r.addEventListener('change', () => {
      updateGroup(r.name);
      const option = r.closest('.ce-quiz-option');
      if (r.checked && option) {
        option.classList.remove('pulse');
        void option.offsetWidth;
        option.classList.add('pulse');
      }
    });
    const label = r.closest('label');
    if (label) label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });

  // ---------- scoring: build a RAG (Red/Amber/Green) report ----------
  const showBtn = document.getElementById('ce-quiz-show-results');
  const resultDiv = document.getElementById('ce-quiz-result');

  const RAG = {
    green: {
      key: 'green',
      label: 'Green — ready',
      message: 'You meet the bar for Cyber Essentials — every technical control assessed here is in place. F One Technologies Ltd can help you keep it that way with regular reviews.'
    },
    amber: {
      key: 'amber',
      label: 'Amber — gaps to close',
      message: 'You have a reasonable foundation, but there are real gaps standing between you and Cyber Essentials certification. F One Technologies Ltd can help you close them — start with the lowest-scoring sections below.'
    },
    red: {
      key: 'red',
      label: 'Red — not ready',
      message: 'There are significant gaps across your technical controls, and certification is unlikely to succeed until they are addressed. F One Technologies Ltd can help you build a plan — start with the checklist below.'
    }
  };
  // A perfect score (every answer "yes") is required for green, matching Cyber
  // Essentials' pass/fail nature — "maybe" or "no" answers are real gaps, not partial credit.
  const AMBER_MIN_RATIO = 2 / 3;

  const RECOMMENDATIONS = {
    fw1: 'F One Technologies Ltd can configure and maintain a properly set up business firewall, including software firewalls on every device.',
    sc1: 'F One Technologies Ltd can secure your device configurations, removing unused software and accounts and correcting default passwords.',
    dl1: 'F One Technologies Ltd can help you enforce automatic device locking with a PIN, password or biometric across your fleet.',
    su1: 'F One Technologies Ltd can put automated patch management in place so updates are always applied within 14 days.',
    ac1: 'F One Technologies Ltd can move every member of staff onto their own named account with a proper approval process.',
    aa1: 'F One Technologies Ltd can review and lock down administrator access to separate accounts for only those who need them.',
    pw1: 'F One Technologies Ltd can roll out multi-factor authentication across your systems and cloud services.',
    mw1: 'F One Technologies Ltd can deploy and centrally manage endpoint antivirus and mobile app controls across your fleet.'
  };

  const WELL_DONE_MESSAGE = 'Well done! This meets the Cyber Essentials Standard.';

  function scoreValue(input) {
    const val = (input.value || '').toString().toLowerCase().trim();
    if (val === 'yes') return 3;
    if (val === 'maybe') return 2;
    if (val === 'no') return 1;
    // "not sure" is the only answer that earns nothing -- unlike "no", it
    // doesn't even confirm the control's absence, so it can't earn the
    // partial credit "no" now does.
    if (val === 'notsure') return 0;
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
  }

  function bandForRatio(score, possible) {
    if (possible === 0) return RAG.red;
    const ratio = score / possible;
    if (ratio >= 1) return RAG.green;
    if (ratio >= AMBER_MIN_RATIO) return RAG.amber;
    return RAG.red;
  }

  function animateCount(el, target, duration) {
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Firework celebration shown when the assessment scores a perfect result.
  const fireworkOverlay = document.getElementById('ce-quiz-firework-overlay');
  const fireworkCanvas = document.getElementById('ce-quiz-firework-canvas');

  function launchFireworks() {
    if (!fireworkOverlay || !fireworkCanvas) return;
    const ctx = fireworkCanvas.getContext('2d');
    let width, height;
    function resize() {
      width = fireworkCanvas.width = window.innerWidth;
      height = fireworkCanvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // IT Essentials accent colours: purple, secondary navy, and white/black
    // for contrast -- matches this page's theme instead of a generic palette.
    const colors = ['#D5ACF8', '#004269', '#FFCE00', '#ffffff', '#000000'];
    let particles = [];
    let spawning = true;
    let burstInterval;

    function spawnBurst() {
      const x = width * (0.15 + Math.random() * 0.7);
      const y = height * (0.15 + Math.random() * 0.4);
      const color = colors[Math.floor(Math.random() * colors.length)];
      const count = 40 + Math.floor(Math.random() * 20);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const speed = 2 + Math.random() * 3.5;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          life: 1,
          decay: 0.012 + Math.random() * 0.012
        });
      }
    }

    function stop() {
      spawning = false;
      clearInterval(burstInterval);
      fireworkOverlay.classList.remove('active');
      fireworkOverlay.removeEventListener('click', stop);
    }

    function tick() {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      particles.forEach(p => {
        p.vy += 0.045; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life > 0) {
          ctx.beginPath();
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.life;
          ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
      particles = particles.filter(p => p.life > 0);

      if (spawning || particles.length) {
        requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, width, height);
        window.removeEventListener('resize', resize);
      }
    }

    fireworkOverlay.classList.add('active');
    fireworkOverlay.addEventListener('click', stop);

    spawnBurst();
    burstInterval = setInterval(spawnBurst, 450);
    requestAnimationFrame(tick);

    setTimeout(stop, 3200);
  }

  function renderReport({ totalScore, totalPossible, answeredCount, totalQuestions, sections }) {
    const band = bandForRatio(totalScore, totalPossible);

    if (band.key === 'green' && totalScore === totalPossible) {
      launchFireworks();
    }

    const report = document.createElement('div');
    report.className = `ce-quiz-report ce-quiz-report--${band.key}`;

    const top = document.createElement('div');
    top.className = 'ce-quiz-report-top';

    const badge = document.createElement('span');
    badge.className = 'ce-quiz-report-badge';
    badge.textContent = band.label;

    const scoreWrap = document.createElement('div');
    scoreWrap.className = 'ce-quiz-report-score';
    const scoreNum = document.createElement('span');
    scoreNum.className = 'ce-quiz-report-score-num';
    scoreNum.textContent = '0';
    const scoreTotal = document.createElement('span');
    scoreTotal.className = 'ce-quiz-report-score-total';
    scoreTotal.textContent = `/ ${totalPossible}`;
    scoreWrap.append(scoreNum, scoreTotal);

    top.append(badge, scoreWrap);

    const message = document.createElement('p');
    message.className = 'ce-quiz-report-message';
    message.textContent = band.message;

    const sectionsWrap = document.createElement('div');
    sectionsWrap.className = 'ce-quiz-report-sections';
    const fills = [];

    const gapStatusLabel = { yes: 'Compliant', maybe: 'Partially in place', no: 'Not in place', notsure: 'Not sure', unanswered: 'Not answered' };

    sections.forEach(s => {
      const sBand = bandForRatio(s.score, s.possible);
      const block = document.createElement('div');
      block.className = 'ce-quiz-report-section-block';

      const row = document.createElement('div');
      row.className = `ce-quiz-report-section-row ${sBand.key}`;

      const name = document.createElement('span');
      name.className = 'ce-quiz-report-section-name';
      name.textContent = s.name;

      const bar = document.createElement('div');
      bar.className = 'ce-quiz-report-bar';
      const fill = document.createElement('div');
      fill.className = 'ce-quiz-report-bar-fill';
      bar.appendChild(fill);

      const scoreLabel = document.createElement('span');
      scoreLabel.className = 'ce-quiz-report-section-score';
      scoreLabel.textContent = `${s.score}/${s.possible}`;

      row.append(name, bar, scoreLabel);

      const gaps = s.gaps || [];
      // Every answered question now has something to reveal: a real
      // recommendation for anything short of full marks, or the "Well
      // done" message for a perfect "yes" -- so the toggle always shows
      // once there's a gap entry at all.
      if (gaps.length) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ce-quiz-report-gap-toggle';
        toggle.textContent = 'Show me';
        toggle.setAttribute('aria-expanded', 'false');
        row.appendChild(toggle);

        const detail = document.createElement('div');
        detail.className = 'ce-quiz-report-section-detail';
        const detailInner = document.createElement('div');
        detailInner.className = 'ce-quiz-report-section-detail-inner';
        const list = document.createElement('ul');
        list.className = 'ce-quiz-report-gap-list';

        gaps.forEach(g => {
          const item = document.createElement('li');
          item.className = `ce-quiz-report-gap gap-${g.status}`;

          const gtop = document.createElement('div');
          gtop.className = 'ce-quiz-report-gap-top';
          const qText = document.createElement('span');
          qText.className = 'ce-quiz-report-gap-q';
          qText.textContent = g.title;
          const tag = document.createElement('span');
          tag.className = 'ce-quiz-report-gap-tag';
          tag.textContent = gapStatusLabel[g.status];
          gtop.append(qText, tag);
          item.append(gtop);

          if (g.recommendation) {
            const rec = document.createElement('p');
            rec.className = 'ce-quiz-report-gap-rec';
            rec.textContent = g.recommendation;
            item.append(rec);
          }

          list.appendChild(item);
        });

        detailInner.appendChild(list);
        detail.appendChild(detailInner);

        toggle.addEventListener('click', () => {
          const expanded = toggle.getAttribute('aria-expanded') === 'true';
          toggle.setAttribute('aria-expanded', String(!expanded));
          toggle.textContent = expanded ? 'Show me' : 'Hide';
          detail.classList.toggle('expanded', !expanded);
        });

        block.append(row, detail);
      } else {
        block.appendChild(row);
      }

      sectionsWrap.appendChild(block);
      fills.push({ fill, pct: s.possible ? (s.score / s.possible) * 100 : 0 });
    });

    report.append(top, message, sectionsWrap);

    if (answeredCount < totalQuestions) {
      const note = document.createElement('p');
      note.className = 'ce-quiz-report-incomplete';
      note.textContent = `You've answered ${answeredCount} of ${totalQuestions} questions — answer them all for an accurate result.`;
      report.appendChild(note);
    }

    resultDiv.innerHTML = '';
    resultDiv.appendChild(report);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      report.classList.add('show');
      fills.forEach(({ fill, pct }) => { fill.style.width = `${pct}%`; });
    }));

    animateCount(scoreNum, totalScore, 700);

    if (emailReportBlock) {
      emailReportBlock.hidden = false;
      emailReportForm.reset();
      if (emailReportMessage) {
        const sectionBlocks = sections.map(s => {
          const header = `${s.name} (${s.score}/${s.possible})`;
          const lines = (s.gaps || []).map(g => `- ${g.title} — ${gapStatusLabel[g.status]}`);
          return [header, ...lines].join('\n');
        });
        emailReportMessage.value = `${band.label} — ${totalScore}/${totalPossible}\n\n` + sectionBlocks.join('\n\n');
      }
      emailReportStatus.textContent = '';
      emailReportStatus.className = 'ce-quiz-email-report-status';
      const submitBtn = emailReportForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  // "Request my report" — a plain Formspree HTML form. The browser posts and
  // navigates directly to Formspree, so no fetch/CORS involved here.
  const emailReportBlock = document.getElementById('ce-quiz-email-report');
  const emailReportForm = document.getElementById('ce-quiz-email-report-form');
  const emailReportMessage = document.getElementById('ce-quiz-email-report-message');
  const emailReportStatus = document.getElementById('ce-quiz-email-report-status');

  if (emailReportForm && emailReportStatus) {
    emailReportForm.addEventListener('submit', () => {
      const submitBtn = emailReportForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      emailReportStatus.textContent = 'Sending…';
      emailReportStatus.className = 'ce-quiz-email-report-status pending';
    });
  }

  if (showBtn && resultDiv) {
    showBtn.addEventListener('click', () => {
      const sectionEls = Array.from(document.querySelectorAll('.ce-quiz .ce-quiz-section'));
      let totalScore = 0;
      let totalPossible = 0;
      let answeredCount = 0;
      let totalQuestions = 0;

      const sections = sectionEls.map(section => {
        const heading = section.querySelector('h2');
        const questions = Array.from(section.querySelectorAll('.ce-quiz-question'));
        let sectionScore = 0;
        let sectionAnswered = 0;
        const gaps = [];
        questions.forEach(q => {
          totalQuestions++;
          const checked = q.querySelector('input[type="radio"]:checked');
          const titleEl = q.querySelector('.ce-quiz-q-title');
          const title = titleEl ? titleEl.textContent.replace(/^\d+\.\s*/, '').trim() : '';
          const anyRadio = q.querySelector('input[type="radio"]');
          const recommendation = anyRadio ? RECOMMENDATIONS[anyRadio.name] : undefined;
          if (checked) {
            sectionScore += scoreValue(checked);
            sectionAnswered++;
            answeredCount++;
            const val = (checked.value || '').toLowerCase();
            if (val === 'yes') gaps.push({ title, status: 'yes', recommendation: WELL_DONE_MESSAGE });
            if (val === 'maybe') gaps.push({ title, status: 'maybe', recommendation });
            if (val === 'no') gaps.push({ title, status: 'no', recommendation });
            if (val === 'notsure') gaps.push({ title, status: 'notsure', recommendation });
          } else {
            gaps.push({ title, status: 'unanswered', recommendation });
          }
        });
        const sectionPossible = questions.length * 3;
        totalScore += sectionScore;
        totalPossible += sectionPossible;
        return {
          name: heading ? heading.textContent.trim() : 'Section',
          score: sectionScore,
          possible: sectionPossible,
          gaps
        };
      });

      renderReport({ totalScore, totalPossible, answeredCount, totalQuestions, sections });
    });
  }
});
