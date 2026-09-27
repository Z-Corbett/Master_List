import { test, expect, Page } from '@playwright/test';

const URL = '/lab/126-plucked-string.html';
const S = (page: Page) => page.evaluate(() => (window as any).__pluck.state);
type KS = { N: number; f0: number; sampleRate: number; samples: number[] };
const KSrun = (page: Page, o: Record<string, number>) => page.evaluate((o) => (window as any).__pluck.ks(o), o) as Promise<KS>;

// Independent oracles, written here rather than read from the page.
// Equal temperament: piano key n sounds 440 · 2^((n − 49)/12) Hz (A4 = key 49).
const et = (n: number) => 440 * Math.pow(2, (n - 49) / 12);
const STANDARD = [['E2', 20, 82.41], ['A2', 25, 110.0], ['D3', 30, 146.83], ['G3', 35, 196.0], ['B3', 39, 246.94], ['E4', 44, 329.63]] as const;
/** Hann-windowed DFT magnitudes, straight from the definition. */
function dft(x: number[], sr: number, start: number, len: number, maxHz: number) {
  const bin = sr / len, mag: number[] = [];
  const cos = Array.from({ length: len }, (_, i) => Math.cos((2 * Math.PI * i) / len));
  const sin = Array.from({ length: len }, (_, i) => Math.sin((2 * Math.PI * i) / len));
  const wx = Array.from({ length: len }, (_, n) => 0.5 * (1 - Math.cos((2 * Math.PI * n) / (len - 1))) * x[start + n]);
  for (let k = 0; k * bin < maxHz; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < len; n++) { const j = (k * n) % len; re += wx[n] * cos[j]; im -= wx[n] * sin[j]; }
    mag.push(Math.hypot(re, im));
  }
  return { mag, bin };
}
/** Fundamental = the lowest local maximum at least 10% of the strongest peak (above 50 Hz). */
function lowestPeak(mag: number[], bin: number) {
  const g = Math.max(...mag.slice(1));
  for (let k = Math.round(50 / bin); k < mag.length - 1; k++) if (mag[k] >= 0.1 * g && mag[k] >= mag[k - 1] && mag[k] >= mag[k + 1]) return k * bin;
  return NaN;
}
const rmsWindows = (x: number[], W: number) => {
  const out: number[] = [];
  for (let s = 0; s + W <= x.length; s += W) { let q = 0; for (let i = s; i < s + W; i++) q += x[i] * x[i]; out.push(Math.sqrt(q / W)); }
  return out;
};

async function noAudio(page: Page, url = URL) {
  await page.addInitScript(() => { (window as any).AudioContext = undefined; (window as any).webkitAudioContext = undefined; });
  await page.goto(url);
}

test.describe('126 Plucked String', () => {
  test('standard tuning matches equal temperament from A4 = 440 Hz', async ({ page }) => {
    await page.goto(URL);
    const strings = await page.evaluate(() => (window as any).__pluck.STRINGS);
    expect(strings.map((s: any) => s.note)).toEqual(STANDARD.map((s) => s[0]));
    STANDARD.forEach(([, key, hz], i) => {
      expect(strings[i].hz).toBeCloseTo(hz, 2);
      expect(Math.abs(et(key) - hz)).toBeLessThan(0.005);                 // the published values round the ET frequency
      expect(Math.abs(strings[i].hz - et(key))).toBeLessThan(0.005);
      expect(strings[i].num).toBe(6 - i);
    });
    expect(et(25)).toBe(110);                                              // A2 is exactly two octaves below A4
    await expect(page.getByTestId('tune-1')).toContainText('329.63');
    await expect(page.getByTestId('tune-6')).toContainText('82.41');
    await expect(page.locator('[data-testid^="string-"]')).toHaveCount(6);
  });

  test('delay line: N = round(sr/f − ½), and every output sample obeys y[n] = ρ·½(y[n−N] + y[n−N−1])', async ({ page }) => {
    await page.goto(URL);
    for (const [sr, f] of [[8000, 82.41], [8000, 329.63], [8000, 440], [44100, 110], [48000, 196], [22050, 1000]]) {
      const N = await page.evaluate(([f, sr]) => (window as any).__pluck.delayLength(f, sr), [f, sr]);
      expect(N).toBe(Math.round(sr / f - 0.5));
      expect(Math.abs(N + 0.5 - sr / f)).toBeLessThanOrEqual(0.5);        // the loop is N + ½ samples, within half a sample of sr/f
    }
    const rho = 0.995;
    const r = await KSrun(page, { freq: 196, sampleRate: 8000, seconds: 0.5, decay: rho, brightness: 0.8, seed: 7 });
    expect(r.N).toBe(Math.round(8000 / 196 - 0.5));                       // 40.3 → 40
    expect(r.samples).toHaveLength(4000);
    expect(r.f0).toBeCloseTo(8000 / 40.5, 9);
    // the first N samples are the excitation: zero mean, peak exactly 1
    const burst = r.samples.slice(0, r.N);
    expect(Math.abs(burst.reduce((a, b) => a + b, 0) / r.N)).toBeLessThan(1e-6);
    expect(Math.max(...burst.map(Math.abs))).toBeCloseTo(1, 6);
    // after that, the Karplus–Strong recurrence holds sample by sample (float32 rounding only)
    const y = r.samples;
    expect(y[r.N]).toBeCloseTo(rho * 0.5 * y[0], 6);                      // y[−1] is zero
    for (let n = r.N + 1; n < y.length; n++) expect(Math.abs(y[n] - rho * 0.5 * (y[n - r.N] + y[n - r.N - 1]))).toBeLessThan(1e-6);
  });

  test('fundamental from a DFT computed in the test sits within one bin of sr/(N + ½) for all six strings', async ({ page }) => {
    await page.goto(URL);
    const sr = 8000, start = 1600, len = 2048;                             // 3.91 Hz bins
    for (const [note, key] of STANDARD) {
      for (const brightness of [0.3, 1]) {
        const r = await KSrun(page, { freq: et(key), sampleRate: sr, seconds: 0.5, decay: 0.996, brightness, seed: 7 });
        const { mag, bin } = dft(r.samples, sr, start, len, 1700);
        const peak = lowestPeak(mag, bin), expected = sr / (r.N + 0.5);
        expect(Math.abs(peak - expected), `${note} b=${brightness}`).toBeLessThanOrEqual(bin);
        // rounding N costs at most half a sample of loop length: the pitch error in cents is bounded by that
        const worst = 1200 * Math.log2((sr / et(key) + 0.5) / (sr / et(key)));
        expect(Math.abs(1200 * Math.log2(expected / et(key)))).toBeLessThanOrEqual(worst + 1e-9);
        // the page's own detector agrees with the test's
        const pagePeak = await page.evaluate(([x, sr, start, len]) => (window as any).__pluck.fundamentalOf(x, sr, start, len), [r.samples, sr, start, len] as any);
        expect(Math.abs(pagePeak.hz - peak)).toBeLessThanOrEqual(bin);
      }
    }
  });

  test('the envelope decays monotonically, and a higher loop gain sustains longer', async ({ page }) => {
    await page.goto(URL);
    for (const [, key] of STANDARD) {
      const r = await KSrun(page, { freq: et(key), sampleRate: 8000, seconds: 1.5, decay: 0.996, brightness: 0.6, seed: 7 });
      const env = rmsWindows(r.samples, 2 * r.N);                          // RMS over two periods at a time
      expect(env.length).toBeGreaterThan(10);
      for (let i = 1; i < env.length; i++) expect(env[i], `window ${i}`).toBeLessThan(env[i - 1]);
      // no partial outlives the fundamental, which keeps ρ·cos(π f0/sr) of its amplitude per period
      const f0 = 8000 / (r.N + 0.5), periods = ((env.length - 1) * 2 * r.N) / (r.N + 0.5);
      expect(env[env.length - 1] / env[0]).toBeLessThan(1.05 * Math.pow(0.996 * Math.cos((Math.PI * f0) / 8000), periods));
    }
    const tail = async (decay: number) => {
      const r = await KSrun(page, { freq: 110, sampleRate: 8000, seconds: 1.5, decay, brightness: 0.6, seed: 7 });
      return rmsWindows(r.samples.slice(-800), 800)[0];
    };
    const [lo, mid, hi] = [await tail(0.99), await tail(0.996), await tail(0.9995)];
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
    // even with ρ = 1 the energy falls: the two-point average alone damps every partial
    const r1 = await KSrun(page, { freq: 110, sampleRate: 8000, seconds: 1, decay: 1, brightness: 1, seed: 7 });
    const e1 = rmsWindows(r1.samples, 2 * r1.N);
    expect(e1[e1.length - 1]).toBeLessThan(e1[0]);
  });

  test('seeded: the same seed gives identical samples, other seeds differ; brightness raises the spectral centroid', async ({ page }) => {
    await page.goto(URL);
    const o = { freq: 146.83, sampleRate: 8000, seconds: 0.3, decay: 0.996, brightness: 0.6 };
    const a = await KSrun(page, { ...o, seed: 7 }), b = await KSrun(page, { ...o, seed: 7 }), c = await KSrun(page, { ...o, seed: 8 });
    expect(a.samples).toEqual(b.samples);
    expect(a.samples).not.toEqual(c.samples);
    const centroid = (x: number[]) => {
      const { mag, bin } = dft(x, 8000, 0, 1024, 4000);
      let num = 0, den = 0; mag.forEach((m, k) => { num += m * k * bin; den += m; });
      return num / den;
    };
    const dull = await KSrun(page, { ...o, brightness: 0.1, seed: 7 }), bright = await KSrun(page, { ...o, brightness: 1, seed: 7 });
    expect(centroid(bright.samples)).toBeGreaterThan(1.3 * centroid(dull.samples));
  });

  test('chords: fretted notes are open string × 2^(fret/12), strummed 28 ms apart from the bass up', async ({ page }) => {
    await noAudio(page, URL + '?seed=7');
    const G = await page.evaluate(() => (window as any).__pluck.chordFreqs('G'));
    // G major, 320003: G2, B2, D3, G3, B3, G4
    [et(23), et(27), et(30), et(35), et(39), et(47)].forEach((f, i) => expect(G[i]).toBeCloseTo(f, 1));
    expect(G[0]).toBeCloseTo(98.0, 1);
    expect(G[5]).toBeCloseTo(392.0, 1);
    const C = await page.evaluate(() => (window as any).__pluck.chordFreqs('C'));
    expect(C[0]).toBeNull();                                               // x32010: low E is muted
    expect(C[1]).toBeCloseTo(130.81, 1);                                   // C3
    expect(C[4]).toBeCloseTo(261.63, 1);                                   // middle C
    await page.getByTestId('chord-G').click();
    await expect(page.getByTestId('chord-G')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status')).toContainText('G chord (320003)');
    let s = await S(page);
    expect(s.last.kind).toBe('chord');
    expect(s.last.notes.map((n: any) => n.string)).toEqual([6, 5, 4, 3, 2, 1]);
    s.last.notes.forEach((n: any, k: number) => {
      expect(n.onset).toBeCloseTo(Math.round(k * 0.028 * 44100) / 44100, 9);
      expect(n.N).toBe(Math.round(44100 / n.freq - 0.5));
    });
    await page.getByTestId('chord-C').click();
    s = await S(page);
    expect(s.last.notes.map((n: any) => n.string)).toEqual([5, 4, 3, 2, 1]);
    expect(s.count).toBe(11);                                              // six strings, then five
    await expect(page.getByTestId('chord-G')).toHaveAttribute('aria-pressed', 'false');
  });

  test('no AudioContext: plucks are still rendered, drawn and described, silently', async ({ page }) => {
    await noAudio(page, URL + '?seed=7');
    await page.getByTestId('string-6').click();
    await expect(page.getByTestId('status')).toHaveText('String 6, E2 82.41 Hz. Web Audio is not available here, so the pluck is drawn but not heard.');
    const s = await S(page);
    expect(s).toMatchObject({ audio: 'unavailable', played: 0, seed: 7, count: 1 });
    const N = Math.round(44100 / 82.41 - 0.5);
    expect(N).toBe(535);
    expect(s.last.notes[0]).toMatchObject({ N, seed: 7 });                // first pluck uses the seed itself
    const f0 = 44100 / (N + 0.5);
    await expect(page.getByTestId('wave-text')).toContainText(`N = 535 samples at 44100 Hz, so the loop is 535.5 samples and the pitch ${f0.toFixed(2)} Hz`);
    // T60 of the fundamental: it loses ρ·cos(π f0/sr) per period (Jaffe & Smith, 1983)
    const t60 = -3 / (f0 * Math.log10(0.996 * Math.cos((Math.PI * f0) / 44100)));
    await expect(page.getByTestId('wave-text')).toContainText(`60 dB in ${t60.toFixed(2)} s`);
    expect(Math.abs(s.last.refinedHz - f0)).toBeLessThanOrEqual(s.last.binHz);
    // the rendered buffer is exactly the pure function's output for that seed
    const pure = await KSrun(page, { freq: 82.41, sampleRate: 44100, seconds: 0.01, decay: 0.996, brightness: 0.6, seed: 7 });
    s.last.head.forEach((v: number, i: number) => expect(v).toBeCloseTo(0.28 * pure.samples[i], 6));
    const cents = 1200 * Math.log2(f0 / 82.41);
    await expect(page.getByTestId('spec-text')).toContainText(`(${cents >= 0 ? '+' : ''}${cents.toFixed(1)} cents)`);
    await expect(page.getByTestId('wave')).toHaveAttribute('aria-label', /Waveform\. String 6/);
  });

  test('real Web Audio: nothing starts before a gesture, then a buffer plays at the context rate', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('decay').focus();
    await page.keyboard.press('ArrowRight');
    expect((await S(page)).audio).toBe('none');                            // moving a slider makes no sound
    await page.getByTestId('string-5').click();
    await expect.poll(async () => (await S(page)).audio).toBe('running');
    await expect.poll(async () => (await S(page)).played).toBeGreaterThanOrEqual(1);
    const rate = await page.evaluate(() => new AudioContext().sampleRate);
    const s = await S(page);
    expect(s.last.sampleRate).toBe(rate);
    expect(s.last.notes[0].N).toBe(Math.round(rate / 110 - 0.5));
    expect(s.last.length).toBe(Math.round(2.5 * rate));
    expect(s.decay).toBeCloseTo(0.9965, 9);
  });

  test('keyboard: digits 1–6 pluck strings 1 (high E) to 6 (low E); buttons work with Enter; digits in a slider are ignored', async ({ page }) => {
    await noAudio(page);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    for (const [key, note] of [['1', 'E4'], ['6', 'E2'], ['3', 'G3']]) {
      await page.keyboard.press(key);
      await expect(page.getByTestId('status')).toContainText(`String ${key}, ${note}`);
    }
    expect((await S(page)).count).toBe(3);
    await page.getByTestId('chord-Am').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status')).toContainText('Am chord (x02210)');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('chord-D')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('chord-D')).toHaveAttribute('aria-pressed', 'true');
    const before = (await S(page)).count;
    await page.getByTestId('bright').focus();
    await page.keyboard.press('2');
    expect((await S(page)).count).toBe(before);
    await expect(page.getByTestId('string-1')).toHaveAttribute('aria-label', 'Pluck string 1, E4, 329.63 hertz');
  });

  test('controls and layout: labelled sliders update readouts; strings fit a phone', async ({ page }) => {
    await noAudio(page);
    await page.getByTestId('bright').evaluate((el: HTMLInputElement) => { el.value = '0.25'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.getByTestId('bright-out')).toHaveText('0.25');
    await page.getByTestId('decay').evaluate((el: HTMLInputElement) => { el.value = '0.9995'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.getByTestId('decay-out')).toHaveText('0.9995');
    await expect(page.getByLabel(/Sustain, loop gain/)).toBeVisible();
    await page.getByTestId('string-4').click();
    expect((await S(page)).last).toMatchObject({ decay: 0.9995, brightness: 0.25 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    for (const n of [1, 6]) {
      const b = (await page.getByTestId(`string-${n}`).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    const wave = (await page.getByTestId('wave').boundingBox())!, spec = (await page.getByTestId('spec').boundingBox())!;
    expect(spec.y).toBeGreaterThan(wave.y + wave.height);                   // panels stack on a phone
  });
});
