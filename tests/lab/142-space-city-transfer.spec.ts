import { test, expect, Page } from '@playwright/test';

const URL = '/lab/142-space-city-transfer.html';
const S = (page: Page) => page.evaluate(() => (window as any).__space.state);

// Independent oracles, written from the vis-viva equation rather than copied from the page.
const MU_E = 398600.4418, R_E = 6378.137, MU_S = 1.32712440018e11, AU = 149597870.7, G0 = 9.80665;
function hohmann(r1: number, r2: number, mu: number) {
  const a = (r1 + r2) / 2;
  const dv1 = Math.abs(Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1));
  const dv2 = Math.abs(Math.sqrt(mu / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2))));
  const tof = Math.PI * Math.sqrt(a ** 3 / mu);
  // target must sit (π − n₂·tof) ahead at burn 1 so both reach the far apsis together
  const phase = 180 - (Math.sqrt(mu / r2 ** 3) * tof * 180) / Math.PI;
  return { dv1, dv2, total: dv1 + dv2, tof, phase, e: Math.abs(r2 - r1) / (r1 + r2), a };
}
function biElliptic(r1: number, r2: number, rb: number, mu: number) {
  const v = (r: number, a: number) => Math.sqrt(mu * (2 / r - 1 / a));
  const a1 = (r1 + rb) / 2, a2 = (r2 + rb) / 2;
  return (v(r1, a1) - Math.sqrt(mu / r1)) + (v(rb, a2) - v(rb, a1)) + (v(r2, a2) - Math.sqrt(mu / r2));
}
/** Solve Kepler's equation by bisection (the page uses Newton), then true anomaly in degrees. */
function trueAnomaly(M: number, e: number) {
  let lo = 0, hi = 2 * Math.PI;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (m - e * Math.sin(m) < M) lo = m; else hi = m; }
  const E = (lo + hi) / 2;
  return (2 * Math.atan(Math.sqrt((1 + e) / (1 - e)) * Math.tan(E / 2)) * 180) / Math.PI;
}
async function alt(page: Page, which: 'from' | 'to', km: number) {
  await page.getByTestId(`alt-${which}`).fill(String(km));
  await page.getByTestId(`alt-${which}`).press('Enter');
}

test.describe('142 Space City Transfer', () => {
  test('LEO 300 km to GEO: both burns, total ≈ 3.89 km/s, 5.28 h and a 100.66° phase angle', async ({ page }) => {
    await page.goto(URL);
    const o = hohmann(R_E + 300, R_E + 35786, MU_E);
    const h = (await S(page)).hohmann;
    expect(h.dv1).toBeCloseTo(o.dv1, 9);
    expect(h.dv2).toBeCloseTo(o.dv2, 9);
    expect(h.total).toBeCloseTo(o.total, 9);
    // the published textbook figure for LEO→GEO is about 3.9 km/s (2.43 + 1.47)
    expect(h.total).toBeGreaterThan(3.89);
    expect(h.total).toBeLessThan(3.94);
    expect(h.tof / 3600).toBeCloseTo(5.275, 2);
    expect(h.phaseDeg).toBeCloseTo(o.phase, 6);
    expect(o.phase).toBeCloseTo(100.66, 1);
    await expect(page.getByTestId('dv1')).toHaveText('2.426 km/s');
    await expect(page.getByTestId('dv2')).toHaveText('1.467 km/s');
    await expect(page.getByTestId('dv-total')).toHaveText('3.893 km/s');
    await expect(page.getByTestId('tof')).toHaveText('5 h 17 min');
    await expect(page.getByTestId('phase')).toHaveText('100.66°');
    await expect(page.getByTestId('preset-from')).toHaveValue('leo');
    await expect(page.getByTestId('preset-to')).toHaveValue('geo');
    await expect(page.getByTestId('status')).toContainText('total delta-v 3.893 km/s');
  });

  test('presets and custom altitudes all match the vis-viva oracle', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-from').selectOption('iss');
    await page.getByTestId('preset-to').selectOption('gps');
    await expect(page.getByTestId('alt-from')).toHaveValue('420');
    await expect(page.getByTestId('alt-to')).toHaveValue('20200');
    let o = hohmann(R_E + 420, R_E + 20200, MU_E);
    let h = (await S(page)).hohmann;
    expect(h.total).toBeCloseTo(o.total, 9);
    expect(h.tof).toBeCloseTo(o.tof, 6);
    await expect(page.getByTestId('dv-total')).toHaveText(o.total.toFixed(3) + ' km/s');
    await alt(page, 'from', 1000);
    await alt(page, 'to', 5000);
    await expect(page.getByTestId('preset-from')).toHaveValue('custom');
    o = hohmann(R_E + 1000, R_E + 5000, MU_E);
    h = (await S(page)).hohmann;
    expect(h.dv1).toBeCloseTo(o.dv1, 9);
    expect(h.dv2).toBeCloseTo(o.dv2, 9);
    expect(h.e).toBeCloseTo(o.e, 12);
    await expect(page.getByTestId('ellipse')).toHaveText('e = ' + o.e.toFixed(4));
  });

  test('going down (GEO to LEO) costs the same Δv, burns retrograde and the target trails', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-from').selectOption('geo');
    await page.getByTestId('preset-to').selectOption('leo');
    const o = hohmann(R_E + 35786, R_E + 300, MU_E);
    const h = (await S(page)).hohmann;
    expect(h.total).toBeCloseTo(hohmann(R_E + 300, R_E + 35786, MU_E).total, 9);  // time-reversal symmetry
    expect(h.phaseDeg).toBeCloseTo(o.phase, 6);
    expect(h.phaseDeg).toBeLessThan(0);
    await expect(page.getByTestId('results')).toContainText('retrograde');
    await expect(page.getByTestId('results')).toContainText('target trails the craft');
  });

  test('Earth to Mars around the Sun: about 259 days, 44° phase angle', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('mode-sun').check();
    await expect(page.getByTestId('planet-from')).toBeVisible();
    await page.getByTestId('planet-from').selectOption({ label: 'Earth' });
    await page.getByTestId('planet-to').selectOption({ label: 'Mars' });
    const o = hohmann(1.00000261 * AU, 1.52371034 * AU, MU_S);
    const h = (await S(page)).hohmann;
    expect(h.tof / 86400).toBeCloseTo(o.tof / 86400, 6);
    expect(h.tof / 86400).toBeGreaterThan(258);                       // the textbook "about 259 days"
    expect(h.tof / 86400).toBeLessThan(260);
    expect(h.phaseDeg).toBeCloseTo(44.3, 0);
    expect(h.total).toBeCloseTo(o.total, 6);                          // ≈ 2.94 + 2.65 km/s heliocentric
    expect(h.dv1).toBeCloseTo(2.94, 2);
    await expect(page.getByTestId('tof')).toHaveText(`${(o.tof / 86400).toFixed(1)} days`);
    await expect(page.getByTestId('consts')).toContainText('1.32712440018 × 10¹¹');
  });

  test('orbit animation under page.clock follows Kepler and ends in a rendezvous at 180°', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-26T12:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-26T12:00:02Z'));
    const { ANIM_MS } = await page.evaluate(() => ({ ANIM_MS: (window as any).__space.ANIM_MS }));
    await page.getByTestId('fly').click();
    await expect(page.getByTestId('fly')).toHaveAttribute('aria-pressed', 'true');
    await page.clock.runFor(ANIM_MS / 2);
    let s = await S(page);
    expect(s.anim.p).toBeGreaterThan(0.48);
    expect(s.anim.p).toBeLessThan(0.52);
    const { e, tof, phaseDeg } = s.hohmann;
    // outbound: time from perigee = p·tof, mean anomaly = π·p
    expect(s.anim.craftDeg).toBeCloseTo(trueAnomaly(Math.PI * s.anim.p, e), 6);
    expect(s.anim.craftDeg).toBeGreaterThan(90 * 1.0);                   // the fast half of the orbit comes first
    const n2 = Math.sqrt(MU_E / (R_E + 35786) ** 3);
    expect(s.anim.targetDeg).toBeCloseTo(phaseDeg + (n2 * s.anim.p * tof * 180) / Math.PI, 6);
    await page.clock.runFor(ANIM_MS);
    s = await S(page);
    expect(s.anim.p).toBe(1);
    expect(s.playing).toBe(false);
    expect(s.anim.craftDeg).toBeCloseTo(180, 6);
    expect(s.anim.targetDeg).toBeCloseTo(180, 6);                         // craft and target meet
    expect(s.anim.craftR).toBeCloseTo(R_E + 35786, 3);
    await expect(page.getByTestId('mission-clock')).toContainText('Arrived: T+5 h 17 min');
    await expect(page.getByTestId('fly')).toHaveText('Fly it again');
  });

  test('pause holds the craft still; the mission-time slider scrubs by keyboard', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-26T12:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-26T12:00:02Z'));
    await page.getByTestId('fly').click();
    await page.clock.runFor(2000);
    await page.getByTestId('fly').click();
    await expect(page.getByTestId('fly')).toHaveText('Resume');
    const p = (await S(page)).anim.p;
    expect(p).toBeGreaterThan(0.2);
    await page.clock.runFor(3000);
    expect((await S(page)).anim.p).toBe(p);                               // paused means paused
    await page.getByTestId('scrub').focus();
    await page.keyboard.press('End');
    let s = await S(page);
    expect(s.anim.p).toBe(1);
    expect(s.anim.craftDeg).toBeCloseTo(180, 6);
    await page.keyboard.press('Home');
    s = await S(page);
    expect(s.anim.p).toBe(0);
    expect(s.anim.craftDeg).toBeCloseTo(0, 9);
    expect(s.anim.targetDeg).toBeCloseTo(s.hohmann.phaseDeg, 9);
    await expect(page.getByTestId('scrub')).toHaveAttribute('aria-valuetext', /T\+0: burn 1/);
  });

  test('bi-elliptic crossover is R = 11.94, from an independent bisection', async ({ page }) => {
    await page.goto(URL);
    const H = (R: number) => hohmann(1, R, 1).total;
    const lim = (R: number) => (Math.SQRT2 - 1) * (1 + Math.sqrt(1 / R));
    let lo = 2, hi = 40;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (lim(m) < H(m)) hi = m; else lo = m; }
    const cross = await page.evaluate(() => (window as any).__space.crossover);
    expect(cross).toBeCloseTo(lo, 8);
    expect(cross).toBeCloseTo(11.9388, 3);                                // the published 11.94
    await expect(page.getByTestId('crossover')).toHaveText('11.94');
    // LEO→GEO is R ≈ 6.3, so Hohmann wins
    await expect(page.getByTestId('verdict')).toContainText('below 11.94: Hohmann wins');
    const s = await S(page);
    expect(s.bielliptic.total).toBeCloseTo(biElliptic(R_E + 300, R_E + 35786, 3 * (R_E + 35786), MU_E), 9);
    expect(s.bielliptic.total).toBeGreaterThan(s.hohmann.total);
  });

  test('above the crossover the verdict depends on r_b, and far planets make bi-elliptic win', async ({ page }) => {
    await page.goto(URL);
    // R = 13 exactly: above 11.94 but below 15.58
    const r1 = R_E + 300, r2 = 13 * r1;
    await alt(page, 'to', +(r2 - R_E).toFixed(3));
    await page.getByTestId('rb-mult').fill('1.5');
    await page.getByTestId('rb-mult').press('Enter');
    let s = await S(page);
    const b15 = biElliptic(r1, r2, 1.5 * r2, MU_E);
    expect(s.bielliptic.total).toBeCloseTo(b15, 9);
    expect(b15).toBeGreaterThan(hohmann(r1, r2, MU_E).total);             // a close r_b loses here…
    await expect(page.getByTestId('verdict')).toContainText('can win, but not with r_b this close');
    await page.getByTestId('rb-mult').fill('200');
    await page.getByTestId('rb-mult').press('Enter');
    s = await S(page);
    expect(biElliptic(r1, r2, 200 * r2, MU_E)).toBeLessThan(hohmann(r1, r2, MU_E).total);   // …a far one wins
    await expect(page.getByTestId('verdict')).toContainText('the bi-elliptic transfer wins by');
    await expect(page.locator('[data-testid="bi-table"] tr.win')).toHaveAttribute('data-row', 'b');
    // Mercury → Neptune, R ≈ 77.7 (> 15.58): even r_b = 1.5 × outer wins
    await page.getByTestId('mode-sun').check();
    await page.getByTestId('planet-from').selectOption({ label: 'Mercury' });
    await page.getByTestId('planet-to').selectOption({ label: 'Neptune' });
    await page.getByTestId('rb-mult').fill('1.5');
    await page.getByTestId('rb-mult').press('Enter');
    s = await S(page);
    const m1 = 0.38709927 * AU, m2 = 30.06992276 * AU;
    expect(s.bielliptic.total).toBeCloseTo(biElliptic(m1, m2, 1.5 * m2, MU_S), 6);
    expect(s.bielliptic.total).toBeLessThan(s.hohmann.total);
    await expect(page.getByTestId('verdict')).toContainText('R = 77.68');
  });

  test('rocket equation: Δv = Isp·g₀·ln(m₀/m_f), and the mass ratio the transfer needs', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('isp').fill('450');
    await page.getByTestId('m0').fill(String(Math.E * 1000));
    await page.getByTestId('mf').fill('1000');
    // ln(e) = 1, so Δv is exactly Isp·g₀ = 4412.99 m/s
    await expect(page.getByTestId('rocket-dv')).toHaveText('4.413 km/s');
    let s = await S(page);
    expect(s.rocket.dv).toBeCloseTo(450 * G0, 6);
    const need = Math.exp((hohmann(R_E + 300, R_E + 35786, MU_E).total * 1000) / (450 * G0));
    expect(s.rocket.ratioNeeded).toBeCloseTo(need, 9);
    await expect(page.getByTestId('rocket-need')).toHaveText(`m₀/m_f = ${need.toFixed(3)}`);
    await expect(page.getByTestId('rocket-need-detail')).toContainText('this stage covers');
    // a kerosene-class 300 s stage with a 2:1 mass ratio
    await page.getByTestId('isp').fill('300');
    await page.getByTestId('m0').fill('2000');
    s = await S(page);
    expect(s.rocket.dv).toBeCloseTo(300 * G0 * Math.log(2), 6);
    await expect(page.getByTestId('rocket-need-detail')).toContainText('falls short of');
    await page.getByTestId('mf').fill('3000');
    await expect(page.getByTestId('rocket-dv')).toHaveText('—');
  });

  test('keyboard: the body radios switch inputs, and the diagram is described in text', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('mode-earth').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('mode-sun')).toBeChecked();
    await expect(page.getByTestId('planet-from')).toBeVisible();
    await expect(page.getByTestId('alt-from')).toBeHidden();
    await expect(page.locator('#orbitDesc')).toContainText('Transfer from radius');
    await expect(page.getByTestId('status')).toContainText('Earth to Mars');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('alt-from')).toBeVisible();
    await expect(page.getByTestId('results')).toHaveAttribute('aria-live', 'polite');
  });
});
