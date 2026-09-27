import { test, expect, Page } from '@playwright/test';

const URL = '/lab/124-theremin.html';
const S = (page: Page) => page.evaluate(() => (window as any).__theremin.state);
const moveTo = (page: Page, x: number, y = 0.35) => page.evaluate(([x, y]) => (window as any).__theremin.moveTo(x, y), [x, y]);
/** x that gives raw frequency f for base f0 and a number of octaves (inverse of f = f0·2^(oct·x)). */
const xFor = (f: number, f0 = 110, oct = 3) => Math.log2(f / f0) / oct;

// Independent 12-TET oracle, A4 = 440 Hz = MIDI 69
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const midi = (f: number) => 69 + 12 * Math.log2(f / 440);
const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
function snap(f: number, pcs: number[]) {
  const m = midi(f);
  let best = NaN, bd = Infinity;
  for (let n = Math.floor(m) - 12; n <= Math.ceil(m) + 12; n++) if (pcs.includes(((n % 12) + 12) % 12) && Math.abs(n - m) < bd) { bd = Math.abs(n - m); best = n; }
  return hz(best);
}
const PCS: Record<string, number[]> = { chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], major: [0, 2, 4, 5, 7, 9, 11], pentatonic: [0, 2, 4, 7, 9], blues: [0, 3, 5, 6, 7, 10] };
const inKey = (scale: string, root: number) => PCS[scale].map((p) => (p + root) % 12);

async function noAudio(page: Page) {
  await page.addInitScript(() => { (window as any).AudioContext = undefined; (window as any).webkitAudioContext = undefined; });
  await page.goto(URL);
}

test.describe('124 Theremin', () => {
  test('pitch mapping f = f0 · 2^(octaves · x): the ends, arrow steps and a change of range', async ({ page }) => {
    await page.goto(URL);
    const field = page.getByTestId('field');
    await field.focus();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('freq')).toHaveText('110.00 Hz');                  // A2
    await expect(page.getByTestId('note')).toHaveText('A2');
    await page.keyboard.press('End');
    await expect(page.getByTestId('freq')).toHaveText('880.00 Hz');                  // three octaves up: A5
    await expect(page.getByTestId('note')).toHaveText('A5');
    await page.keyboard.press('Home');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    let s = await S(page);
    expect(s.x).toBeCloseTo(0.15, 9);
    expect(s.freq).toBeCloseTo(110 * Math.pow(2, 3 * 0.15), 9);
    await expect(page.getByTestId('freq')).toHaveText(`${(110 * Math.pow(2, 0.45)).toFixed(2)} Hz`);
    // five octaves from C2
    await page.getByTestId('base').selectOption('65.41');
    await page.getByTestId('octaves').fill('5');
    await page.keyboard.press('Tab');
    await field.focus();
    await page.keyboard.press('End');
    s = await S(page);
    expect(s.freq).toBeCloseTo(65.41 * 32, 6);
    await expect(page.getByTestId('note')).toHaveText('C7');
    // out-of-range octave counts are clamped to 1..5
    await page.getByTestId('octaves').fill('9');
    await page.getByTestId('octaves').blur();
    await expect(page.getByTestId('octaves')).toHaveValue('5');
  });

  test('pointer: x across the field sets pitch, height sets volume (gain = 1 − y)', async ({ page }) => {
    await page.goto(URL);
    const field = page.getByTestId('field');
    const box = (await field.boundingBox())!;
    await field.click({ position: { x: box.width * 0.25, y: box.height * 0.2 } });
    const s = await S(page);
    expect(Math.abs(s.x - 0.25)).toBeLessThan(2 / box.width);
    expect(Math.abs(s.y - 0.2)).toBeLessThan(2 / box.height);
    expect(s.freq).toBeCloseTo(110 * Math.pow(2, 3 * s.x), 9);
    expect(s.gain).toBeCloseTo(1 - s.y, 12);
    await expect(page.getByTestId('volume')).toHaveText(`${Math.round((1 - s.y) * 100)}%`);
    await expect(field).toBeFocused();
    expect(s.playing).toBe(false);                                                  // lifting the pointer stops the note
    // up and down arrows change only the volume
    await page.keyboard.press('ArrowUp');
    const t = await S(page);
    expect(t.y).toBeCloseTo(s.y - 0.02, 9);
    expect(t.freq).toBe(s.freq);
    await moveTo(page, 0.5, 1);
    await expect(page.getByTestId('volume')).toHaveText('0%');
    await moveTo(page, 0.5, 0);
    await expect(page.getByTestId('volume')).toHaveText('100%');
  });

  test('chromatic snapping lands on 12-TET frequencies: A4 is 440 Hz, C4 261.63 Hz', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('scale').selectOption('chromatic');
    await moveTo(page, xFor(450));                                                  // +39 ¢ above A4
    let s = await S(page);
    expect(s.freq).toBe(440);
    await expect(page.getByTestId('note')).toHaveText('A4');
    await expect(page.getByTestId('freq')).toHaveText('440.00 Hz');
    await expect(page.getByTestId('cents')).toHaveText('±0 ¢');
    await expect(page.getByTestId('snap-line')).toHaveCount(1);
    await moveTo(page, xFor(255));
    await expect(page.getByTestId('freq')).toHaveText('261.63 Hz');                 // published C4
    await expect(page.getByTestId('note')).toHaveText('C4');
    // a sweep of 60 positions against the oracle
    for (let i = 0; i <= 60; i++) {
      const x = (i + 0.37) / 61;
      await moveTo(page, x);
      s = await S(page);
      const want = snap(110 * Math.pow(2, 3 * x), PCS.chromatic);
      expect(Math.abs(s.freq - want)).toBeLessThan(1e-9);
    }
  });

  test('major, pentatonic and blues snap to the right notes of the chosen key', async ({ page }) => {
    await page.goto(URL);
    const at = async (f: number) => { await moveTo(page, xFor(f)); return S(page); };
    await page.getByTestId('scale').selectOption('major');                          // C major by default
    expect((await at(hz(61) * Math.pow(2, -20 / 1200))).freq).toBeCloseTo(261.6256, 3);   // C♯4 − 20 ¢ → C4
    expect((await at(hz(66) * Math.pow(2, 15 / 1200))).freq).toBeCloseTo(392.0, 1);       // F♯4 + 15 ¢ → G4
    await page.getByTestId('scale').selectOption('pentatonic');
    let s = await at(349.23);                                                       // F4 is not in C pentatonic → E4
    expect(s.freq).toBeCloseTo(329.63, 2);
    await expect(page.getByTestId('note')).toHaveText('E4');
    await page.getByTestId('scale').selectOption('blues');
    await page.getByTestId('root').selectOption('9');                               // A blues: A C D D♯ E G
    s = await at(493.88);                                                           // B4 → C5, a semitone up beats a tone down
    expect(s.freq).toBeCloseTo(523.25, 2);
    await expect(page.getByTestId('note')).toHaveText('C5');
    // sweep every scale in two keys against the oracle
    for (const scale of ['major', 'pentatonic', 'blues']) {
      await page.getByTestId('scale').selectOption(scale);
      for (const root of [0, 7]) {
        await page.getByTestId('root').selectOption(String(root));
        for (let i = 0; i < 25; i++) {
          const x = (i + 0.61) / 25;
          await moveTo(page, x);
          const got = (await S(page)).freq;
          expect(Math.abs(got - snap(110 * Math.pow(2, 3 * x), inKey(scale, root)))).toBeLessThan(1e-9);
          expect(inKey(scale, root)).toContain(((Math.round(midi(got)) % 12) + 12) % 12);
        }
      }
    }
  });

  test('note name and cents offset readout (unsnapped)', async ({ page }) => {
    await page.goto(URL);
    const check = async (f: number, name: string, cents: string) => {
      await moveTo(page, xFor(f));
      await expect(page.getByTestId('note')).toHaveText(name);
      await expect(page.getByTestId('cents')).toHaveText(cents);
    };
    await check(445, 'A4', '+20 ¢');                                                // 1200·log2(445/440) = 19.6
    await check(430, 'A4', '−40 ¢');                                                // −39.8
    await check(261.63, 'C4', '±0 ¢');
    await check(466.16 * Math.pow(2, 49 / 1200), 'A♯4', '+49 ¢');
    await check(329.63 * Math.pow(2, -12 / 1200), 'E4', '−12 ¢');
    await check(110 * Math.pow(2, 1 / 1200) , 'A2', '+1 ¢');
    // the octave number changes at C, not at A
    await check(246.94, 'B3', '±0 ¢');
    await check(261.63 * Math.pow(2, 3 / 1200), 'C4', '+3 ¢');
    const s = await S(page);
    expect(s.midi).toBe(60);
    expect(NAMES[s.midi % 12] + (Math.floor(s.midi / 12) - 1)).toBe('C4');
  });

  test('no AudioContext: the keyboard still plays the readouts and the page says why it is silent', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await noAudio(page);
    const field = page.getByTestId('field');
    await field.focus();
    await page.keyboard.press('Space');
    let s = await S(page);
    expect(s.audio).toBe('unavailable');
    expect(s.playing).toBe(true);
    await expect(page.getByTestId('status')).toContainText('Web Audio is not available');
    await expect(page.getByTestId('hold')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('End');
    await expect(page.getByTestId('freq')).toHaveText('880.00 Hz');
    expect(await page.evaluate(() => (window as any).__theremin.node())).toBeNull();
    await page.keyboard.press('Escape');
    s = await S(page);
    expect(s.playing).toBe(false);
    await expect(page.getByTestId('hold')).toHaveText('Sound on');
    // pointer play works too
    const box = (await field.boundingBox())!;
    await field.click({ position: { x: box.width / 2, y: box.height / 2 } });
    expect((await S(page)).x).toBeCloseTo(0.5, 1);
    expect(errors).toEqual([]);
  });

  test('real Web Audio: silent until a gesture, then the oscillator follows the hand', async ({ page }) => {
    await page.goto(URL);
    await moveTo(page, 0.2);
    expect((await S(page)).audio).toBe('none');                                    // moving makes no sound
    expect(await page.evaluate(() => (window as any).__theremin.node())).toBeNull();
    await page.getByTestId('hold').click();
    await expect.poll(async () => (await S(page)).audio).toBe('running');
    await expect(page.getByTestId('hold')).toHaveAttribute('aria-pressed', 'true');
    const node = () => page.evaluate(() => (window as any).__theremin.node());
    await expect.poll(async () => Math.abs((await node()).freq - (await S(page)).freq)).toBeLessThan(0.5);
    await page.getByTestId('field').focus();
    await page.keyboard.press('End');
    await expect.poll(async () => (await node()).freq).toBeGreaterThan(879.5);
    await expect.poll(async () => (await node()).gain).toBeGreaterThan(0.1);        // 0.65 · 0.28 master
    await page.getByTestId('wave').selectOption('sawtooth');
    await expect.poll(async () => (await node()).type).toBe('sawtooth');
    await page.getByTestId('vdepth').evaluate((el: HTMLInputElement) => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.getByTestId('vdepth-out')).toHaveText('30 ¢');
    await expect.poll(async () => (await node()).depth).toBeGreaterThan(29.5);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await node()).gain).toBeLessThan(0.01);
  });

  test('waveform preview and vibrato controls', async ({ page }) => {
    await page.goto(URL);
    for (const w of ['triangle', 'square', 'sawtooth', 'sine']) {
      await page.getByTestId('wave').selectOption(w);
      await expect(page.getByTestId('wave-preview').locator('polyline')).toHaveAttribute('data-wave', w);
      await expect(page.getByTestId('wave-preview')).toHaveAttribute('aria-label', `${w} wave, two cycles`);
    }
    // a square wave only takes the two extreme values
    await page.getByTestId('wave').selectOption('square');
    const ys = await page.getByTestId('wave-preview').locator('polyline').evaluate((p) => [...new Set(p.getAttribute('points')!.split(' ').map((q) => q.split(',')[1]))]);
    expect(ys.sort()).toEqual(['52.0', '8.0']);
    await expect(page.getByTestId('vdepth-out')).toHaveText('0 ¢ (off)');
    await page.getByTestId('vrate').evaluate((el: HTMLInputElement) => { el.value = '7'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.getByTestId('vrate-out')).toHaveText('7 Hz');
    expect((await S(page)).vibRate).toBe(7);
    // vibrato never changes the readout: it wobbles around the note
    await moveTo(page, xFor(440));
    await page.getByTestId('vdepth').evaluate((el: HTMLInputElement) => { el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.getByTestId('note')).toHaveText('A4');
    expect((await S(page)).freq).toBeCloseTo(440, 9);
  });

  test('keyboard and focus: Space and Enter toggle, Escape stops, arrows clamp at the edges', async ({ page }) => {
    await noAudio(page);
    const field = page.getByTestId('field');
    await expect(field).toHaveAttribute('tabindex', '0');
    await expect(field).toHaveAttribute('aria-roledescription', 'theremin field');
    await field.focus();
    await page.keyboard.press('Enter');
    expect((await S(page)).playing).toBe(true);
    await expect(page.getByTestId('hand')).toHaveAttribute('r', '26');
    await page.keyboard.press('Enter');
    expect((await S(page)).playing).toBe(false);
    await expect(page.getByTestId('hand')).toHaveAttribute('r', '18');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    expect((await S(page)).x).toBe(0);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowUp');
    expect((await S(page)).y).toBe(0);
    await expect(page.getByTestId('volume')).toHaveText('100%');
    await page.keyboard.press('Shift+ArrowDown');
    expect((await S(page)).y).toBeCloseTo(0.2, 9);
    await expect(page.getByTestId('readout')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('status')).toHaveAttribute('role', 'status');
  });
});
