(() => {
  'use strict';
  const PROJECTS = window.PROJECTS || [];
  const $ = (s, el = document) => el.querySelector(s);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const REPO = 'https://github.com/Z-Corbett/Master_List/blob/master/';

  const hrefOf = (p) => p.url || p.file;
  const numberOf = (p) => (p.kind === 'lab' ? `#${p.id}` : p.kind === 'client' ? 'Client' : 'Classic');
  const lab = PROJECTS.filter((p) => p.kind === 'lab');
  const totalTests = lab.reduce((n, p) => n + (p.tests || 0), 0);

  // ---------- Theme ----------
  const themeBtn = $('[data-testid="theme-toggle"]');
  themeBtn.addEventListener('click', () => {
    const root = document.documentElement;
    const isDark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = isDark ? 'light' : 'dark';
    try { localStorage.setItem('zc-theme', root.dataset.theme); } catch {}
  });

  // ---------- Stats ----------
  const setStat = (k, v) => { const el = $(`[data-stat="${k}"]`); if (el) el.textContent = v; };
  setStat('lab', lab.length);
  setStat('tests', totalTests * 2); // every spec runs on desktop + mobile projects
  setStat('clients', PROJECTS.filter((p) => p.kind === 'client').length);
  document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));

  // ---------- Thumbnails ----------
  const hue = (id) => [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  function thumbHTML(p) {
    if (p.thumb) return `<img src="${esc(p.thumb)}" alt="" loading="lazy" decoding="async">`;
    const h = hue(p.id);
    return `<span class="card__ph" style="background:linear-gradient(135deg,hsl(${h} 70% 45%),hsl(${(h + 60) % 360} 70% 30%))">${esc(p.id)}</span>`;
  }

  // Show a screenshot whole (over a blurred fill) when its aspect ratio doesn't match its frame,
  // e.g. the square 800×800 client shots in 16:10 frames. Matching screenshots keep a full-bleed crop.
  function fitThumb(frame) {
    const img = frame && $('img', frame);
    if (!img) return;
    const run = () => {
      if (!img.naturalWidth || !frame.clientHeight) return;
      const box = frame.clientWidth / frame.clientHeight;
      const fits = Math.abs(img.naturalWidth / img.naturalHeight - box) / box > 0.12;
      frame.classList.toggle('is-fit', fits);
      // Absolute URL: a relative url() in a custom property resolves against the stylesheet, not the page.
      if (fits) frame.style.setProperty('--thumb-bg', `url("${img.currentSrc || img.src}")`);
    };
    if (img.complete) run(); else img.addEventListener('load', run, { once: true });
  }
  let resizeRaf = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => document.querySelectorAll('.card__thumb, .wotd__thumb').forEach(fitThumb));
  });

  // ---------- Cards ----------
  function badge(p) {
    return p.kind === 'lab' && p.tests
      ? `<span class="badge" title="${p.tests} tests × desktop + mobile">✓ ${p.tests} tests passing</span>`
      : `<span class="badge badge--plan">QA plan</span>`;
  }
  function cardHTML(p) {
    const ext = !!p.url;
    return `<article class="card" data-testid="card" data-id="${esc(p.id)}">
      <a class="card__thumb" href="${esc(hrefOf(p))}" tabindex="-1" aria-hidden="true" ${ext ? 'target="_blank" rel="noopener"' : ''}>${thumbHTML(p)}</a>
      <div class="card__body">
        <div class="card__meta"><b>${esc(numberOf(p))}</b><span>${esc(p.category)}</span></div>
        <h3><a href="${esc(hrefOf(p))}" ${ext ? 'target="_blank" rel="noopener"' : ''}>${esc(p.title)}</a></h3>
        <p class="card__desc">${esc(p.description)}</p>
        <ul class="tags">${(p.tags || []).slice(0, 4).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <div class="card__foot">
          ${badge(p)}
          <div class="card__actions">
            ${p.prompt ? `<button class="mini" type="button" data-open="prompt" data-id="${esc(p.id)}">Prompt</button>` : ''}
            <button class="mini" type="button" data-open="qa" data-id="${esc(p.id)}" data-testid="qa-btn">QA</button>
          </div>
        </div>
      </div>
    </article>`;
  }

  // ---------- Search + filters ----------
  const CATS = ['All', ...new Set(PROJECTS.map((p) => p.category))];
  const ORDER = ['All', 'Client Work', 'QA & Testing', 'AI & Agents', 'Tools', 'Games', 'Generative', 'Data Viz', 'Landing Pages', 'Audio', 'Classic Demos'];
  CATS.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const params = new URLSearchParams(location.search);
  const state = { q: params.get('q') || '', cat: CATS.includes(params.get('cat')) ? params.get('cat') : 'All' };

  const search = $('[data-testid="search"]');
  const filters = $('[data-testid="filters"]');
  const grid = $('[data-testid="grid"]');
  const count = $('[data-testid="results-count"]');
  const empty = $('[data-testid="empty"]');
  search.value = state.q;

  const haystack = new Map(PROJECTS.map((p) => [p.id, [
    p.title, p.description, p.category, ...(p.tags || []), p.prompt,
    ...(p.qa?.methodology || []), p.qa?.playwright, ...(p.qa?.coverage || []),
  ].join(' ').toLowerCase()]));

  function matches(p) {
    if (state.cat !== 'All' && p.category !== state.cat) return false;
    const terms = state.q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const hay = haystack.get(p.id);
    return terms.every((t) => hay.includes(t));
  }

  function renderFilters() {
    filters.innerHTML = CATS.map((c) => {
      const n = c === 'All' ? PROJECTS.length : PROJECTS.filter((p) => p.category === c).length;
      return `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === state.cat}">${esc(c)} <small>${n}</small></button>`;
    }).join('');
  }

  function render() {
    const list = PROJECTS.filter(matches);
    grid.innerHTML = list.map(cardHTML).join('');
    grid.querySelectorAll('.card__thumb').forEach(fitThumb);
    empty.hidden = list.length > 0;
    $('.empty__q').textContent = `“${state.q}”${state.cat !== 'All' ? ` in ${state.cat}` : ''}`;
    count.textContent = `${list.length} of ${PROJECTS.length} projects${state.q ? ` matching “${state.q}”` : ''}${state.cat !== 'All' ? ` · ${state.cat}` : ''}`;
    const u = new URL(location.href);
    state.q ? u.searchParams.set('q', state.q) : u.searchParams.delete('q');
    state.cat !== 'All' ? u.searchParams.set('cat', state.cat) : u.searchParams.delete('cat');
    history.replaceState(null, '', u);
  }

  search.addEventListener('input', () => { state.q = search.value; render(); });
  filters.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    state.cat = b.dataset.cat;
    renderFilters(); render();
  });
  $('[data-testid="clear"]').addEventListener('click', () => {
    state.q = ''; state.cat = 'All'; search.value = '';
    renderFilters(); render(); search.focus();
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); search.focus(); search.select(); }
    if (e.key === 'Escape' && document.activeElement === search && search.value) { search.value = ''; state.q = ''; render(); }
  });

  // ---------- Website of the day ----------
  // Deterministic per local calendar day: a fixed seeded shuffle of the pool, indexed by day number.
  // Everyone sees the same pick on the same day, and consecutive days walk the whole collection.
  function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const pool = PROJECTS.filter((p) => p.thumb).map((p) => p.id).sort();
  const rand = mulberry32(20260922);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const localDayNumber = (d) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  const byId = (id) => PROJECTS.find((p) => p.id === id);
  const todaysId = () => pool[localDayNumber(new Date()) % pool.length];

  const wotd = $('[data-testid="wotd"]');
  let wotdId = todaysId();
  function renderWotd(id, animate) {
    const p = byId(id);
    if (!p) { wotd.hidden = true; return; }
    wotdId = id;
    wotd.dataset.id = id;
    const href = hrefOf(p);
    const thumb = $('.wotd__thumb', wotd);
    thumb.href = href;
    thumb.setAttribute('aria-label', `Open ${p.title}`);
    thumb.classList.remove('is-fit');
    $('img', thumb).src = p.thumb;
    fitThumb(thumb);
    $('.wotd__go', wotd).href = href;
    $('[data-testid="wotd-title"]', wotd).textContent = p.title;
    $('.wotd__desc', wotd).textContent = p.description;
    const isToday = id === todaysId();
    $('[data-testid="wotd-date"]', wotd).textContent = isToday
      ? `· ${new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`
      : '· bonus pick';
    if (animate && !reduceMotion) { wotd.classList.remove('is-swapping'); void wotd.offsetWidth; wotd.classList.add('is-swapping'); }
  }
  function tickNext() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const mins = Math.max(0, Math.round((midnight - now) / 60000));
    $('[data-testid="wotd-next"]', wotd).textContent = `New pick in ${Math.floor(mins / 60)}h ${mins % 60}m · ${pool.length} sites in rotation`;
    if (wotd.dataset.id !== todaysId() && $('[data-testid="wotd-date"]', wotd).textContent !== '· bonus pick') renderWotd(todaysId(), true);
  }
  renderWotd(wotdId);
  tickNext();
  setInterval(tickNext, 30000);
  $('[data-testid="wotd-shuffle"]').addEventListener('click', () => {
    const others = pool.filter((id) => id !== wotdId);
    renderWotd(others[Math.floor(Math.random() * others.length)], true);
  });
  $('[data-testid="wotd-qa"]').addEventListener('click', () => openModal(wotdId, 'qa'));

  // ---------- QA / Prompt dialog ----------
  const modal = $('[data-testid="modal"]');
  const tabsEl = $('.modal__tabs', modal);
  const body = $('.modal__body', modal);
  let current = null;

  function panel(p, tab) {
    const qa = p.qa || {};
    const li = (arr) => (arr || []).map((x) => `<li>${esc(x)}</li>`).join('');
    if (tab === 'prompt') {
      return `<h4>The brief I gave the agent</h4><p class="prompt" data-testid="prompt-text">${esc(p.prompt)}</p>
        <h4>How it was made</h4><p>Built by an AI coding agent from this brief, then reviewed, tested with Playwright on desktop and mobile, and fixed until green. The page is a single HTML file with no external requests.</p>`;
    }
    const specLink = p.spec ? `<a class="btn btn--ghost btn--sm" href="${REPO}${esc(p.spec)}" target="_blank" rel="noopener">View the spec ↗</a>` : '';
    return `
      ${p.kind === 'lab' ? `<p><span class="badge">✓ ${p.tests} tests × desktop + mobile</span></p>` : `<p><span class="badge badge--plan">QA plan · archived site, not under active test</span></p>`}
      <h4>Methodology</h4><ul data-testid="qa-methodology">${li(qa.methodology)}</ul>
      ${qa.risks?.length ? `<h4>Highest risks</h4><ul>${li(qa.risks)}</ul>` : ''}
      <h4>Playwright critique</h4><p class="critique" data-testid="qa-critique">${esc(qa.playwright)}</p>
      ${qa.coverage?.length ? `<h4>${p.kind === 'lab' ? 'What the spec covers' : 'What the suite would cover'}</h4><ul class="cov">${li(qa.coverage)}</ul>` : ''}
      ${p.a11y ? `<h4>Accessibility</h4><p>${esc(p.a11y)}</p>` : ''}
      <div class="modal__foot">
        <a class="btn btn--primary btn--sm" href="${esc(hrefOf(p))}" ${p.url ? 'target="_blank" rel="noopener"' : ''}>Open the page ↗</a>
        ${specLink}
      </div>`;
  }

  function showTab(tab) {
    tabsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
    body.innerHTML = panel(current, tab);
    body.scrollTop = 0;
  }

  function openModal(id, tab) {
    current = byId(id);
    if (!current) return;
    $('.modal__meta', modal).textContent = `${numberOf(current)} · ${current.category}`;
    $('.modal__title', modal).textContent = current.title;
    const tabs = [['qa', 'QA & Playwright'], ...(current.prompt ? [['prompt', 'Prompt']] : [])];
    tabsEl.innerHTML = tabs.map(([k, label]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="false">${label}</button>`).join('');
    showTab(tab === 'prompt' && current.prompt ? 'prompt' : 'qa');
    if (!modal.open) modal.showModal();
  }
  tabsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  grid.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openModal(b.dataset.id, b.dataset.open); });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); }); // click on backdrop

  // ---------- Terminal replay ----------
  const term = $('[data-testid="terminal"]');
  const pick = lab.find((p) => p.id === '001') || lab[0];
  const lines = [
    ['p', '$ claude "build Selector Gym: a Playwright locator trainer, with a spec"'],
    ['dim', '  ● Plan   brief → page → spec → run'],
    ['dim', `  ● Write  ${pick ? pick.file : 'lab/001-selector-gym.html'}`],
    ['dim', `  ● Write  ${pick?.spec || 'tests/lab/001-selector-gym.spec.ts'}`],
    ['dim', '  ● Run    playwright test --project=desktop --project=mobile'],
    ['', ''],
    ['p', '$ npx playwright test'],
    ['', `Running ${totalTests * 2} tests using 8 workers`],
    ...lab.slice(0, 6).map((p) => ['ok', `  ✓ [desktop] ${p.slug}.spec.ts (${p.tests})`]),
    ['dim', `  … ${Math.max(0, lab.length - 6)} more specs`],
    ['', ''],
    ['hl', `  ${totalTests * 2} passed`],
  ];
  // Follow the output like a real terminal, so the final "passed" line is never clipped.
  const paint = (html) => { term.innerHTML = html; term.scrollTop = term.scrollHeight; };
  const lineHTML = ([cls, text]) => (cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text));
  if (reduceMotion || !lab.length) {
    paint(lines.map(lineHTML).join('\n'));
  } else {
    let i = 0, ch = 0, out = [];
    const step = () => {
      if (i >= lines.length) { paint(out.join('\n') + '\n<span class="cursor"></span>'); return; }
      const [cls, text] = lines[i];
      const typed = cls === 'p';
      if (typed && ch < text.length) {
        ch += 2;
        paint([...out, lineHTML([cls, text.slice(0, ch)])].join('\n') + '<span class="cursor"></span>');
        return setTimeout(step, 18);
      }
      out.push(lineHTML(lines[i])); i++; ch = 0;
      paint(out.join('\n') + '<span class="cursor"></span>');
      setTimeout(step, typed ? 380 : cls === 'ok' ? 110 : 220);
    };
    new IntersectionObserver((entries, obs) => { if (entries[0].isIntersecting) { obs.disconnect(); step(); } }).observe(term);
  }

  renderFilters();
  render();
})();
