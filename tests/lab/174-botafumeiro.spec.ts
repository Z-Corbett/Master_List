import { test, expect, Page } from '@playwright/test';

const URL = '/lab/174-botafumeiro.html';
const S = (page: Page) => page.evaluate(() => (window as any).__censer.state);
const frames = (page: Page, n: number) => page.evaluate((n) => (window as any).__censer.frames(n), n);
const auto = (page: Page, policy: string, n: number, stop: string | false = 'phase') =>
  page.evaluate(([p, n, s]) => (window as any).__censer.auto(p, n, s), [policy, n, stop] as const);
const sim = (page: Page, opts: any) => page.evaluate((o) => (window as any).__censer.simulate(o), opts);
const G = 9.81;

/** Begin the rite with the real-time loop detached, so every 1/240 s step is driven by the test. */
async function start(page: Page) {
  await page.goto(URL);
  await page.evaluate(() => (window as any).__censer.manual(true));
  await page.getByTestId('start').click();
  await expect(page.getByTestId('ready')).toBeHidden();
  await expect(page.getByTestId('pull')).toBeFocused();   // focus is never left on the vanished Begin button
  expect((await S(page)).mode).toBe('run');
}
/** Raise the censer one half-swing at a time, easing off near the top so it never reaches the vault. */
async function raise(page: Page) {
  let s = await S(page);
  for (let k = 0; k < 80 && s.mode === 'run' && s.phase === 'raise'; k++) s = await auto(page, s.amp < 72 ? 'pump' : 'none', 20000, 'turn');
  return s;
}

test.describe('174 Botafumeiro', () => {
  test('with the rope held still it is an honest pendulum: period and energy', async ({ page }) => {
    await page.goto(URL);
    // small swing, no drag: period 2π√(r/g) and energy conserved by the RK4 step
    const a = await sim(page, { fixedRope: true, drag: 0, seconds: 60, startDeg: 3 });
    const T0 = 2 * Math.PI * Math.sqrt(20 / G);
    const period = (a.crossings[5] - a.crossings[0]) / 5;
    expect(Math.abs(period - T0) / T0).toBeLessThan(0.002 + (3 * Math.PI / 180) ** 2 / 16);
    expect((a.maxE - a.minE) / a.e0).toBeLessThan(1e-6);
    // a big swing is slower, as the series T0 (1 + θ²/16 + 11θ⁴/3072) predicts
    const b = await sim(page, { fixedRope: true, drag: 0, seconds: 90, startDeg: 60 });
    const th = Math.PI / 3, Tbig = T0 * (1 + th ** 2 / 16 + (11 * th ** 4) / 3072);
    const pb = (b.crossings[5] - b.crossings[0]) / 5;
    expect(pb).toBeGreaterThan(T0 * 1.05);
    expect(Math.abs(pb - Tbig) / Tbig).toBeLessThan(0.005);
    // every turning point comes back to 60° with no drag
    for (const t of b.turns) expect(t).toBeCloseTo(60, 2);
  });

  test('pulling in at the bottom pumps it up; pulling at the ends takes energy out', async ({ page }) => {
    await page.goto(URL);
    const pump = await sim(page, { policy: 'pump', seconds: 110 });
    // compare each turning point with the one a full swing earlier (same side)
    for (let i = 2; i < pump.turns.length; i++) expect(pump.turns[i]).toBeGreaterThan(pump.turns[i - 2]);
    expect(Math.max(...pump.turns)).toBeGreaterThan(80);
    const damp = await sim(page, { policy: 'damp', seconds: 60, startDeg: 40 });
    for (let i = 2; i < damp.turns.length; i++) expect(damp.turns[i]).toBeLessThan(damp.turns[i - 2]);
    expect(damp.turns.at(-1)).toBeLessThan(15);
    // doing nothing: air drag alone loses far less than deliberate damping
    const none = await sim(page, { policy: 'none', seconds: 60, startDeg: 40 });
    expect(none.turns.at(-1)).toBeLessThan(40);
    expect(none.turns.at(-1)).toBeGreaterThan(damp.turns.at(-1) + 10);
  });

  test('holding Space pulls the rope in at the capped rate and letting go lets it out', async ({ page }) => {
    await start(page);
    const c = await page.evaluate(() => (window as any).__censer.consts);
    await page.keyboard.down('Space');
    let s = await frames(page, 96);                        // 0.4 s
    expect(s.pulling).toBe(true);
    expect(s.pulls).toBe(1);
    expect(s.r).toBeCloseTo(c.R_LONG - c.V_PULL * 0.4, 1);
    expect(s.rdot).toBeCloseTo(-c.V_PULL, 5);
    s = await frames(page, 480);
    expect(s.r).toBeCloseTo(c.R_SHORT, 2);
    await page.keyboard.up('Space');
    s = await frames(page, 480);
    expect(s.pulling).toBe(false);
    expect(s.r).toBeCloseTo(c.R_LONG, 2);
    // the Pull button works the same way with a finger
    const pull = page.getByTestId('pull');
    await pull.dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', bubbles: true });
    await expect(pull).toHaveAttribute('aria-pressed', 'true');
    s = await frames(page, 24);
    expect(s.pulling).toBe(true);
    expect(s.pulls).toBe(2);
    await pull.dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch', bubbles: true });
    await expect(pull).toHaveAttribute('aria-pressed', 'false');
    expect((await frames(page, 2)).pulling).toBe(false);
    // and so does holding a finger anywhere on the nave
    const scene = page.getByTestId('scene');
    await scene.dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'touch', bubbles: true });
    expect((await frames(page, 2)).pulling).toBe(true);
    await scene.dispatchEvent('pointerup', { pointerId: 9, pointerType: 'touch', bubbles: true });
    expect((await frames(page, 2)).pulling).toBe(false);
  });

  test('the full rite: raise past 80°, hold three swings, lower it to be caught', async ({ page }) => {
    await start(page);
    await expect(page.getByTestId('phase-raise')).toHaveAttribute('aria-current', 'step');
    let s = await raise(page);
    expect(s.mode).toBe('run');
    expect(s.phase).toBe('hold');
    expect(s.amp).toBeGreaterThanOrEqual(80);
    expect(s.amp).toBeLessThan(88);
    await expect(page.getByTestId('phase-hold')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('status')).toContainText('Now hold it above 70°');
    await expect(page.getByTestId('amp')).toHaveText(`${Math.round(s.amp)}°`);
    // hold: a gentle pump whenever it sags keeps every pass above 70°
    for (let k = 0; k < 20 && s.phase === 'hold'; k++) {
      s = await auto(page, s.amp < 76 ? 'pump' : 'none', 20000, 'turn');
      expect(s.mode).toBe('run');
    }
    expect(s.phase).toBe('lower');
    expect(s.holdTurns).toBe(6);
    await expect(page.getByTestId('phase-hold')).toHaveClass(/done/);
    await expect(page.getByTestId('status')).toContainText('Bring it down');
    // lower: the reverse rhythm damps it until it can be caught
    s = await auto(page, 'damp', 240 * 200, false);
    expect(s.mode).toBe('over');
    expect(s.result).toBe('caught');
    expect(s.amp).toBeLessThanOrEqual(8);
    expect(s.maxAmp).toBeLessThan(88);
    await expect(page.getByTestId('result')).toBeVisible();
    await expect(page.getByTestId('final')).toHaveText(`${s.t.toFixed(1)} s`);
    await expect(page.getByTestId('best-line')).toHaveText(`Best rite: ${s.t.toFixed(1)} s`);
    await expect(page.getByTestId('again')).toBeFocused();
    // the best time is kept between visits
    await page.reload();
    await expect(page.getByTestId('best')).toHaveText(`${s.t.toFixed(1)} s`);
  });

  test('past 88° the rope goes slack and the rite is spoiled', async ({ page }) => {
    await start(page);
    const s = await auto(page, 'pump', 240 * 300, false);
    expect(s.mode).toBe('over');
    expect(s.result).toBe('slack');
    expect(Math.abs(s.th)).toBeGreaterThan(88);
    await expect(page.getByTestId('result')).toContainText('Too high!');
    await expect(page.getByTestId('again')).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('lab174-botafumeiro-best'))).toBeNull();
    // a fresh rite starts from the result card
    await page.getByTestId('again').click();
    await expect(page.getByTestId('result')).toBeHidden();
    expect((await S(page)).mode).toBe('run');
    expect((await S(page)).t).toBe(0);
  });

  test('pause stops the clock; the cue and the pace can be switched', async ({ page }) => {
    await start(page);
    const s = await frames(page, 240);
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status')).toHaveText('Paused.');
    const p = await frames(page, 240);
    expect(p.mode).toBe('paused');
    expect(p.t).toBe(s.t);
    expect(p.th).toBe(s.th);
    await page.keyboard.press('p');
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'false');
    expect((await frames(page, 24)).t).toBeCloseTo(s.t + 0.1, 6);
    // rhythm cue
    await page.keyboard.press('c');
    await expect(page.getByTestId('cue')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('cue')).toHaveText('Cue: off');
    expect((await S(page)).cue).toBe(false);
    await page.getByTestId('cue').click();
    expect((await S(page)).cue).toBe(true);
    // gentle pace switches the real-time clock from 1.5× to 1×
    expect((await S(page)).scale).toBe(1.5);
    await page.getByTestId('slow').check();
    expect((await S(page)).scale).toBe(1);
    await expect(page.getByTestId('status')).toContainText('Gentle pace');
  });
});
