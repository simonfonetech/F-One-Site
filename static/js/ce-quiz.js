document.addEventListener('DOMContentLoaded', function () {
  // ---------- panel open/close ----------
  // In-page expand/collapse (CSS grid-template-rows 0fr->1fr on
  // .ce-quiz-panel), not a fixed overlay -- opening it pushes the rest
  // of the page down instead of floating on top of it.
  const trigger = document.getElementById('ce-quiz-trigger');
  const panel = document.getElementById('ce-quiz-panel');
  const closeBtn = document.getElementById('ce-quiz-close');

  if (!panel) return; // everything below only matters where the quiz markup exists

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

  // Scrolls to #cyber-essentials-heading and calls back once it's actually
  // arrived and stayed put. Waits for the webfont first (a no-op if it's
  // already loaded, which it usually is by the time anyone's clicked
  // anything) so the page's final text layout is what's being scrolled
  // to, not a pre-swap approximation of it. Then: settle whatever
  // scrolling the browser is already doing, cancel it with an instant
  // scroll to the current position (a new scroll command interrupts an
  // in-flight one, even to a no-op destination), scroll smoothly to the
  // heading, settle again, and correct once more if scroll-margin-top
  // wasn't respected exactly (fonts finishing mid-animation, etc.).
  function scrollToHeading(cb) {
    const heading = document.getElementById('cyber-essentials-heading');
    if (!heading) { if (cb) cb(); return; }
    const ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    ready.then(function () {
      whenScrollSettled(function () {
        window.scrollTo({ top: window.scrollY, behavior: 'instant' });
        heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
        whenScrollSettled(function () {
          const cs = window.getComputedStyle(heading);
          const wantTop = parseFloat(cs.scrollMarginTop) || 0;
          const actualTop = heading.getBoundingClientRect().top;
          if (Math.abs(actualTop - wantTop) > 2) {
            window.scrollTo({ top: window.scrollY + (actualTop - wantTop), behavior: 'instant' });
          }
          if (cb) cb();
        });
      });
    });
  }

  function openPanel() {
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

  function closePanel({ refocusTrigger } = {}) {
    panel.classList.remove('ce-quiz-open');
    panel.setAttribute('aria-hidden', 'true');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (refocusTrigger && trigger) trigger.focus({ preventScroll: true });
    // Closing can happen from anywhere in a long quiz + report, scrolled
    // well past the section it lives in -- send the user back to the
    // heading itself rather than leaving them stranded, the same robust
    // scroll every other path here uses.
    scrollToHeading();
    // Updates the URL to match without using location.hash directly --
    // setting location.hash to a value it's *already* set to is a no-op
    // in every browser (no scroll, no event), which is why this only
    // ever worked on the first close and silently did nothing on the
    // second, third, etc. pushState always updates the URL, and (unlike
    // location.hash) never triggers its own native jump that could
    // fight the scroll above.
    if (window.history && window.history.pushState) {
      window.history.pushState(null, '', '#cyber-essentials-heading');
    }
  }

  if (trigger) {
    trigger.addEventListener('click', () => {
      if (panel.classList.contains('ce-quiz-open')) closePanel();
      else goToReport();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', () => closePanel({ refocusTrigger: true }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('ce-quiz-open')) closePanel({ refocusTrigger: true });
  });

  // "Free Cyber Essentials Report" in the Services mega-menu links straight
  // to /it-essentials/#ce-quiz-panel.
  //
  // The mega-menu link with this href renders on every page site-wide,
  // but only /it-essentials/ has the panel/trigger to act on -- the click
  // listener attached to it below is only ever reached on this page (this
  // whole file returns early above on any page without the panel), so on
  // every other page the link stays a plain, normal one that navigates
  // here, landing on the openIfDeepLinked() path below once it arrives.
  function openIfDeepLinked() {
    if (window.location.hash !== '#ce-quiz-panel') return;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    if (window.history && window.history.pushState) {
      window.history.pushState(null, '', '#ce-quiz-panel');
    }
    goToReport();
  }
  openIfDeepLinked();
  // Covers a hash that's already there when this page loads (a fresh
  // navigation straight to the URL) or changes later (browser back/
  // forward, or a link elsewhere on the page pointing here). It does NOT
  // cover clicking the mega-menu link a *second* time while the hash is
  // already #ce-quiz-panel from the first click -- per spec, hashchange
  // only fires when the hash actually changes, and clicking a same-hash
  // link doesn't change it, so nothing above would run at all and only
  // the browser's own native (and, per the comment on scrollToHeading,
  // unreliable) scroll-to-#ce-quiz-panel would fire. The click handler
  // below covers that case directly, independent of whether the hash
  // "changes": it intercepts the click, so the browser's native jump
  // never gets a chance to start in the first place, and calls the exact
  // same goToReport() every time regardless of the panel's or the hash's
  // current state.
  document.querySelectorAll('a[href$="#ce-quiz-panel"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.history && window.history.pushState) {
        window.history.pushState(null, '', '#ce-quiz-panel');
      }
      goToReport();
    });
  });
  window.addEventListener('hashchange', openIfDeepLinked);

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

  function scoreValue(input) {
    const val = (input.value || '').toString().toLowerCase().trim();
    if (val === 'yes') return 3;
    if (val === 'maybe') return 2;
    // "not sure" scores the same as "no" -- neither demonstrates the
    // control is actually in place, so neither earns partial credit.
    if (val === 'no' || val === 'notsure') return 0;
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
            if (val === 'yes') gaps.push({ title, status: 'yes' });
            if (val === 'maybe') gaps.push({ title, status: 'maybe', recommendation });
            if (val === 'no') gaps.push({ title, status: 'no', recommendation });
            if (val === 'notsure') gaps.push({ title, status: 'notsure', recommendation });
          } else {
            gaps.push({ title, status: 'unanswered' });
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
