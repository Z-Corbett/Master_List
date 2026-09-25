import { test, expect, Page } from '@playwright/test';

const URL = '/lab/110-tuning-lab.html';
const S = (page: Page) => page.evaluate(() => (window as any).__tuning.state);
// independent oracles
const tet = (a4: number, midi: number) => a4 * Math.pow(2, (midi - 69) / 12);
const cents = (r: number) => 1200 * Math.log2(r);
const num = async (page: Page, id: string) => parseFloat((await page.getByTestId(id).textContent())!.replace('−', '-').replace('±', ''));

const INTERVALS: [string, number, number, number][] = [
  ['m2', 1, 16, 15], ['M2', 2, 9, 8], ['m3', 3, 6, 5], ['M3', 4, 5, 4], ['P4', 5, 4, 3], ['TT', 6, 45, 32],
  ['P5', 7, 3, 2], ['m6', 8, 8, 5], ['M6', 9, 5, 3], ['m7', 10, 9, 5], ['M7', 11, 15, 8], ['P8', 12, 2, 1],
];

test.describe('110 Tuning Lab', () => {
  test('defaults: A4 = 440 puts C4 at 261.626 Hz, and the fifth is 700 vs 701.955 cents', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('a4')).toHaveValue('440');
    await expect(page.getByTestId('root-name')).toHaveText('C4');
    await expect(page.getByTestId('root-hz')).toHaveText('261.626');
    expect(tet(440, 60)).toBeCloseTo(261.6256, 4);
    await expect(page.getByTestId('pick-P5')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('et-c-P5')).toHaveText('700.00');
    await expect(page.getByTestId('just-c-P5')).toHaveText('701.955');
    expect(cents(3 / 2)).toBeCloseTo(701.955, 3);
    await expect(page.getByTestId('diff-P5')).toHaveText('+1.955¢');
    await expect(page.getByTestId('et-hz-P5')).toHaveText(tet(440, 67).toFixed(3));          // G4 391.995
    await expect(page.getByTestId('just-hz-P5')).toHaveText((tet(440, 60) * 1.5).toFixed(3)); // 392.438
    await expect(page.getByTestId('summary')).toContainText('C4–G4 perfect fifth');
  });

  test('major third: 400 vs 386.314 cents, and the 5:4 harmonics beat at |5·C4 − 4·E4|', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('pick-M3').click();
    await expect(page.getByTestId('row-M3')).toContainText('E4 · Major third');
    await expect(page.getByTestId('et-c-M3')).toHaveText('400.00');
    await expect(page.getByTestId('just-c-M3')).toHaveText('386.314');
    await expect(page.getByTestId('diff-M3')).toHaveText('−13.686¢');
    const c4 = tet(440, 60), e4 = tet(440, 64);
    expect(e4).toBeCloseTo(329.628, 3);
    const beat = Math.abs(5 * c4 - 4 * e4);                      // about 10.38 Hz: the famously rough ET third
    expect(beat).toBeGreaterThan(10.3);
    expect(Math.abs((await num(page, 'beat-M3')) - beat)).toBeLessThan(0.0006);
    await expect(page.getByTestId('just-beat-M3')).toHaveText('0.000');
    await expect(page.getByTestId('row-M3')).toContainText(`one swell every ${(1 / beat).toFixed(2)} s`);
  });

  test('every interval: ET cents are 100·n and just cents are 1200·log2(p/q)', async ({ page }) => {
    await page.goto(URL);
    for (const [code, n, p, q] of INTERVALS) {
      await page.getByTestId(`pick-${code}`).click();
      await expect(page.getByTestId(`row-${code}`)).toContainText(`just ${p}/${q}`);
      expect(await num(page, `et-c-${code}`)).toBe(100 * n);
      expect(Math.abs((await num(page, `just-c-${code}`)) - cents(p / q))).toBeLessThan(0.0006);
      expect(Math.abs((await num(page, `diff-${code}`)) - (cents(p / q) - 100 * n))).toBeLessThan(0.0006);
      expect(Math.abs((await num(page, `et-hz-${code}`)) - tet(440, 60 + n))).toBeLessThan(0.0006);
      expect(Math.abs((await num(page, `just-hz-${code}`)) - tet(440, 60) * p / q)).toBeLessThan(0.0006);
    }
    // published reference values
    await page.getByTestId('pick-TT').click();
    await expect(page.getByTestId('just-c-TT')).toHaveText('590.224');   // 45/32
    await page.getByTestId('pick-m3').click();
    await expect(page.getByTestId('just-c-m3')).toHaveText('315.641');   // 6/5
  });

  test('beat rates: A–E fifth near 1.49 Hz, the octave is beatless, and just never beats', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('root').selectOption('A');
    await expect(page.getByTestId('root-hz')).toHaveText('440.000');
    const e5 = tet(440, 76);
    expect(e5).toBeCloseTo(659.255, 3);
    const want = Math.abs(3 * 440 - 2 * e5);                      // 1320 − 1318.51
    expect(Math.abs((await num(page, 'beat-P5')) - want)).toBeLessThan(0.0006);
    await expect(page.getByTestId('just-hz-P5')).toHaveText('660.000');
    await page.getByTestId('pick-P8').click();
    await expect(page.getByTestId('beat-P8')).toHaveText('0.000');
    await expect(page.getByTestId('diff-P8')).toHaveText('±0.000¢');
    // across every interval the just beat is exactly zero, the ET beat matches |p·f0 − q·f|
    const s = await page.evaluate(async () => {
      const out: any[] = [];
      for (const b of document.querySelectorAll<HTMLButtonElement>('[data-testid^="pick-"]')) { b.click(); out.push(...(window as any).__tuning.state.rows); }
      return out;
    });
    for (const r of s) {
      expect(r.justBeat).toBeLessThan(1e-9);
      expect(r.beat).toBeCloseTo(Math.abs(r.p * 440 - r.q * tet(440, 69 + r.n)), 9);
    }
  });

  test('editing A4 retunes everything, and bad values are refused', async ({ page }) => {
    await page.goto(URL);
    const a4 = page.getByTestId('a4');
    await a4.fill('432');
    await expect(page.getByTestId('root-hz')).toHaveText(tet(432, 60).toFixed(3));     // 256.869
    await expect(page.getByTestId('et-hz-P5')).toHaveText(tet(432, 67).toFixed(3));
    await expect(page.getByTestId('just-c-P5')).toHaveText('701.955');                  // cents do not depend on A4
    await a4.fill('20');
    await expect(a4).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('a4-error')).toHaveText('Enter a reference between 380 and 500 Hz. Still using 432 Hz.');
    await expect(page.getByTestId('root-hz')).toHaveText(tet(432, 60).toFixed(3));
    await a4.fill('');
    await expect(page.getByTestId('a4-error')).toContainText('Still using 432 Hz');
    await a4.fill('415');                                                               // baroque pitch
    await expect(a4).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('a4-error')).toHaveText('');
    expect((await S(page)).a4).toBe(415);
    await expect(page.getByTestId('root-hz')).toHaveText(tet(415, 60).toFixed(3));
  });

  test('chords: a just major triad is 4:5:6 and each note gets its own card and beat strip', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('pick-maj').click();
    await expect(page.locator('[data-testid^="row-"]')).toHaveCount(2);
    const s = await S(page);
    const [third, fifth] = s.rows;
    expect(s.rootHz / 4).toBeCloseTo(third.justHz / 5, 9);
    expect(third.justHz / 5).toBeCloseTo(fifth.justHz / 6, 9);
    await expect(page.getByTestId('row-M3')).toContainText('E4');
    await expect(page.getByTestId('row-P5')).toContainText('G4');
    await expect(page.locator('[data-testid^="strip-"]')).toHaveCount(2);
    await page.getByTestId('pick-maj7').click();
    await expect(page.locator('[data-testid^="row-"]')).toHaveCount(3);
    await expect(page.getByTestId('row-M7')).toContainText('B4');
    await expect(page.getByTestId('just-c-M7')).toHaveText(cents(15 / 8).toFixed(3));  // 1088.269
    await page.getByTestId('pick-min').click();
    await expect(page.getByTestId('row-m3')).toContainText('E♭4');
    await expect(page.getByTestId('summary')).toContainText('C4–E♭4 minor third');
  });

  test('the beat chart and waveform follow the numbers', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('pick-M3').click();
    const strip = page.getByTestId('strip-M3');
    const beat = Math.abs(5 * tet(440, 60) - 4 * tet(440, 64));
    expect(Math.abs(parseFloat((await strip.getAttribute('data-beat'))!) - beat)).toBeLessThan(0.0001);
    await expect(strip.locator('path')).toHaveCount(2);
    await expect(page.getByTestId('beats')).toHaveAttribute('aria-label', new RegExp(`E4: ${beat.toFixed(3)} Hz beating in 12-TET, none in just`));
    // read the envelope back out of the drawn band: the ET band pinches to nothing once per beat, the just band never does
    const env = await page.evaluate(() => {
      const read = (k: string) => {
        const p = document.querySelector(`[data-testid="strip-M3"] path[data-kind="${k}"]`)!;
        const mid = parseFloat(p.getAttribute('data-mid')!);
        const pts = p.getAttribute('d')!.replace('Z', '').split(/[ML]/).filter(Boolean).map((s) => s.trim().split(' ').map(Number));
        const top = pts.slice(0, pts.length / 2);
        const amp = Math.max(...top.map(([, y]) => mid - y));
        return top.map(([, y]) => (mid - y) / amp);
      };
      return { et: read('et'), just: read('just') };
    });
    expect(Math.min(...env.just)).toBeGreaterThan(0.999);
    let dips = 0;
    for (let i = 1; i < env.et.length; i++) if (env.et[i - 1] >= 0.2 && env.et[i] < 0.2) dips++;
    expect(Math.abs(dips - Math.floor(4 * beat + 0.5))).toBeLessThanOrEqual(1);   // about 42 swells in 4 s
    await expect(page.getByTestId('wave').locator('path')).toHaveCount(2);
    await expect(page.getByTestId('wave')).toHaveAttribute('aria-label', /C4 with E4/);
  });

  test('keyboard: the picker is a radiogroup with arrow keys, and the root select renames notes', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole('radiogroup', { name: 'Interval or chord' })).toBeVisible();
    await expect(page.getByTestId('pick-P5')).toHaveAttribute('tabindex', '0');
    await expect(page.getByTestId('pick-P4')).toHaveAttribute('tabindex', '-1');
    await page.getByTestId('pick-P5').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('pick-m6')).toBeFocused();
    await expect(page.getByTestId('pick-m6')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('pick-TT')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByTestId('pick-maj7')).toBeFocused();
    await page.keyboard.press('ArrowRight');                                   // wraps round
    await expect(page.getByTestId('pick-m2')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('root').selectOption('Fs');
    await expect(page.getByTestId('root-name')).toHaveText('F♯4');
    await expect(page.getByTestId('row-m2')).toContainText('G4');
    await expect(page.getByTestId('root-hz')).toHaveText(tet(440, 66).toFixed(3));
  });

  test('sound waits for a gesture, then plays exactly the frequencies on screen', async ({ page }) => {
    await page.goto(URL);
    expect((await S(page)).audio).toBe('none');
    await page.getByTestId('pick-M3').click();                                 // choosing is not playing
    expect((await S(page)).audio).toBe('none');
    await page.getByTestId('play-just').click();
    await expect.poll(async () => (await S(page)).audio).toBe('running');
    let s = await S(page);
    expect(s.lastPlay.sounded).toBe(true);
    expect(s.lastPlay.freqs[0]).toBeCloseTo(tet(440, 60), 9);
    expect(s.lastPlay.freqs[1]).toBeCloseTo(tet(440, 60) * 5 / 4, 9);
    expect(s.voices).toBe(2);
    await expect(page.getByTestId('status')).toContainText('just intonation: 261.63, 327.03 Hz');
    await page.getByTestId('play-et').click();
    await expect(page.getByTestId('status')).toContainText('equal temperament: 261.63, 329.63 Hz');
    s = await S(page);
    expect(s.voices).toBe(2);                                                   // previous notes were replaced
    await page.getByTestId('play-ref').click();
    await expect(page.getByTestId('status')).toHaveText('Playing the A4 reference, 440 Hz.');
    await page.getByTestId('stop').click();
    await expect(page.getByTestId('status')).toHaveText('Stopped.');
    expect((await S(page)).voices).toBe(0);
  });

  test('without Web Audio the page still works and says so; a suspended context is reported', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { delete (window as any).AudioContext; delete (window as any).webkitAudioContext; });
    await page.goto(URL);
    await page.getByTestId('play-et').click();
    await expect(page.getByTestId('status')).toContainText('Web Audio is not available');
    let s = await S(page);
    expect(s.audio).toBe('unavailable');
    expect(s.lastPlay.sounded).toBe(false);
    await page.getByTestId('pick-M6').click();
    await expect(page.getByTestId('just-c-M6')).toHaveText(cents(5 / 3).toFixed(3));   // 884.359
    // now a browser that keeps the context suspended
    const p2 = await page.context().newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.addInitScript(() => {
      Object.defineProperty(AudioContext.prototype, 'state', { get: () => 'suspended' });
      AudioContext.prototype.resume = () => Promise.resolve();
    });
    await p2.goto(URL);
    await p2.getByTestId('play-just').click();
    await expect(p2.getByTestId('status')).toContainText('kept audio suspended');
    s = await S(p2);
    expect(s.audio).toBe('suspended');
    expect(s.lastPlay.sounded).toBe(false);
    expect(s.voices).toBe(0);
    expect(errors).toEqual([]);
  });

  test('the address shares the setup', async ({ page }) => {
    await page.goto(URL + '#root=A&sel=maj&a4=442');
    await expect(page.getByTestId('a4')).toHaveValue('442');
    await expect(page.getByTestId('root-name')).toHaveText('A4');
    await expect(page.getByTestId('root-hz')).toHaveText('442.000');
    await expect(page.getByTestId('pick-maj')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('row-M3')).toContainText('C♯5');
    await page.getByTestId('pick-P4').click();
    await expect(page).toHaveURL(/#root=A&sel=P4&a4=442$/);
    // junk in the hash falls back to the defaults
    await page.goto('about:blank');
    await page.goto(URL + '#root=H&sel=zzz&a4=9');
    await expect(page.getByTestId('root-name')).toHaveText('C4');
    await expect(page.getByTestId('a4')).toHaveValue('440');
    await expect(page.getByTestId('pick-P5')).toHaveAttribute('aria-checked', 'true');
  });
});
