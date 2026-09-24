import { test, expect, Page } from '@playwright/test';

const URL = '/lab/077-cloud-chamber.html?seed=5';
const C = (page: Page) => page.evaluate(() => (window as any).__chamber.state);
/** Detach the real-time loop and rewind to t = 0 for this seed, so every run is frame-exact. */
async function open(page: Page, url = URL) {
  await page.goto(url);
  await page.evaluate(() => { const c = (window as any).__chamber; c.manual(true); c.restart(); });
}
const advance = (page: Page, s: number) => page.evaluate((s) => (window as any).__chamber.advance(s), s);
const inject = (page: Page, type: string, n: number) => page.evaluate(([type, n]) => { const c = (window as any).__chamber; const out = []; for (let i = 0; i < (n as number); i++) out.push(c.inject(type)); return out; }, [type, n] as const);

test.describe('077 Cloud Chamber', () => {
  test('a seeded run is repeatable, and the tally counters show it', async ({ page }) => {
    await open(page);
    const a = await advance(page, 60);
    expect(a.counts.alpha).toBeGreaterThan(15);
    expect(a.counts.alpha).toBeLessThan(60);
    expect(a.counts.beta).toBeGreaterThan(10);
    expect(a.counts.muon).toBeGreaterThan(5);
    await expect(page.getByTestId('count-alpha')).toHaveAttribute('data-count', String(a.counts.alpha));
    await expect(page.getByTestId('count-muon')).toHaveAttribute('aria-label', `muon count ${a.counts.muon}`);
    await expect(page.getByTestId('count-beta')).toHaveText(String(a.counts.beta).padStart(4, '0'));
    await expect(page.getByTestId('caption')).toContainText('seed 5');
    await open(page);
    expect((await advance(page, 60)).counts).toEqual(a.counts);
    await open(page, '/lab/077-cloud-chamber.html?seed=6');
    expect((await advance(page, 60)).counts).not.toEqual(a.counts);
  });

  test('alpha tracks are short and thick, betas thin and wiggly, muons long and straight', async ({ page }) => {
    await open(page);
    await inject(page, 'alpha', 12); await inject(page, 'beta', 12); await inject(page, 'muon', 12);
    const tr = await page.evaluate(() => (window as any).__chamber.tracks());
    const by = (t: string) => tr.filter((x: any) => x.type === t);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const [al, be, mu] = [by('alpha'), by('beta'), by('muon')];
    expect(al).toHaveLength(12);
    for (const t of al) { expect(t.width).toBeGreaterThan(3.5); expect(t.len).toBeLessThan(150); expect(t.q).toBe(2); expect(t.straightness).toBeGreaterThan(0.92); }
    for (const t of be) { expect(t.width).toBeLessThan(2); expect(t.q).toBe(-1); }
    for (const t of mu) { expect(t.width).toBeLessThan(2); expect(t.straightness).toBeGreaterThan(0.99); expect(Math.abs(t.q)).toBe(1); }
    expect(mean(be.map((t: any) => t.straightness))).toBeLessThan(0.85);   // multiple scattering makes betas wander
    expect(mean(mu.map((t: any) => t.len))).toBeGreaterThan(2 * mean(al.map((t: any) => t.len)));
    // with no field, nothing is bent by the magnet
    for (const t of tr) expect(t.fieldTurn).toBe(0);
  });

  test('the magnetic field curves opposite charges in opposite directions, and flipping it flips them', async ({ page }) => {
    await open(page);
    await page.getByTestId('field').fill('60');
    await expect(page.getByTestId('field-out')).toHaveText('+0.60 (out of screen)');
    await expect(page.getByTestId('status')).toContainText('alphas and μ⁺ curl clockwise');
    const turns = async () => {
      const a = await inject(page, 'alpha', 6), b = await inject(page, 'beta', 6), m = await inject(page, 'muon', 8);
      return { a: a.map((t: any) => t.fieldTurn), b: b.map((t: any) => t.fieldTurn), m: m.map((t: any) => [t.q, t.fieldTurn]) };
    };
    const up = await turns();
    for (const x of up.a) expect(x).toBeGreaterThan(0);     // +2e: clockwise on screen with B out of the screen
    for (const x of up.b) expect(x).toBeLessThan(0);        // electrons the other way
    for (const [q, x] of up.m) expect(Math.sign(x)).toBe(q); // μ+ and μ− split by sign
    // lighter, slower electrons are bent much more than the heavy alphas
    expect(Math.max(...up.b.map(Math.abs))).toBeGreaterThan(5 * Math.max(...up.a));
    await page.getByTestId('field').fill('-60');
    await expect(page.getByTestId('field-out')).toHaveText('−0.60 (into screen)');
    const down = await turns();
    for (const x of down.a) expect(x).toBeLessThan(0);
    for (const x of down.b) expect(x).toBeGreaterThan(0);
  });

  test('tracks condense, then fade away; clearing the vapour keeps the tally', async ({ page }) => {
    await open(page);
    await page.getByTestId('radon').fill('0');
    await page.getByTestId('show-beta').uncheck();
    await page.getByTestId('show-muon').uncheck();
    await page.getByTestId('inject-alpha').click();
    await expect(page.getByTestId('status')).toContainText('Injected one alpha track');
    const [t] = await page.evaluate(() => (window as any).__chamber.tracks());
    expect((await advance(page, 0.5)).visible).toBe(1);
    expect((await advance(page, t.life)).visible).toBe(0);    // evaporated
    const counts = (await C(page)).counts;
    expect(counts.alpha).toBe(1);
    await inject(page, 'beta', 3);
    await page.getByTestId('clear').click();
    const s = await C(page);
    expect(s.visible).toBe(0);
    expect(s.counts.beta).toBe(3);
    await expect(page.getByTestId('chamber')).toHaveAttribute('aria-label', /0 tracks visible: 1 alpha, 3 beta/);
  });

  test('toggles, radon level and pause', async ({ page }) => {
    await open(page);
    const base = await advance(page, 40);
    await open(page);
    await page.getByTestId('show-muon').uncheck();
    const noMu = await advance(page, 40);
    expect(noMu.counts.muon).toBe(0);
    // each type draws from the generator every frame, so hiding muons doesn't reshuffle the others
    expect(noMu.counts.alpha).toBe(base.counts.alpha);
    expect(noMu.counts.beta).toBe(base.counts.beta);
    await page.getByTestId('radon').fill('30');
    const before = (await C(page)).counts.alpha;
    const hi = await advance(page, 40);
    expect(hi.counts.alpha - before).toBeGreaterThan(base.counts.alpha * 1.8); // three times the radon
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    const p = await advance(page, 10);
    expect(p.t).toBe(hi.t);
    await page.getByTestId('pause').click();
    expect((await advance(page, 1)).t).toBeGreaterThan(hi.t);
  });
});
