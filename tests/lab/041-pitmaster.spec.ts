import { test, expect, Page } from '@playwright/test';

const URL = '/lab/041-pitmaster.html?seed=7';
const pit = (page: Page) => page.evaluate(() => (window as any).__pit.state);

/** Light the fire from the UI, then pause the real-time loop so the test drives game minutes itself. */
async function lightAndPause(page: Page) {
  await page.goto(URL);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('start')).toHaveText('Pause');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('start')).toHaveText('Resume');
}

/** Tend the fire like a careful pitmaster (a split whenever the firebox runs low) until `until` holds. */
function tendUntil(page: Page, until: string, max = 800) {
  return page.evaluate(([cond, limit]) => {
    const p = (window as any).__pit;
    const done = new Function('s', `return ${cond}`) as (s: any) => boolean;
    for (let i = 0; i < limit && (p.state.phase === 'cook' || p.state.phase === 'rest'); i++) {
      const s = p.state;
      if (done(s)) break;
      if (s.phase === 'cook' && s.logs < 2.4) p.addWood();
      p.step(1);
    }
    return p.state;
  }, [until, max] as const);
}

test.describe('041 Pitmaster', () => {
  test('the real-time loop runs 3 game minutes per second and the speed buttons multiply it', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-10T20:00:00') });
    await page.clock.pauseAt(new Date('2026-10-10T20:00:01'));
    await page.goto(URL);
    await page.clock.runFor(200);
    await page.getByTestId('start').click();
    await page.clock.runFor(10_000);
    let min = (await pit(page)).min;
    expect(min).toBeGreaterThanOrEqual(29);
    expect(min).toBeLessThanOrEqual(31);
    await expect(page.getByTestId('clock')).toHaveText(/^12:(29|30|31) AM$/);

    await page.getByTestId('speed-4').click();
    await expect(page.getByTestId('speed-4')).toHaveAttribute('aria-pressed', 'true');
    await page.clock.runFor(5_000);
    const min2 = (await pit(page)).min;
    expect(min2 - min).toBeGreaterThanOrEqual(58);
    expect(min2 - min).toBeLessThanOrEqual(62);

    // pausing freezes game time
    await page.getByTestId('start').click();
    await expect(page.getByTestId('phase')).toHaveText('Paused');
    await page.clock.runFor(3_000);
    expect((await pit(page)).min).toBe(min2);
  });

  test('feeding the fire and opening the vent brings the pit into the 225–275°F zone', async ({ page }) => {
    await lightAndPause(page);
    const before = await pit(page);
    await page.getByTestId('add-wood').click();
    const after = await pit(page);
    expect(after.logs).toBeGreaterThan(before.logs + 0.7);
    await expect(page.getByTestId('logs')).toHaveText(after.logs.toFixed(1));
    // keyboard shortcut does the same
    await page.keyboard.press('w');
    expect((await pit(page)).splitsAdded).toBe(2);
    // a packed firebox runs hot
    await page.evaluate(() => (window as any).__pit.step(45));
    expect((await pit(page)).pit).toBeGreaterThan(290);
    await expect(page.getByTestId('pit-state')).toHaveText(/running hot|scorching/);

    await page.getByTestId('vent').fill('55');
    await expect(page.getByTestId('vent-out')).toHaveText('55%');
    await tendUntil(page, 's.min >= 180');
    const s = await pit(page);
    expect(s.pit).toBeGreaterThanOrEqual(225);
    expect(s.pit).toBeLessThanOrEqual(285);
    await expect(page.getByTestId('pit-state')).toHaveText(/in the zone|running hot/);
    await expect(page.getByTestId('smoke-state')).toHaveText(/thin blue|white/);
    await expect(page.getByTestId('log')).toContainText("Pit's in the zone");
  });

  test('a starved, neglected fire smokes dirty and then dies down to coals', async ({ page }) => {
    await lightAndPause(page);
    await page.getByTestId('vent').fill('10');
    await page.evaluate(() => (window as any).__pit.step(20));
    await expect(page.getByTestId('smoke-state')).toHaveText('thick & white');
    await expect(page.getByTestId('log')).toContainText('starved for air');
    await page.getByTestId('vent').fill('50');
    await page.evaluate(() => (window as any).__pit.step(420));
    const s = await pit(page);
    expect(s.pit).toBeLessThan(170);
    expect(s.meat).toBeLessThan(150);
    expect(s.dirtyMin).toBeGreaterThan(15);
    await expect(page.getByTestId('log')).toContainText('down to coals');
    await expect(page.getByTestId('pit-state')).toHaveText('way too cool');
  });

  test('the stall shows up, and wrapping in butcher paper pushes through it', async ({ page }) => {
    await lightAndPause(page);
    const s = await tendUntil(page, 's.stall');
    expect(s.stall).toBe(true);
    expect(s.meat).toBeGreaterThan(148);
    expect(s.meat).toBeLessThan(178);
    await expect(page.getByTestId('stall-badge')).toBeVisible();
    await expect(page.getByTestId('meat-state')).toHaveText('stalled');
    await expect(page.getByTestId('log')).toContainText('The stall');

    await tendUntil(page, 's.meat >= 165');
    const atWrap = await pit(page);
    await page.getByTestId('wrap-paper').click();
    await expect(page.getByTestId('stall-badge')).toBeHidden();
    await expect(page.getByTestId('wrap-paper')).toBeDisabled();
    await expect(page.getByTestId('wrap-foil')).toBeDisabled();
    await expect(page.getByTestId('log')).toContainText('Wrapped in butcher paper');
    // an hour later the wrapped brisket has climbed clearly faster than the same night left unwrapped
    const later = await tendUntil(page, `s.min >= ${atWrap.min + 60}`);
    expect(later.wrap).toBe('paper');
    const wrappedRise = later.meat - atWrap.meat;

    await page.goto(URL);
    await page.getByTestId('start').click();
    await page.getByTestId('start').click();
    const bare = await tendUntil(page, `s.min >= ${atWrap.min + 60}`);
    expect(bare.wrap).toBe(null);
    expect(bare.meat).toBeLessThan(later.meat - 3);
    expect(wrappedRise).toBeGreaterThan(1.5 * (bare.meat - atWrap.meat));
  });

  test('a well-run cook scores high; pulling early and skipping the rest does not', async ({ page }) => {
    await lightAndPause(page);
    await tendUntil(page, 's.meat >= 165');
    await page.getByTestId('wrap-paper').click();
    await tendUntil(page, 's.meat >= 203');
    await page.getByTestId('pull').click();
    await expect(page.getByTestId('slice')).toBeVisible();
    await expect(page.getByTestId('meat-state')).toHaveText(/resting/);
    await page.evaluate(() => (window as any).__pit.step(70));
    await page.getByTestId('slice').click();
    const card = page.getByTestId('scorecard');
    await expect(card).toBeVisible();
    const good = Number(await page.getByTestId('score-overall').textContent());
    expect(good).toBeGreaterThanOrEqual(90);
    await expect(page.getByTestId('grade')).toHaveText('Line out the door by 10 AM');
    await expect(page.getByTestId('score-tender')).toHaveText('100');

    // same night, rushed: pulled at 190°F with a 20-minute rest
    await page.getByTestId('again').click();
    await expect(card).toBeHidden();
    await page.getByTestId('start').click();
    await page.getByTestId('start').click();
    await tendUntil(page, 's.meat >= 190');
    await page.getByTestId('pull').click();
    await page.evaluate(() => (window as any).__pit.step(20));
    await page.getByTestId('slice').click();
    const rushed = Number(await page.getByTestId('score-overall').textContent());
    expect(rushed).toBeLessThan(good - 15);
    expect(Number(await page.getByTestId('score-tender').textContent())).toBeLessThan(60);
    await expect(page.getByTestId('notes')).toContainText('chewy');
    await expect(page.getByTestId('notes')).toContainText('20 minutes of rest');
  });

  test('the night is seeded: same seed, same weather and score; noon forces service', async ({ page }) => {
    const run = async (seed: number) => {
      await page.goto(`/lab/041-pitmaster.html?seed=${seed}`);
      await page.getByTestId('start').click();
      await page.getByTestId('start').click();
      const plan = await page.evaluate(() => (window as any).__pit.plan);
      // never pull: the guests arrive at noon and it is sliced with no rest
      const s = await tendUntil(page, 'false', 800);
      return { plan, s };
    };
    const a = await run(7);
    expect(a.s.phase).toBe('done');
    expect(a.s.min).toBe(720);
    expect(a.s.restMin).toBe(0);
    await expect(page.getByTestId('scorecard')).toBeVisible();
    await expect(page.getByTestId('clock')).toHaveText('12:00 PM');
    await expect(page.getByTestId('log')).toContainText('guests are here');
    const b = await run(7);
    expect(b.plan).toEqual(a.plan);
    expect(b.s.score).toEqual(a.s.score);
    const c = await run(8);
    expect(c.plan).not.toEqual(a.plan);
    await expect(page.getByTestId('seed')).toHaveText('#8');
  });
});
