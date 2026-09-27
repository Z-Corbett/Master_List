import { test, expect, Page } from '@playwright/test';

const URL = '/lab/125-polyrhythm-metronome.html';
const S = (page: Page) => page.evaluate(() => (window as any).__poly.state);
const LOG = (page: Page) => page.evaluate(() => (window as any).__poly.log);
const PLAN = (page: Page, count: number, p: object) => page.evaluate(([c, p]) => (window as any).__poly.plan(c, p), [count, p] as const);

// Independent oracles. Polyrhythm: the tempo counts voice B, so a cycle lasts n·60/BPM seconds; voice A's k-th onset is
// k·cycle/m and voice B's is k·cycle/n. Two onsets coincide when k_a/m = k_b/n, which happens gcd(m, n) times per cycle.
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const cycleOf = (n: number, bpm: number) => (n * 60) / bpm;
/** Every onset in one cycle, merged: A and B times from the formula, coincident ones joined. */
function expectedCycle(m: number, n: number, bpm: number) {
  const c = cycleOf(n, bpm);
  const ev = new Map<string, { t: number; a: number | null; b: number | null }>();
  // key on the exact rational k/m (reduced) so coincidences are found without float comparison
  const key = (num: number, den: number) => { const g = gcd(num, den) || 1; return `${num / g}/${den / g}`; };
  for (let k = 0; k < m; k++) ev.set(key(k, m), { t: (k * c) / m, a: k, b: null });
  for (let k = 0; k < n; k++) { const id = key(k, n); const e = ev.get(id); if (e) e.b = k; else ev.set(id, { t: (k * c) / n, a: null, b: k }); }
  return [...ev.values()].sort((x, y) => x.t - y.t);
}

async function setBpm(page: Page, v: number) {
  await page.getByTestId('bpm').fill(String(v));
  await page.getByTestId('bpm').press('Enter');
}
/** Fake clock, paused; Web Audio removed (or wedged) so the scheduler runs on performance.now. */
async function silent(page: Page, mode: 'missing' | 'suspended' = 'missing') {
  await page.addInitScript((mode) => {
    if (mode === 'missing') { (window as any).AudioContext = undefined; (window as any).webkitAudioContext = undefined; return; }
    const Real = (window as any).AudioContext;
    class Stuck extends Real { get state() { return 'suspended'; } resume() { return new Promise(() => {}); } }
    (window as any).AudioContext = Stuck;
  }, mode);
  const t = new Date('2026-09-25T12:00:00Z');
  await page.clock.install({ time: t });
  await page.goto(URL);
  await page.clock.pauseAt(new Date(t.getTime() + 1000));
}

test.describe('125 Polyrhythm Metronome', () => {
  test('m:n plan: onsets at k·cycle/m and k·cycle/n, and coprime voices meet only at the cycle start', async ({ page }) => {
    await page.goto(URL);
    for (const [m, n, bpm] of [[3, 2, 90], [4, 3, 120], [5, 4, 72], [7, 5, 100], [2, 9, 240]]) {
      const exp = expectedCycle(m, n, bpm);
      const plan = await PLAN(page, exp.length * 2, { mode: 'poly', m, n, bpm });
      expect(plan).toHaveLength(exp.length * 2);
      expect(exp.length).toBe(m + n - 1);                                   // coprime: m + n onsets, one shared
      plan.forEach((e: any, i: number) => {
        const x = exp[i % exp.length], cyc = Math.floor(i / exp.length);
        expect(e.t).toBeCloseTo(cyc * cycleOf(n, bpm) + x.t, 9);
        expect(e.a).toBe(x.a);
        expect(e.b).toBe(x.b);
      });
      const both = plan.filter((e: any) => e.voice === 'AB');
      expect(both.map((e: any) => e.t)).toEqual([0, cycleOf(n, bpm)].map((t) => expect.closeTo(t, 9)));
      expect(both.every((e: any) => e.a === 0 && e.b === 0 && e.accent)).toBe(true);
    }
    // non-coprime shapes meet gcd(m, n) times per cycle, evenly spaced
    for (const [m, n] of [[4, 6], [6, 9], [8, 4]]) {
      const plan = await PLAN(page, 40, { mode: 'poly', m, n, bpm: 60 });
      const g = gcd(m, n), c = cycleOf(n, 60);
      const meet = plan.filter((e: any) => e.voice === 'AB' && e.cycle === 0).map((e: any) => e.t);
      expect(meet).toHaveLength(g);
      meet.forEach((t: number, j: number) => expect(t).toBeCloseTo((j * c) / g, 9));
    }
  });

  test('the dial: voice polygons with m and n vertices at k·360/m degrees, and a text description', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('input[name=mode][value=poly]')).toBeChecked();
    await page.getByTestId('preset-5-4').click();
    await expect(page.getByTestId('preset-5-4')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid^="vx-A-"]')).toHaveCount(5);
    await expect(page.locator('[data-testid^="vx-B-"]')).toHaveCount(4);
    for (const [v, count] of [['A', 5], ['B', 4]] as const) {
      const angles = await page.locator(`[data-testid^="vx-${v}-"]`).evaluateAll((cs) => cs.map((c) => +c.getAttribute('data-angle')!));
      angles.forEach((a, k) => expect(a).toBeCloseTo((k * 360) / count, 3));
      // vertices really sit on the circle at those angles (0° = 12 o'clock, clockwise)
      const xy = await page.locator(`[data-testid^="vx-${v}-"]`).evaluateAll((cs) => cs.map((c) => [+c.getAttribute('cx')!, +c.getAttribute('cy')!]));
      xy.forEach(([x, y], k) => {
        const rad = (k * 2 * Math.PI) / count;
        expect(x).toBeCloseTo(160 + 128 * Math.sin(rad), 1);
        expect(y).toBeCloseTo(160 - 128 * Math.cos(rad), 1);
      });
    }
    await expect(page.getByTestId('poly-A')).toHaveAttribute('points', /^(\S+ ){4}\S+$/);   // a pentagon
    await setBpm(page, 80);
    // 5:4 at 80 BPM: cycle = 4 · 0.75 = 3 s, A every 600 ms, B every 750 ms, grid lcm(5, 4) = 20
    const text = 'A clicks every 600.0 ms, voice B every 750.0 ms. On a 20-slot grid A plays every 4 and B every 5; they land together once per cycle, on the downbeat.';
    await expect(page.getByTestId('desc')).toContainText('one cycle is 4 beats, 3.000 s. Voice ' + text);
    await expect(page.getByTestId('dial')).toHaveAttribute('aria-label', /5 against 4 at 80 BPM/);
    await page.getByTestId('poly-m').selectOption('6');
    await page.getByTestId('poly-n').selectOption('4');
    await expect(page.getByTestId('desc')).toContainText('they land together 2 times per cycle.');
    await expect(page.locator('#strip .lane.A span.on')).toHaveCount(6);
    await expect(page.locator('#strip .lane.B span.on')).toHaveCount(4);
    await expect(page.locator('#strip .lane.A span')).toHaveCount(12);
  });

  test('lookahead scheduler under page.clock: logged note times match the formula, none past the window', async ({ page }) => {
    await silent(page);
    await page.getByTestId('preset-3-2').click();
    await setBpm(page, 120);                                                // cycle = 2 · 0.5 = 1 s
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status')).toContainText('Web Audio is not available');
    await page.clock.runFor(3000);
    const { LOOKAHEAD, START_DELAY } = await page.evaluate(() => (window as any).__poly);
    const log = await LOG(page);
    const s = await S(page);
    expect(s.scheduled).toEqual(log.map((e: any) => e.t));                  // the state hook exposes the schedule
    const exp = expectedCycle(3, 2, 120);                                   // 0, 1/3, 1/2, 2/3
    expect(exp.map((e) => e.t)).toEqual([0, 1 / 3, 0.5, 2 / 3].map((t) => expect.closeTo(t, 12)));
    log.forEach((e: any, i: number) => {
      expect(e.n).toBe(i);
      const x = exp[i % 4];
      expect(e.t).toBeCloseTo(Math.floor(i / 4) + x.t, 9);
      expect(e.voice).toBe(x.a !== null && x.b !== null ? 'AB' : x.a !== null ? 'A' : 'B');
    });
    const horizon = 3 - START_DELAY + LOOKAHEAD;
    expect(log[log.length - 1].t).toBeLessThan(horizon);
    // the next onset after the last one logged lies beyond the lookahead horizon
    const next = Math.floor(log.length / 4) + exp[log.length % 4].t;
    expect(next).toBeGreaterThanOrEqual(horizon);
    expect(log.filter((e: any) => e.voice === 'AB').map((e: any) => e.t)).toEqual([0, 1, 2, 3].filter((t) => t < horizon).map((t) => expect.closeTo(t, 9)));
    expect(log.every((e: any) => e.sounded === false)).toBe(true);
    expect(s).toMatchObject({ clock: 'silent', audio: 'unavailable', playing: true });
    // stop means stop
    await page.getByTestId('play').click();
    await expect(page.getByTestId('status')).toHaveText('Stopped.');
    const len = (await LOG(page)).length;
    await page.clock.runFor(1000);
    expect((await LOG(page)).length).toBe(len);
  });

  test('the hand sweeps once per cycle: phase = time since the cycle start / cycle length', async ({ page }) => {
    await silent(page);
    await page.getByTestId('preset-4-3').click();
    await setBpm(page, 120);                                                // cycle = 3 · 0.5 = 1.5 s
    expect((await S(page)).cycle).toBeCloseTo(1.5, 12);
    await page.getByTestId('play').click();
    const { START_DELAY } = await page.evaluate(() => (window as any).__poly);
    for (const [ms, elapsedTotal] of [[1000, 1], [900, 1.9], [1250, 3.15]]) {
      await page.clock.runFor(ms);
      const since = elapsedTotal - START_DELAY;
      const phase = (since % 1.5) / 1.5;
      const s = await S(page);
      expect(s.phase).toBeCloseTo(phase, 6);
      // the drawn hand is updated once per animation frame, so it may lag by one ~16 ms frame
      const lagDeg = (0.034 / 1.5) * 360;
      expect(phase * 360 - s.hand).toBeGreaterThanOrEqual(-0.001);
      expect(phase * 360 - s.hand).toBeLessThanOrEqual(lagDeg);
    }
    // 3.1 s into the schedule is 0.1 s into cycle 3 (it starts at 3.0 s; the next onset is at 3.375 s), so the downbeat A0 + B0 is lit
    await expect(page.locator('#dial .vx.lit')).toHaveCount(2);
    await expect(page.getByTestId('vx-A-0')).toHaveClass(/lit/);
    await expect(page.getByTestId('vx-B-0')).toHaveClass(/lit/);
    await page.getByTestId('play').click();
    expect((await S(page)).hand).toBe(0);
  });

  test('tap tempo: BPM = 60000 / mean interval of the last N taps', async ({ page }) => {
    const t = new Date('2026-09-25T12:00:00Z');
    await page.clock.install({ time: t });
    await page.goto(URL);
    await page.clock.pauseAt(new Date(t.getTime() + 1000));
    const tapAll = async (gaps: number[]) => {
      await page.getByTestId('tap').click();
      for (const g of gaps) { await page.clock.runFor(g); await page.getByTestId('tap').click(); }
    };
    // default window: 4 taps = 3 intervals
    await tapAll([600, 650, 700]);
    let s = await S(page);
    expect(s.tap.intervals).toEqual([600, 650, 700]);
    expect(s.tap.raw).toBeCloseTo(60000 / 650, 9);                          // 92.307…
    expect(s.bpm).toBe(Math.round(60000 / 650));
    await expect(page.getByTestId('tap-out')).toHaveText('3 intervals, mean 650.0 ms → 92.31 BPM, set to 92.');
    await expect(page.getByTestId('bpm')).toHaveValue('92');
    // more taps: only the last 4 count, so the early slow gaps fall out of the average
    for (const g of [400, 400, 400]) { await page.clock.runFor(g); await page.getByTestId('tap').click(); }   // same run: 400 ms < reset
    s = await S(page);
    expect(s.tap.count).toBe(4);
    expect(s.tap.intervals).toEqual([400, 400, 400]);
    expect(s.bpm).toBe(150);
    // widen the window to 6 taps; a pause longer than 2 s starts a fresh count and leaves the tempo alone
    await page.getByTestId('tap-n').selectOption('6');
    await page.clock.runFor(2500);
    await page.getByTestId('tap').click();
    s = await S(page);
    expect(s.tap).toEqual({ count: 1, intervals: [], raw: null });
    expect(s.bpm).toBe(150);
    await expect(page.getByTestId('tap-out')).toHaveText('New count started. Keep tapping.');
    const gaps = [480, 500, 520, 510, 490, 700];                            // 7 taps; a 6-tap window keeps the last 5 gaps
    for (const g of gaps) { await page.clock.runFor(g); await page.getByTestId('tap').click(); }
    s = await S(page);
    const kept = gaps.slice(-5), mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    expect(s.tap.intervals).toEqual(kept);
    expect(s.tap.raw).toBeCloseTo(60000 / mean, 9);
    expect(s.bpm).toBe(Math.round(60000 / mean));
    // exactly 2 s is not a pause (the reset needs more than 2 s)
    await page.clock.runFor(2000);
    await page.getByTestId('tap').click();
    expect((await S(page)).tap.count).toBe(6);
  });

  test('tap by keyboard (T), and taps outside 30–300 BPM are clamped', async ({ page }) => {
    const t = new Date('2026-09-25T12:00:00Z');
    await page.clock.install({ time: t });
    await page.goto(URL);
    await page.clock.pauseAt(new Date(t.getTime() + 1000));
    for (let i = 0; i < 4; i++) { if (i) await page.clock.runFor(150); await page.keyboard.press('t'); }
    let s = await S(page);
    expect(s.tap.raw).toBeCloseTo(400, 9);                                  // 60000 / 150
    expect(s.bpm).toBe(300);                                                // clamped
    await expect(page.getByTestId('tap-out')).toContainText('→ 400.00 BPM, set to 300.');
    // T typed into the tempo field is text entry, not a tap
    await page.getByTestId('bpm').focus();
    await page.keyboard.press('t');
    expect((await S(page)).tap.count).toBe(4);
    await setBpm(page, 10);
    await expect(page.getByTestId('bpm')).toHaveValue('30');
    await setBpm(page, 999);
    await expect(page.getByTestId('bpm')).toHaveValue('300');
    await setBpm(page, 87.6);
    s = await S(page);
    expect(s.bpm).toBe(88);
  });

  test('metronome mode: subdivisions at beat/s, accents on chosen beats, dial and strip follow', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('mode-metro').click();
    await expect(page.getByTestId('metro-panel')).toBeVisible();
    await expect(page.getByTestId('poly-panel')).toBeHidden();
    await page.getByTestId('beats').selectOption('3');
    await page.getByTestId('subdiv').selectOption('3');
    await setBpm(page, 100);
    await page.getByTestId('accent-2').click();
    await expect(page.getByTestId('accent-2')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('accent-0')).toHaveAttribute('aria-pressed', 'true');
    const s = await S(page);
    expect(s.accents).toEqual([true, false, true]);
    expect(s.cycle).toBeCloseTo(3 * 0.6, 12);
    const plan = await page.evaluate(() => (window as any).__poly.plan(18));
    plan.forEach((e: any, k: number) => {
      expect(e.t).toBeCloseTo((k * 0.6) / 3, 9);                           // 100 BPM triplets: 200 ms apart
      expect(e.beat).toBe(Math.floor(k / 3) % 3);
      expect(e.sub).toBe(k % 3);
      expect(e.kind).toBe(k % 3 ? 'sub' : [0, 2].includes(e.beat) ? 'accent' : 'beat');
    });
    await expect(page.locator('[data-testid^="vx-M-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="sub-dot"]')).toHaveCount(6);
    await expect(page.locator('#strip .lane.M span.acc')).toHaveCount(2);
    await expect(page.getByTestId('desc')).toHaveText('3 beats per bar at 100 BPM, triplets: a beat is 600.0 ms and clicks are 200.0 ms apart. Accents on beats 1, 3.');
    // growing the bar keeps existing accents and adds unaccented beats
    await page.getByTestId('beats').selectOption('5');
    expect((await S(page)).accents).toEqual([true, false, true, false, false]);
    await expect(page.locator('[data-testid^="accent-"]')).toHaveCount(5);
    // keyboard: accent buttons are native toggle buttons
    await page.getByTestId('accent-4').focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('accent-4')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status')).toHaveText('Beat 5 accented.');
  });

  test('tempo change mid-play: each gap uses the tempo it was scheduled at', async ({ page }) => {
    await silent(page);
    await page.getByTestId('mode-metro').click();
    await page.getByTestId('subdiv').selectOption('2');
    await setBpm(page, 120);
    await page.getByTestId('play').click();
    await page.clock.runFor(1000);
    await setBpm(page, 60);
    await page.clock.runFor(2000);
    const log = await LOG(page);
    expect(log.some((e: any) => e.bpm === 120)).toBe(true);
    expect(log.some((e: any) => e.bpm === 60)).toBe(true);
    for (let i = 1; i < log.length; i++) expect(log[i].t - log[i - 1].t).toBeCloseTo(60 / log[i - 1].bpm / 2, 9);
    // beat/sub counting runs on without a hiccup
    log.forEach((e: any, i: number) => { expect(e.sub).toBe(i % 2); expect(e.beat).toBe(Math.floor(i / 2) % 4); });
    // switching to a polyrhythm mid-play starts a fresh cycle on the next click
    await page.getByTestId('mode-poly').click();
    await page.clock.runFor(1500);
    const after = (await LOG(page)).filter((e: any) => e.mode === 'poly');
    expect(after[0]).toMatchObject({ voice: 'AB', a: 0, b: 0, accent: true, slot: 0 });
    const exp = expectedCycle(4, 3, 60);
    after.forEach((e: any, i: number) => expect(e.t - after[0].t).toBeCloseTo(Math.floor(i / exp.length) * 3 + exp[i % exp.length].t, 9));
  });

  test('no audio: missing or suspended AudioContext still keeps time silently, and says so', async ({ page }) => {
    await silent(page, 'suspended');
    expect((await S(page)).audio).toBe('none');                             // nothing before a gesture
    await page.getByTestId('tap').click();
    expect((await S(page)).audio).toBe('none');                             // tapping is not sound
    await page.getByTestId('play').click();
    await expect(page.getByTestId('status')).toContainText('Audio is suspended by the browser');
    await page.clock.runFor(2000);
    const s = await S(page);
    expect(s).toMatchObject({ clock: 'silent', audio: 'suspended', triggered: 0 });
    const exp = expectedCycle(4, 3, 90);                                    // defaults: 4:3 at 90 BPM, cycle 2 s
    const log = await LOG(page);
    expect(log.length).toBeGreaterThan(6);
    log.forEach((e: any, i: number) => expect(e.t).toBeCloseTo(Math.floor(i / 6) * 2 + exp[i % 6].t, 9));
    // muting a voice takes it out of what would sound, not out of the timeline
    await page.getByTestId('mute-a').click();
    await page.clock.runFor(2000);
    const later = (await LOG(page)).filter((e: any) => e.t >= 2.2);
    expect(later.some((e: any) => e.a !== null)).toBe(true);
    expect(later.every((e: any) => !e.voices.includes('A'))).toBe(true);
  });

  test('real Web Audio: nothing before a gesture, then clicks scheduled on the audio clock', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-7-4').click();
    await setBpm(page, 150);
    expect((await S(page)).audio).toBe('none');
    await page.getByTestId('play').click();
    await expect.poll(async () => (await S(page)).audio).toBe('running');
    await expect.poll(async () => (await S(page)).clock).toBe('audio');
    await expect.poll(async () => (await LOG(page)).filter((e: any) => e.sounded).length).toBeGreaterThan(3);
    const log = await LOG(page);
    const exp = expectedCycle(7, 4, 150);
    // relative times still follow the formula, whichever clock they were scheduled on
    log.slice(0, exp.length).forEach((e: any, i: number) => expect(e.t - log[0].t).toBeCloseTo(exp[i].t, 9));
    await page.getByTestId('play').click();
    await expect(page.getByTestId('status')).toHaveText('Stopped.');
  });

  test('mobile layout: dial and controls stack, tap targets stay large', async ({ page }) => {
    await page.goto(URL);
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
    await page.setViewportSize({ width: 1200, height: 900 });
    let d = await box('dial'), p = await box('play');
    expect(p.x).toBeGreaterThan(d.x + d.width);                            // side by side
    await page.setViewportSize({ width: 390, height: 844 });
    d = await box('dial'); p = await box('play');
    expect(p.y).toBeGreaterThan(d.y + d.height);                           // stacked
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.x + d.width).toBeLessThanOrEqual(390);
    for (const id of ['play', 'tap', 'preset-3-2', 'mute-a']) {
      const b = await box(id);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    // the widest polyrhythm grid (lcm 9·8 = 72 slots) still fits
    await page.getByTestId('poly-m').selectOption('9');
    await page.getByTestId('poly-n').selectOption('8');
    await expect(page.locator('#strip .lane.A span')).toHaveCount(72);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});
