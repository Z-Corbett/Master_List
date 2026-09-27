import { test, expect, Page } from '@playwright/test';

const URL = '/lab/167-ten-principles.html';
// Dieter Rams's ten principles, in his order, as widely cited.
const TEN = [
  'Good design is innovative',
  'Good design makes a product useful',
  'Good design is aesthetic',
  'Good design makes a product understandable',
  'Good design is unobtrusive',
  'Good design is honest',
  'Good design is long-lasting',
  'Good design is thorough down to the last detail',
  'Good design is environmentally-friendly',
  'Good design is as little design as possible',
];
const demo = (page: Page, n: number) => page.evaluate((k) => (window as any).__rams.demo(k), n);
const visible = (page: Page) => page.locator('section.principle:not([hidden])');

test.describe('167 Ten Principles', () => {
  test('all ten principles are present, in order, each with its own explanation and demo', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('rail').locator('a')).toHaveCount(10);
    const rail = await page.getByTestId('rail').locator('a span:last-child').allTextContents();
    expect(rail).toEqual(TEN);
    const secs = await page.locator('section.principle').evaluateAll((els) => els.map((e) => ({ n: e.getAttribute('data-principle'), h: e.querySelector('h2')!.textContent, why: e.querySelector('.why')!.textContent!, demo: e.querySelector('.demo')!.children.length })));
    expect(secs.map((s) => s.n)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(secs.map((s) => s.h)).toEqual(TEN);
    const whys = new Set<string>();
    for (const s of secs) {
      expect(s.why.length, s.h).toBeGreaterThan(150);          // a real explanation, not the heading again
      expect(s.why).not.toContain(s.h);
      expect(s.demo).toBeGreaterThanOrEqual(2);                 // a device and a meter
      whys.add(s.why);
    }
    expect(whys.size).toBe(10);
    // only one principle is shown at a time, starting with the first
    await expect(visible(page)).toHaveCount(1);
    await expect(visible(page).locator('h2')).toHaveText(TEN[0]);
    await expect(page.getByTestId('pos')).toHaveText(`1 / 10 · ${TEN[0]}`);
    await expect(page.locator('footer')).toContainText('Dieter Rams');
    await expect(page.locator('footer')).toContainText('original');
  });

  test('keyboard tour: arrows, Home and End move between principles and focus follows the heading', async ({ page }) => {
    await page.goto(URL);
    await page.locator('#h1').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect(visible(page)).toHaveAttribute('data-principle', '4');
    await expect(page.locator('#h4')).toBeFocused();
    await expect(page).toHaveURL(/#principle-4$/);
    await expect(page.getByTestId('rail-4')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('rail-3')).not.toHaveAttribute('aria-current', 'step');
    await page.keyboard.press('End');
    await expect(visible(page)).toHaveAttribute('data-principle', '10');
    await expect(page.getByTestId('next')).toBeDisabled();
    await page.keyboard.press('ArrowRight');                     // past the end stays at 10
    await expect(visible(page)).toHaveAttribute('data-principle', '10');
    await page.keyboard.press('Home');
    await expect(visible(page)).toHaveAttribute('data-principle', '1');
    await expect(page.getByTestId('prev')).toBeDisabled();
    await page.keyboard.press('ArrowLeft');
    await expect(visible(page)).toHaveAttribute('data-principle', '1');
    // arrows inside a slider adjust the slider, not the tour
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');                        // 10 → 6
    await expect(visible(page)).toHaveAttribute('data-principle', '6');
    await page.getByTestId('d6-level').focus();
    await page.keyboard.press('ArrowRight');
    await expect(visible(page)).toHaveAttribute('data-principle', '6');
    await expect(page.getByTestId('d6-actual')).toHaveText('26%');
    // the Next button and the rail links work too, and Tab reaches them
    await page.getByTestId('next').click();
    await expect(page.locator('#h7')).toBeFocused();
    await page.getByTestId('rail-2').click();
    await expect(visible(page).locator('h2')).toHaveText(TEN[1]);
  });

  test('deep links: #principle-N opens that principle, history works, bad hashes fall back to 1', async ({ page }) => {
    await page.goto(URL + '#principle-6');
    await expect(visible(page)).toHaveAttribute('data-principle', '6');
    await expect(visible(page)).toHaveAttribute('data-slug', 'honest');
    await page.getByTestId('rail-9').click();
    await expect(page).toHaveURL(/#principle-9$/);
    await expect(visible(page).locator('h2')).toHaveText(TEN[8]);
    await page.goBack();
    await expect(page).toHaveURL(/#principle-6$/);
    await expect(visible(page)).toHaveAttribute('data-principle', '6');
    await page.goForward();
    await expect(visible(page)).toHaveAttribute('data-principle', '9');
    await page.reload();
    await expect(visible(page)).toHaveAttribute('data-principle', '9');
    // editing the hash by hand
    await page.evaluate(() => { location.hash = '#principle-3'; });
    await expect(visible(page)).toHaveAttribute('data-principle', '3');
    for (const bad of ['#principle-42', '#principle-0', '#nope']) {
      await page.goto(URL + bad);
      await expect(visible(page)).toHaveAttribute('data-principle', '1');
    }
    for (let n = 1; n <= 10; n++) await expect(page.getByTestId('rail-' + n)).toHaveAttribute('href', `#principle-${n}`);
  });

  test('1 innovative: a 12-minute timer takes 13 actions with plus/minus buttons and 1 with remembered times', async ({ page }) => {
    await page.goto(URL + '#principle-1');
    for (let i = 0; i < 12; i++) await page.getByTestId('d1-plus').click();
    await expect(page.getByTestId('d1-display')).toHaveText('12:00');
    await page.getByTestId('d1-start').click();
    await expect(page.getByTestId('d1-say')).toHaveText('Running 12:00 after 13 actions.');
    await page.getByTestId('d1-mode-memory').click();
    await expect(page.getByTestId('d1-actions')).toHaveText('0');
    await page.getByTestId('d1-chip-12').click();
    await expect(page.getByTestId('d1-display')).toHaveText('12:00 ▶');
    await expect(page.getByTestId('d1-say')).toHaveText('Running 12:00 after 1 action. The remembered-times design needed 12 fewer.');
    expect((await demo(page, 1)).results).toEqual({ buttons: 13, memory: 1 });
    await expect(page.getByTestId('d1-r-buttons')).toHaveText('13 actions');
    await expect(page.getByTestId('d1-r-memory')).toHaveText('1 action');
    // the wrong time is not counted as a success
    await page.getByTestId('d1-chip-5').click();
    await expect(page.getByTestId('d1-say')).toContainText('That started 05:00, not 12:00');
    expect((await demo(page, 1)).results.memory).toBe(1);
  });

  test('2 useful: needs met rise only with the features that serve them; extras are counted', async ({ page }) => {
    await page.goto(URL + '#principle-2');
    await expect(page.getByTestId('d2-met')).toHaveText('0 / 3');
    await expect(page.getByTestId('d2-extra')).toHaveText('3');
    await expect(page.getByTestId('d2-say')).toHaveText('3 real needs are not met, whatever else it can do.');
    for (const f of ['digits', 'alarm', 'stop']) await page.getByTestId('d2-' + f).check();
    await expect(page.getByTestId('d2-met')).toHaveText('3 / 3');
    await expect(page.getByTestId('d2-say')).toHaveText('Every need is met, but 3 features still add things to learn and break.');
    for (const f of ['radio', 'app', 'anim']) await page.getByTestId('d2-' + f).uncheck();
    expect(await demo(page, 2)).toMatchObject({ met: 3, extra: 0 });
    await expect(page.getByTestId('d2-say')).toContainText('Useful: every part serves the job');
    await page.getByTestId('d2-alarm').uncheck();
    await expect(page.getByTestId('d2-say')).toHaveText('1 real need is not met, whatever else it can do.');
  });

  test('3 aesthetic: the order slider aligns the blocks; edges and offsets match a measurement of the layout', async ({ page }) => {
    await page.goto(URL + '?seed=7#principle-3');
    /** Measure the blocks directly: their left edges relative to the canvas, and the intended grid (20 or 200). */
    const measure = () => page.getByTestId('d3-canvas').evaluate((c) => {
      const box = c.getBoundingClientRect();
      const lefts = [...c.querySelectorAll('[data-block]')].map((e) => Math.round((e.getBoundingClientRect().left - box.left) * 10) / 10);
      const grid = [20, 20, 20, 200, 20, 200];
      return { edges: new Set(lefts).size, off: lefts.reduce((a, l, i) => a + Math.abs(l - grid[i]), 0) / 6 };
    });
    let m = await measure();
    expect(m.edges).toBeGreaterThan(2);
    await expect(page.getByTestId('d3-edges')).toHaveText(String(m.edges));
    await expect(page.getByTestId('d3-off')).toHaveText(m.off.toFixed(1) + ' px');
    await page.getByTestId('d3-order').fill('50');
    const half = await measure();
    expect(half.off).toBeCloseTo(m.off / 2, 0);                    // offsets shrink in proportion
    await page.getByTestId('d3-order').fill('100');
    m = await measure();
    expect(m).toEqual({ edges: 2, off: 0 });
    await expect(page.getByTestId('d3-edges')).toHaveText('2');
    await expect(page.getByTestId('d3-off')).toHaveText('0.0 px');
    await expect(page.getByTestId('d3-say')).toContainText('two left edges');
    // the disorder is seeded: same seed, same offsets; another seed, different ones
    const a = (await demo(page, 3)).offsets;
    await page.reload();
    expect((await demo(page, 3)).offsets).toEqual(a);
    await page.goto(URL + '?seed=8#principle-3');
    expect((await demo(page, 3)).offsets).not.toEqual(a);
  });

  test('4 understandable: symbols alone cost wrong presses; labels make all four controls explain themselves', async ({ page }) => {
    await page.goto(URL + '#principle-4');
    await expect(page.getByTestId('d4-self')).toHaveText('0 / 4');
    await page.getByRole('button', { name: 'Symbol 2' }).click();
    await page.getByRole('button', { name: 'Symbol 4' }).click();
    await expect(page.getByTestId('d4-wrong')).toHaveText('2');
    await expect(page.getByTestId('d4-say')).toHaveText('That was “Light”. Try again.');
    await page.getByRole('button', { name: 'Symbol 1' }).click();
    await expect(page.getByTestId('d4-say')).toHaveText('Paused after 2 wrong presses, from symbols alone.');
    await expect(page.getByTestId('d4-display')).toHaveText('07:42 ❚❚');
    await page.getByTestId('d4-labels').click();
    await expect(page.getByTestId('d4-self')).toHaveText('4 / 4');
    await expect(page.getByTestId('d4-wrong')).toHaveText('0');
    await page.getByRole('button', { name: /Pause/ }).click();
    await expect(page.getByTestId('d4-say')).toHaveText('Paused after 0 wrong presses, with labels.');
    expect(await demo(page, 4)).toEqual({ labels: true, wrong: 0, done: true });
  });

  test('5 unobtrusive: removing decoration cuts the items and the search estimate; task time is measured under page.clock', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-27T09:00:00Z') });
    await page.goto(URL + '#principle-5');
    await page.clock.pauseAt(new Date('2026-09-27T09:00:05Z'));
    await expect(page.getByTestId('d5-items')).toHaveText('13');
    await expect(page.getByTestId('d5-est')).toHaveText('650 ms');           // 13 / 2 × 100 ms
    await expect(page.getByTestId('d5-panel').locator('.deco')).toHaveCount(10);
    await page.getByTestId('d5-stop').click();
    await expect(page.getByTestId('d5-say')).toHaveText('Press “Start the task” first.');
    await page.getByTestId('d5-start').click();
    await page.clock.runFor(2300);
    await page.getByTestId('d5-stop').click();
    await expect(page.getByTestId('d5-time')).toHaveText('2.30 s');
    await page.getByTestId('d5-deco').click();
    await expect(page.getByTestId('d5-deco')).toHaveText('Decoration off');
    await expect(page.getByTestId('d5-items')).toHaveText('3');
    await expect(page.getByTestId('d5-est')).toHaveText('150 ms');
    await expect(page.getByTestId('d5-panel').locator('.deco')).toHaveCount(0);
    await page.getByTestId('d5-start').click();
    await page.clock.runFor(800);
    await page.getByTestId('d5-stop').click();
    await expect(page.getByTestId('d5-say')).toHaveText('Stopped in 0.80 s with 3 things on the panel. Plain: 0.80 s; decorated: 2.30 s.');
    const s = await demo(page, 5);
    expect(s.times.decorated).toBe(2300);
    expect(s.times.plain).toBe(800);
  });

  test('6 honest: the flattering gauge has a lie factor of √v / v; the honest one is exactly 1', async ({ page }) => {
    await page.goto(URL + '#principle-6');
    const bar = () => page.getByTestId('d6-gauge').evaluate((g) => (g.querySelector('i') as HTMLElement).getBoundingClientRect().width / g.getBoundingClientRect().width);
    for (const level of [25, 64, 9]) {
      await page.getByTestId('d6-level').fill(String(level));
      const v = level / 100, shown = await bar();
      expect(shown).toBeCloseTo(Math.sqrt(v), 2);                 // measured on screen
      await expect(page.getByTestId('d6-lie')).toHaveText((Math.sqrt(v) / v).toFixed(2));
    }
    await expect(page.getByTestId('d6-lie')).toHaveText('3.33');   // 0.3 / 0.09
    await page.getByTestId('d6-level').fill('25');
    await expect(page.getByTestId('d6-say')).toHaveText('The bar shows 50% for a 25% charge: 2.00 times the truth.');
    await page.getByTestId('d6-honest').click();
    expect(await bar()).toBeCloseTo(0.25, 2);
    await expect(page.getByTestId('d6-lie')).toHaveText('1.00');
    await expect(page.getByTestId('d6-claim')).toHaveText('25% · about 8 h');
    await expect(page.getByTestId('d6-gauge')).toHaveAttribute('aria-label', 'Battery gauge showing 25 percent');
  });

  test('7 long-lasting and 9 environment: half-life and energy models match hand calculations', async ({ page }) => {
    await page.goto(URL + '#principle-7');
    await page.getByTestId('d7-years').fill('4');
    // glossy (3 y) and neon (2 y) on: fresh = 0.5^(4/3) × 0.5^(4/2) = 0.5^(10/3)
    const fresh = 0.5 ** (4 / 3 + 2);
    await expect(page.getByTestId('d7-fresh')).toHaveText((fresh * 100).toFixed(1) + '%');
    await expect(page.getByTestId('d7-dated')).toHaveText(((1 - fresh) * 100).toFixed(1) + '%');
    await expect(page.getByTestId('d7-dated')).toHaveText('90.1%');
    await expect(page.getByTestId('d7-device')).toHaveClass(/glossy/);
    await page.getByTestId('d7-glossy').uncheck();
    await page.getByTestId('d7-neon').uncheck();
    await expect(page.getByTestId('d7-dated')).toHaveText('0.0%');
    await expect(page.getByTestId('d7-device')).not.toHaveClass(/glossy|neon/);
    await page.getByTestId('d7-years').fill('15');
    await expect(page.getByTestId('d7-say')).toContainText('No trends to date it');

    await page.getByTestId('next').click();
    await page.getByTestId('next').click();
    await expect(visible(page)).toHaveAttribute('data-principle', '9');
    // stated assumptions: 1 h × 0.6 W + 8 h lit × 0.6 W + 15 h × 0.5 W standby = 12.9 Wh a day
    await expect(page.getByTestId('d9-energy')).toHaveText((12.9 * 365 / 1000).toFixed(2) + ' kWh');
    await expect(page.getByTestId('d9-units')).toHaveText('4');                 // ceil(10 / 2.5)
    await page.getByTestId('d9-autooff').check();
    await expect(page.getByTestId('d9-energy')).toHaveText(((0.6 + 23 * 0.5) * 365 / 1000).toFixed(2) + ' kWh');
    await page.getByTestId('d9-trueoff').check();
    await page.getByTestId('d9-repair').check();
    await expect(page.getByTestId('d9-energy')).toHaveText(((0.6 + 23 * 0.05) * 365 / 1000).toFixed(2) + ' kWh');   // 0.64
    await expect(page.getByTestId('d9-units')).toHaveText('1');
    const s = await demo(page, 9);
    expect(s.kwh).toBeCloseTo(1.75 * 0.365, 9);
  });

  test('8 thorough: each detail changes something measurable on the device', async ({ page }) => {
    await page.goto(URL + '#principle-8');
    const minTarget = () => page.getByTestId('d8-device').locator('.keys button').evaluateAll((bs) => Math.min(...bs.map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); })));
    expect(await minTarget()).toBeLessThan(44);
    await page.getByTestId('d8-targets').check();
    expect(await minTarget()).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId('d8-min')).toHaveText(`${(await minTarget()).toFixed(0)} px`);
    // focus ring: reach the second button with Tab so :focus-visible applies
    const ring = async () => { await page.getByTestId('d8-b1').focus(); await page.keyboard.press('Tab'); return page.getByTestId('d8-b2').evaluate((b) => [document.activeElement === b, getComputedStyle(b).outlineStyle]); };
    expect(await ring()).toEqual([true, 'none']);
    await page.getByTestId('d8-focus').check();
    expect(await ring()).toEqual([true, 'solid']);
    const num = page.getByTestId('d8-num');
    expect(await num.evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toBe('proportional-nums');
    await page.getByTestId('d8-tabular').check();
    expect(await num.evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toBe('tabular-nums');
    await expect(num).toHaveText('1:11 · 60');
    await page.getByTestId('d8-units').check();
    await expect(num).toHaveText('1:11 min · 60 dB');
    await expect(page.getByTestId('d8-err')).toHaveText('Error 3');
    await page.getByTestId('d8-error').check();
    await expect(page.getByTestId('d8-err')).toContainText('press − to lower it');
    await expect(page.getByTestId('d8-done')).toHaveText('5 / 5');
    await expect(page.getByTestId('d8-say')).toContainText('Every detail is handled');
  });

  test('10 as little design as possible: remove parts until only the essential four remain; one more and it breaks', async ({ page }) => {
    await page.goto(URL + '#principle-10');
    await expect(page.getByTestId('d10-count')).toHaveText('10');
    await expect(page.getByTestId('d10-device').locator('[data-part]')).toHaveCount(10);
    const extras = ['badge', 'trim', 'clock', 'stripe', 'led', 'modes'];
    for (const [i, id] of extras.entries()) {
      await page.getByTestId('d10-' + id).uncheck();
      await expect(page.getByTestId('d10-works')).toHaveText('yes');
      await expect(page.getByTestId('d10-count')).toHaveText(String(9 - i));
    }
    await expect(page.getByTestId('d10-device').locator('[data-part]')).toHaveCount(4);
    await expect(page.getByTestId('d10-say')).toHaveText('As little as possible: 4 parts, and every one of them is needed.');
    expect(await demo(page, 10)).toEqual({ count: 4, works: true, extras: 0, minimal: true });
    await page.getByTestId('d10-dial').uncheck();
    await expect(page.getByTestId('d10-works')).toHaveText('no');
    await expect(page.getByTestId('d10-say')).toHaveText('Broken: without the setting dial, you could not set a time. Put it back; that was one step too far.');
    await page.getByTestId('d10-dial').check();
    await expect(page.getByTestId('d10-works')).toHaveText('yes');
  });
});
