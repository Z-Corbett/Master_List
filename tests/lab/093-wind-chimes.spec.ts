import { test, expect, Page } from '@playwright/test';

const URL = '/lab/093-wind-chimes.html?seed=11';
const S = (page: Page) => page.evaluate(() => (window as any).__chimes.state);
const frames = (page: Page, n: number) => page.evaluate((n) => (window as any).__chimes.frames(n), n);
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Load with the real-time loop detached: the test drives every 1/240 s physics step. */
async function open(page: Page, url = URL) {
  await page.goto(url);
  await page.evaluate(() => { const c = (window as any).__chimes; c.manual(true); c.reset(); });
}

test.describe('093 Wind Chimes', () => {
  test('three tunings: right notes, right frequencies, longer tubes for lower notes', async ({ page }) => {
    await open(page);
    const expectTuning = async (names: string[], midi: number[]) => {
      const s = await S(page);
      expect(s.tubes.map((t: any) => t.name)).toEqual(names);
      s.tubes.forEach((t: any, i: number) => expect(t.freq).toBeCloseTo(mtof(midi[i]), 6));
      for (let i = 1; i < s.tubes.length; i++) expect(s.tubes[i].L).toBeLessThan(s.tubes[i - 1].L);
      await expect(page.locator('[data-testid^="tube-"]')).toHaveCount(names.length);
    };
    await expect(page.getByTestId('tune-pentatonic')).toHaveAttribute('aria-checked', 'true');
    await expectTuning(['C5', 'D5', 'E5', 'G5', 'A5', 'C6'], [72, 74, 76, 79, 81, 84]);
    expect((await S(page)).tubes[0].freq).toBeCloseTo(523.25, 2);
    await page.getByTestId('tune-aeolian').click();
    await expectTuning(['A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5'], [69, 71, 72, 74, 76, 77, 79]);
    expect((await S(page)).tubes[0].freq).toBe(440);
    await expect(page.getByTestId('status')).toContainText('Retuned to Aeolian');
    // arrow keys move through the radiogroup
    await page.getByTestId('tune-aeolian').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tune-bells')).toBeFocused();
    await expect(page.getByTestId('tune-bells')).toHaveAttribute('aria-checked', 'true');
    await expectTuning(['B3', 'E4', 'F♯4', 'G♯4', 'B4'], [59, 64, 66, 68, 71]);
    await expect(page.getByTestId('tune-desc')).toContainText('Westminster Quarters');
  });

  test('the striker is a pendulum: still air stays silent, a nudge swings at 2π√(L/g)', async ({ page }) => {
    await open(page);
    await page.getByTestId('calm').click();
    await expect(page.getByTestId('wind-out')).toHaveText('0%');
    await expect(page.getByTestId('wind-text')).toHaveText('Dead calm');
    await frames(page, 240 * 20);                      // let any swing die away
    const before = (await S(page)).hits.length;
    let s = await frames(page, 240 * 10);
    expect(s.hits.length).toBe(before);
    expect(Math.hypot(s.striker.x, s.striker.z)).toBeLessThan(1e-3);
    // a small push (too small to reach a tube): time the zero crossings
    await page.evaluate(() => (window as any).__chimes.push(0.02, 0));
    const xs: number[] = await page.evaluate(() => {
      const c = (window as any).__chimes, out: number[] = [];
      for (let i = 0; i < 240 * 6; i++) { c.frames(1); out.push(c.state.striker.x); }
      return out;
    });
    const DT = 1 / 240, cross: number[] = [];
    for (let i = 1; i < xs.length; i++) if (xs[i - 1] > 0 && xs[i] <= 0) cross.push((i - 1 + xs[i - 1] / (xs[i - 1] - xs[i])) * DT);
    expect(cross.length).toBeGreaterThanOrEqual(4);
    const period = (cross[cross.length - 1] - cross[0]) / (cross.length - 1);
    const expected = 2 * Math.PI * Math.sqrt(0.3 / 9.81);
    expect(period).toBeGreaterThan(expected * 0.99);
    expect(period).toBeLessThan(expected * 1.01);
    s = await S(page);
    expect(s.hits.length).toBe(before);                 // never touched a tube
  });

  test('seeded wind: the same seed rings the same notes, another seed does not', async ({ page }) => {
    const run = async (url: string) => {
      await open(page, url);
      await page.getByTestId('wind').fill('60');
      const s = await frames(page, 240 * 30);
      return s.hits.map((h: any) => `${h.tube}@${h.t}`);
    };
    const a = await run(URL);
    expect(a.length).toBeGreaterThan(5);
    expect(await run(URL)).toEqual(a);
    expect(await run('/lab/093-wind-chimes.html?seed=12')).not.toEqual(a);
    const s = await S(page);
    const freqs = new Set(s.tubes.map((t: any) => +t.freq.toFixed(2)));
    for (const h of s.hits) { expect(freqs.has(h.freq)).toBe(true); expect(h.amp).toBeGreaterThan(0); expect(h.amp).toBeLessThanOrEqual(1); }
    expect(new Set(s.hits.map((h: any) => h.tube)).size).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('hit-count')).toHaveText(String(s.hits.length));
    // New weather picks a fresh seed and writes it to the address
    await page.getByTestId('reseed').click();
    const seed = (await S(page)).seed;
    expect(seed).not.toBe(12);
    await expect(page.getByTestId('seed')).toHaveText(`seed ${seed}`);
    expect(page.url()).toContain(`seed=${seed}`);
  });

  test('ring a tube by button, number key or a tap on the tube itself', async ({ page }) => {
    await open(page);
    await page.getByTestId('calm').click();
    const n0 = (await S(page)).hits.length;
    await page.getByTestId('tube-1').click();
    let s = await S(page);
    expect(s.hits.slice(n0).map((h: any) => [h.name, h.source])).toEqual([['D5', 'tap']]);
    await expect(page.getByTestId('note-chip').last()).toHaveText('D5');
    await page.keyboard.press('3');
    s = await S(page);
    expect(s.hits[s.hits.length - 1]).toMatchObject({ name: 'E5', source: 'key' });
    expect(s.tubes[2].vib).toBeGreaterThan(0.5);        // it shimmers after the hit
    // tap the canvas right on tube 5 (A5)
    await page.getByTestId('scene').scrollIntoViewIfNeeded();
    const p = await page.evaluate(() => (window as any).__chimes.tubeScreen(4));
    await page.mouse.click(p.x, p.y);
    s = await S(page);
    expect(s.hits[s.hits.length - 1]).toMatchObject({ name: 'A5', source: 'tap' });
    // the struck tube swings away from the centre
    s = await frames(page, 20);
    expect(Math.hypot(s.tubes[4].x, s.tubes[4].z)).toBeGreaterThan(0.001);
    await expect(page.getByTestId('hit-count')).toHaveText(String(s.hits.length));
  });

  test('sound starts on a gesture, and mute silences new strikes', async ({ page }) => {
    await open(page);
    expect((await S(page)).audio).toBe('none');
    await expect(page.getByTestId('mute')).toBeDisabled();
    await page.getByTestId('sound').click();
    await expect(page.getByTestId('status')).toHaveText('Sound is on. Listen for the next gust.');
    await expect.poll(async () => (await S(page)).audio).toBe('running');
    await page.getByTestId('tube-0').click();
    let s = await S(page);
    expect(s.hits[s.hits.length - 1].sounded).toBe(true);
    expect(s.voices).toBeGreaterThan(0);
    await page.getByTestId('mute').click();
    await expect(page.getByTestId('mute')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mute')).toHaveText('Unmute');
    await page.getByTestId('tube-2').click();
    s = await S(page);
    expect(s.muted).toBe(true);
    expect(s.hits[s.hits.length - 1].sounded).toBe(false);
    await expect.poll(async () => (await S(page)).masterGain).toBeLessThan(0.05);
  });
});
