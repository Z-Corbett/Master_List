import { test, expect, Page } from '@playwright/test';

const URL = '/lab/160-makeover-law-office.html';
const NEEDLE = 'Aldana Whitcombe';
const TYPES = ['LegalService', 'Attorney'];
const TEL = 'tel:+12145550187';
// The office's hours as the test's own table (minutes after midnight, Central), keyed by JS weekday.
const HOURS: Record<number, [number, number][]> = { 0: [], 1: [[510, 1050]], 2: [[510, 1050]], 3: [[510, 1050]], 4: [[510, 1050]], 5: [[510, 960]], 6: [] };
const IDS = ['contrast', 'alt', 'labels', 'headings', 'title', 'meta', 'jsonld', 'h1', 'viewport', 'tap', 'font'];
const CAT: Record<string, string[]> = { a11y: IDS.slice(0, 4), seo: IDS.slice(4, 8), mobile: IDS.slice(8) };

const ready = (page: Page) => expect.poll(() => page.evaluate(() => (window as any).__makeover?.ready === true)).toBe(true);

/* ---------- WCAG 2 contrast, written out here from the spec (sRGB → relative luminance) ---------- */
type RGBA = [number, number, number, number];
const parse = (s: string): RGBA => {
  const n = (s.match(/[\d.]+/g) || []).map(Number);
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n.length > 3 ? n[3] : (s.startsWith('rgb') ? 1 : 0)];
};
const channel = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const blend = (top: RGBA, under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));

/* ---------- raw facts from a frame; every judgement is made below, in Node ---------- */
async function facts(page: Page, side: 'before' | 'after') {
  return page.evaluate((side) => {
    const d = (document.querySelector(`[data-testid="frame-${side}"]`) as HTMLIFrameElement).contentDocument!;
    const w = d.defaultView!;
    const shown = (el: Element) => { const r = el.getBoundingClientRect(); return w.getComputedStyle(el).visibility === 'visible' && r.width > 0 && r.height > 0; };
    const parents = new Set<Element>();
    const walk = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.nodeValue!.trim() && n.parentElement) parents.add(n.parentElement);
    const texts = [...parents].filter((el) => !['SCRIPT', 'STYLE', 'OPTION', 'NOSCRIPT', 'TEMPLATE', 'TITLE'].includes(el.tagName) && !el.closest('svg') && shown(el))
      .map((el) => {
        const chain: string[] = [];
        for (let n: Element | null = el; n; n = n.parentElement) chain.push(w.getComputedStyle(n).backgroundColor);
        const s = w.getComputedStyle(el);
        return { color: s.color, chain, size: parseFloat(s.fontSize), weight: parseInt(s.fontWeight, 10), text: (el.textContent || '').trim().slice(0, 40) };
      });
    const fields = [...d.body.querySelectorAll('input, select, textarea')].filter((el) => !/^(hidden|submit|button|reset|image)$/i.test((el as HTMLInputElement).type) || el.tagName !== 'INPUT')
      .map((el) => {
        const aria = (el.getAttribute('aria-label') || '').trim();
        const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => d.getElementById(id)?.textContent?.trim() || '').join('');
        const lab = [...((el as HTMLInputElement).labels || [])].map((l) => l.textContent!.trim()).join('');
        return !!(aria || by || lab);
      });
    const taps = [...d.body.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"]')].filter(shown)
      .map((el) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; });
    return {
      texts, fields, taps,
      imgs: [...d.body.querySelectorAll('img')].map((i) => i.hasAttribute('alt')),
      svgImgs: [...d.body.querySelectorAll('svg[role="img"]')].map((s) => !!((s.getAttribute('aria-label') || '').trim() || s.getAttribute('aria-labelledby') || s.querySelector('title'))),
      headings: [...d.body.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => +h.tagName.slice(1)),
      h1text: [...d.body.querySelectorAll('h1')].map((h) => h.textContent!.trim()),
      title: d.title.trim(),
      meta: d.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '',
      viewport: d.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
      ld: [...d.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent || ''),
      bodyPx: parseFloat(w.getComputedStyle(d.body).fontSize),
    };
  }, side);
}
type Facts = Awaited<ReturnType<typeof facts>>;

function oracle(f: Facts) {
  const r: Record<string, { pass: boolean; [k: string]: unknown }> = {};
  const bgOf = (chain: string[]) => {
    const layers: RGBA[] = [];
    for (const c of chain) { const p = parse(c); if (p[3] > 0) layers.push(p); if (p[3] >= 1) break; }
    return layers.reverse().reduce<number[]>((under, top) => blend(top, under), [255, 255, 255]);
  };
  const low = f.texts.filter((t) => {
    const bg = bgOf(t.chain);
    const big = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
    return contrast(blend(parse(t.color), bg), bg) < (big ? 3 : 4.5);
  });
  r.contrast = { pass: low.length === 0, fail: low.length, total: f.texts.length };
  const noAlt = f.imgs.filter((x) => !x).length + f.svgImgs.filter((x) => !x).length;
  r.alt = { pass: noAlt === 0, fail: noAlt, total: f.imgs.length + f.svgImgs.length };
  const unl = f.fields.filter((x) => !x).length;
  r.labels = { pass: unl === 0, fail: unl, total: f.fields.length };
  const h = f.headings;
  r.headings = { pass: h[0] === 1 && h.every((l, i) => i === 0 || l - h[i - 1] <= 1), levels: h.join(',') };
  r.title = { pass: f.title.length >= 10 && f.title.length <= 60 && f.title.includes(NEEDLE) };
  r.meta = { pass: f.meta.length >= 50 && f.meta.length <= 160, length: f.meta.length };
  let type = 'none', ok = false, broken = false;
  for (const src of f.ld) {
    let j: any;
    try { j = JSON.parse(src); } catch { broken = true; continue; }
    for (const it of Array.isArray(j) ? j : j['@graph'] ?? [j]) {
      const ts = ([] as string[]).concat(it['@type'] ?? []);
      if (type === 'none') type = ts.join(',') || 'untyped';
      if (ts.some((t) => TYPES.includes(t)) && it.name && it.telephone && it.address) ok = true;
    }
  }
  r.jsonld = { pass: ok, type: type === 'none' && broken ? 'invalid' : type };
  r.h1 = { pass: f.h1text.length === 1 && f.h1text[0] !== '', count: f.h1text.length };
  const vp = f.viewport.replace(/\s/g, '');
  r.viewport = { pass: vp.includes('width=device-width') && !/user-scalable=(no|0)/.test(vp) && !/maximum-scale=1(\.0*)?(,|$)/.test(vp) };
  const small = f.taps.filter(([w, hh]) => w < 24 || hh < 24).length;
  r.tap = { pass: small === 0, fail: small, total: f.taps.length };
  const tiny = f.texts.filter((t) => t.size < 12).length;
  r.font = { pass: tiny === 0 && f.bodyPx >= 16, fail: tiny, total: f.texts.length, body: f.bodyPx };
  return { r, low };
}

async function expectScorecardMatches(page: Page, side: 'before' | 'after') {
  const { r } = oracle(await facts(page, side));
  for (const id of IDS) {
    const cell = page.getByTestId(`chk-${side}-${id}`);
    for (const [k, v] of Object.entries(r[id])) await expect(cell, `${side} ${id} ${k}`).toHaveAttribute(`data-${k}`, String(v));
  }
  for (const [c, ids] of Object.entries(CAT)) await expect(page.getByTestId(`cat-${side}-${c}`)).toHaveText(`${ids.filter((i) => r[i].pass).length}/${ids.length}`);
  const total = IDS.filter((i) => r[i].pass).length;
  await expect(page.getByTestId(`score-${side}`)).toHaveText(`${total}/11`);
  return total;
}

/* ---------- Central time, from the published US rule (CDT = UTC−5 from 8 Mar to 1 Nov 2026, else CST = UTC−6) ---------- */
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const t12 = (m: number) => m === 720 ? 'noon' : `${Math.floor(m / 60) % 12 || 12}${m % 60 ? ':' + String(m % 60).padStart(2, '0') : ''} ${m < 720 ? 'AM' : 'PM'}`;
function expected(iso: string, offsetHours: number) {
  const local = new Date(Date.parse(iso) + offsetHours * 3600_000);
  const day = local.getUTCDay(), min = local.getUTCHours() * 60 + local.getUTCMinutes();
  const now = HOURS[day].find(([o, c]) => min >= o && min < c);
  if (now) return `Open now · until ${t12(now[1])}`;
  for (let k = 0; k < 8; k++) {
    const d = (day + k) % 7;
    const next = HOURS[d].find(([o]) => k > 0 || o > min);
    if (next) return `Closed now · opens ${k === 0 ? 'today' : k === 1 ? 'tomorrow' : DAY_LONG[d]} at ${t12(next[0])}`;
  }
  return 'Closed now';
}

test.describe('160 Aldana Whitcombe Family Law makeover', () => {
  test('scorecard numbers match an independent in-test computation for both versions', async ({ page }) => {
    await page.goto(URL);
    await ready(page);
    const before = await expectScorecardMatches(page, 'before');
    const after = await expectScorecardMatches(page, 'after');
    expect(before).toBeLessThanOrEqual(2);
    expect(after).toBe(11);
    await expect(page.getByTestId('scorecard')).toContainText('11 in-page checks');
    await expect(page.getByTestId('scorecard')).toContainText('Not a Lighthouse score');
  });

  test('the scorecard is recomputed, and still matches, after switching preview width', async ({ page }) => {
    await page.goto(URL);
    await ready(page);
    for (const dev of ['phone', 'desktop', 'phone'] as const) {
      await page.getByTestId(`dev-${dev}`).check();
      await expect.poll(() => page.evaluate(() => (window as any).__makeover.frames.after.width)).toBe(dev === 'phone' ? 390 : 1024);
      await expectScorecardMatches(page, 'after');
      await expectScorecardMatches(page, 'before');
    }
  });

  test('after: every text element passes WCAG AA, even inside opened FAQ answers', async ({ page }) => {
    // The formula first, against published reference values.
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2);
    expect(contrast([0x77, 0x77, 0x77], [255, 255, 255])).toBeLessThan(4.5);
    await page.goto(URL);
    await ready(page);
    await page.frameLocator('[data-testid="frame-after"]').locator('details').evaluateAll((els) => els.forEach((e) => ((e as HTMLDetailsElement).open = true)));
    const { r, low } = oracle(await facts(page, 'after'));
    expect(low.map((t) => t.text)).toEqual([]);
    expect(r.contrast.total as number).toBeGreaterThan(60);
    // and the old site really is low-contrast
    const old = oracle(await facts(page, 'before'));
    expect(old.r.contrast.fail as number).toBeGreaterThan(10);
  });

  test('after: LegalService JSON-LD parses and agrees with the visible phone and hours; the old one was invalid', async ({ page }) => {
    await page.goto(URL);
    await ready(page);
    const f = page.frameLocator('[data-testid="frame-after"]');
    const src = await f.locator('script[type="application/ld+json"]').textContent();
    const j = JSON.parse(src!);
    expect(j['@context']).toBe('https://schema.org');
    expect(j['@type']).toBe('LegalService');
    expect(j.name).toBe('Aldana Whitcombe Family Law');
    expect('tel:' + j.telephone).toBe(TEL);
    expect(j.address).toMatchObject({ '@type': 'PostalAddress', addressLocality: 'Dallas', addressRegion: 'TX', addressCountry: 'US' });
    expect(j.aggregateRating).toBeUndefined(); // sample reviews must not become rating markup
    // Expand openingHoursSpecification to one entry per day and compare with the visible table.
    const toMin = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3);
    const spec: Record<string, string> = {};
    for (const o of j.openingHoursSpecification) for (const d of [].concat(o.dayOfWeek)) spec[d] = `${o.opens}-${o.closes}`;
    for (let d = 0; d < 7; d++) {
      const row = f.locator(`tr[data-day="${d}"]`);
      if (!HOURS[d].length) { expect(spec[DAY_LONG[d]]).toBeUndefined(); await expect(row).toContainText('Closed'); continue; }
      const [o, c] = spec[DAY_LONG[d]].split('-').map(toMin);
      expect([[o, c]]).toEqual(HOURS[d]);
      await expect(row).toHaveText(`${DAY_LONG[d]}${t12(o)} – ${t12(c)}`);
    }
    // The old site's JSON-LD is there but has a trailing comma: JSON.parse must reject it, and the scorecard says so.
    const old = await page.frameLocator('[data-testid="frame-before"]').locator('script[type="application/ld+json"]').textContent();
    expect(old).toContain('"@type": "Attorney"');
    expect(() => JSON.parse(old!)).toThrow(SyntaxError);
    await expect(page.getByTestId('chk-before-jsonld')).toHaveAttribute('data-type', 'invalid');
    await expect(page.getByTestId('chk-before-jsonld')).toContainText('not valid JSON');
  });

  test('open/closed-now flips at 5:30 PM Central (CDT), whatever the machine time zone', async ({ browser, baseURL }) => {
    const iso = '2026-10-01T17:29:00-05:00';
    expect(new Date(Date.UTC(2026, 9, 1)).getUTCDay()).toBe(4); // a Thursday
    expect(expected(iso, -5)).toBe('Open now · until 5:30 PM');
    expect(expected('2026-10-01T17:30:00-05:00', -5)).toBe('Closed now · opens tomorrow at 8:30 AM');
    for (const timezoneId of ['Pacific/Kiritimati', 'America/Los_Angeles']) {
      const ctx = await browser.newContext({ timezoneId, baseURL });
      const p = await ctx.newPage();
      await p.clock.install({ time: new Date('2026-10-01T17:28:00-05:00') });
      await p.goto(URL);
      await p.clock.pauseAt(new Date(iso));
      await ready(p);
      expect(await p.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(timezoneId);
      const badge = p.frameLocator('[data-testid="frame-after"]').locator('[data-hours-status]');
      await expect(badge).toHaveText(expected(iso, -5));
      await expect(badge).toHaveClass(/is-open/);
      await expect(p.frameLocator('[data-testid="frame-after"]').locator('tr[aria-current="date"]')).toHaveAttribute('data-day', '4');
      await p.clock.runFor(61_000);
      await expect(badge).toHaveText('Closed now · opens tomorrow at 8:30 AM');
      await expect(badge).toHaveClass(/is-closed/);
      await ctx.close();
    }
  });

  test('opening boundary in CST, the early Friday close and the weekend', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-12-07T08:28:00-06:00') }); // Monday, standard time
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-12-07T08:29:00-06:00'));
    await ready(page);
    const badge = page.frameLocator('[data-testid="frame-after"]').locator('[data-hours-status]');
    await expect(badge).toHaveText(expected('2026-12-07T08:29:00-06:00', -6));
    await expect(badge).toHaveText('Closed now · opens today at 8:30 AM');
    await page.clock.runFor(61_000);
    await expect(badge).toHaveText('Open now · until 5:30 PM');
    const cases: [string, string][] = [
      ['2026-12-11T15:58:00-06:00', 'Open now · until 4 PM'],                 // Friday
      ['2026-12-12T12:00:00-06:00', 'Closed now · opens Monday at 8:30 AM'],  // Saturday
      ['2026-12-13T10:00:00-06:00', 'Closed now · opens tomorrow at 8:30 AM'], // Sunday
    ];
    for (const [iso, text] of cases) {
      expect(expected(iso, -6)).toBe(text);
      await page.clock.setSystemTime(new Date(iso));
      await page.clock.runFor(61_000);
      // each case holds for the whole minute in which the page's next tick can land
      expect(expected(new Date(Date.parse(iso) + 61_000).toISOString(), -6)).toBe(text);
      await expect(badge).toHaveText(text);
    }
  });

  test('tap-to-call: every phone link dials the same tel: number, and the old site had none', async ({ page }) => {
    await page.goto(URL);
    await ready(page);
    const f = page.frameLocator('[data-testid="frame-after"]');
    const tels = f.locator('a[href^="tel:"]');
    expect(await tels.count()).toBeGreaterThanOrEqual(2);
    for (const href of await tels.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) expect(href).toBe(TEL);
    await expect(f.locator('[data-fix="phone"]')).toHaveText('Call (214) 555-0187');
    await expect(f.locator('[data-fix="cta"] a').first()).toHaveText('Request a consultation');
    await f.locator('[data-fix="phone"]').click();
    await expect.poll(() => page.evaluate(() => (window as any).__makeover.dialed)).toBe(TEL);
    await expect(page.getByTestId('announce')).toHaveText('Demo: on a phone this would dial (214) 555-0187.');
    const old = page.frameLocator('[data-testid="frame-before"]');
    await expect(old.locator('a[href^="tel:"]')).toHaveCount(0);
    await expect(old.locator('img[data-fix="phone"]')).not.toHaveAttribute('alt', /./);
    expect(await old.locator('body').innerText()).not.toMatch(/555.?0187/); // the number exists only inside a picture
  });

  test('before/after toggle is keyboard accessible (tabs with arrow keys, Home and End)', async ({ page }) => {
    await page.goto(URL);
    await ready(page);
    const before = page.getByRole('tab', { name: 'Before' }), after = page.getByRole('tab', { name: 'After' });
    await expect(after).toHaveAttribute('aria-selected', 'true');
    await expect(before).toHaveAttribute('tabindex', '-1');
    await after.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(before).toBeFocused();
    await expect(before).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('frame-before')).toBeVisible();
    await expect(page.getByTestId('frame-after')).toBeHidden();
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-before');
    await expect(page.getByTestId('announce')).toHaveText('Showing the old Aldana Whitcombe site (before).');
    await page.keyboard.press('ArrowLeft'); // wraps
    await expect(after).toBeFocused();
    await page.keyboard.press('Home');
    await expect(before).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(after).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('frame-after')).toBeVisible();
    // Tab leaves the tablist in one step (roving tabindex)
    await page.keyboard.press('Tab');
    await expect(before).not.toBeFocused();
    await expect(after).not.toBeFocused();
  });

  test('no horizontal scroll with the 980 px old site shown on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(URL + '?view=before');
    await ready(page);
    await expect(page.getByRole('tab', { name: 'Before' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('dev-phone')).toBeChecked();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const dev of ['phone', 'desktop'] as const) {
      await page.getByTestId(`dev-${dev}`).check();
      const fr = await page.evaluate(() => (window as any).__makeover.frames.before);
      expect(fr.width).toBe(980);
      expect(fr.scale).toBeLessThan(0.4);
      expect(await overflow()).toBeLessThanOrEqual(1);
      const box = await page.getByTestId('viewport').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    }
    await expect(page.getByTestId('scale-note')).toContainText('laid out at 980 px');
  });

  test('"What changed" highlights each fix in the right frame and scrolls to it', async ({ page }) => {
    await page.goto(URL);
    await ready(page);
    const buttons = page.locator('[data-testid^="show-"]');
    const n = await buttons.count();
    expect(n).toBeGreaterThanOrEqual(15);
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      const [, fix, side] = /^show-(.+)-(before|after)$/.exec((await b.getAttribute('data-testid'))!)!;
      await b.click();
      await expect(page.getByRole('tab', { name: side === 'before' ? 'Before' : 'After' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId(`fix-${fix}`)).toHaveClass(/active/);
      const hl = page.frameLocator(`[data-testid="frame-${side}"]`).locator('.mk-hl');
      await expect(hl).toHaveCount(1);
      await expect(hl).toHaveAttribute('data-fix', fix);
      const inView = await hl.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < el.ownerDocument.defaultView!.innerHeight; });
      expect(inView, `${fix} on ${side} scrolled into view`).toBe(true);
    }
    // Fixes that live in <head> show the real markup from each frame instead.
    await expect(page.getByTestId('fix-mobile')).toContainText('Before: (no viewport meta)');
    await expect(page.getByTestId('fix-mobile')).toContainText('<meta name="viewport" content="width=device-width, initial-scale=1">');
    await expect(page.getByTestId('fix-seo')).toContainText('<title>Aldana Whitcombe Attorneys at Law - Divorce Lawyer Dallas');
    await expect(page.getByTestId('fix-schema')).toContainText('Before: JSON-LD present but not valid JSON');
    await expect(page.getByTestId('fix-schema')).toContainText('@type LegalService');
  });

  test('legal copy: attorney-advertising disclaimer, no promised outcomes, careful intake form', async ({ page }) => {
    await page.goto(URL);
    await ready(page);
    const f = page.frameLocator('[data-testid="frame-after"]');
    const disclaimer = f.locator('.disclaimer');
    await expect(disclaimer).toContainText('Attorney advertising.');
    await expect(disclaimer).toContainText('is not legal advice');
    await expect(disclaimer).toContainText('does not create an attorney–client relationship');
    await expect(disclaimer).toContainText('no particular outcome is promised or guaranteed');
    await expect(disclaimer).toContainText('This is a fictional law firm');
    // Outside that disclaimer, nothing promises a result.
    const copy = await f.locator('body').evaluate((b) => { const c = b.cloneNode(true) as HTMLElement; c.querySelector('.disclaimer')!.remove(); return c.innerText; });
    expect(copy).not.toMatch(/guarantee|we (will )?win|know how to win|aggressive/i);
    // The old site did, and "What changed" points at it.
    const old = await page.frameLocator('[data-testid="frame-before"]').locator('[data-fix="claims"]').innerText();
    expect(old).toMatch(/GUARANTEED RESULTS/);
    await page.getByTestId('show-claims-before').click();
    await expect(page.frameLocator('[data-testid="frame-before"]').locator('.mk-hl')).toHaveAttribute('data-fix', 'claims');
    // The consultation form can't be sent without acknowledging there's no attorney–client relationship yet.
    const ack = f.getByLabel(/does not make me a client/);
    await expect(ack).toHaveAttribute('required', '');
    await expect(f.locator('#consult')).toContainText('Please don’t include confidential details');
  });

  test('services CTA, fiction labels and a demo form that sends nothing', async ({ page }) => {
    const requests: string[] = [];
    await page.goto(URL);
    await ready(page);
    page.on('request', (r) => requests.push(r.url()));
    const cta = page.getByTestId('services-cta');
    await expect(cta).toHaveAttribute('href', '../index.html#services');
    await expect(cta).toContainText('$1,200');
    await expect(page.getByTestId('footer')).toContainText('fictional business, created as a portfolio demo.');
    const f = page.frameLocator('[data-testid="frame-after"]');
    await expect(f.locator('footer')).toContainText('Fictional business, created as a portfolio demo.');
    await expect(f.locator('[data-fix="reviews"]')).toContainText('Sample text');
    await f.getByLabel('Your name').fill('Test Client');
    await f.getByLabel('Phone').fill('2145550100');
    await f.getByLabel('Type of matter').selectOption('Mediation');
    await f.getByRole('button', { name: 'Request my consultation' }).click();
    await expect(f.locator('[data-form-status]')).toBeEmpty(); // blocked: the acknowledgement is required
    await f.getByLabel(/does not make me a client/).check();
    await f.getByRole('button', { name: 'Request my consultation' }).click();
    await expect(f.locator('[data-form-status]')).toHaveText(/nothing was sent/);
    expect(requests).toEqual([]);
    // the new status line is text too, so the scorecard re-ran and still matches
    await expectScorecardMatches(page, 'after');
  });
});
