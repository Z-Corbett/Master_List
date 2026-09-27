import { test, expect, Page } from '@playwright/test';

const URL = '/lab/144-deep-ellum-blues.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__blues.state);
const SONG = (page: Page) => page.evaluate(() => (window as any).__blues.song);
const LOG = (page: Page) => page.evaluate(() => (window as any).__blues.log);
const compose = (page: Page, o: any, seed: number) => page.evaluate(([o, s]) => (window as any).__blues.compose(o, s), [o, seed] as const);

// Independent music theory for the oracles.
const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const usesFlats = (k: string) => k.includes('b') || k === 'F';
/** The 12-bar in roman numerals, then spelled as dominant sevenths in the key. */
function twelveBar(key: string, variant: 'slow' | 'quick') {
  const form = variant === 'slow'
    ? ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V']
    : ['I', 'IV', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'];
  const root = KEYS.indexOf(key), semis: Record<string, number> = { I: 0, IV: 5, V: 7 };
  return form.map((rn) => (usesFlats(key) ? FLATS : SHARPS)[(root + semis[rn]) % 12] + '7');
}
const pcOf = (name: string) => { const n = name.replace('7', ''); const i = SHARPS.indexOf(n); return i >= 0 ? i : FLATS.indexOf(n); };
const bluesScale = (key: string) => [0, 3, 5, 6, 7, 10].map((i) => (KEYS.indexOf(key) + i) % 12);
const dom7 = (rootPc: number) => [0, 4, 7, 10].map((i) => (rootPc + i) % 12);
const frac = (x: number) => x - Math.floor(x);

test.describe('144 Deep Ellum Blues', () => {
  test('the chart in A is A7 ×4, D7 D7, A7 A7, E7 D7 A7 E7; quick change puts D7 in bar 2', async ({ page }) => {
    await page.goto(URL);
    const bars = page.locator('#chart .bar');
    await expect(bars).toHaveCount(12);
    expect(await bars.evaluateAll((els) => els.map((e) => e.getAttribute('data-chord')))).toEqual(
      ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7']);
    await expect(page.getByTestId('bar-11')).toContainText('V7');                 // the turnaround
    await page.getByTestId('variant').selectOption('quick');
    expect(await bars.evaluateAll((els) => els.map((e) => e.getAttribute('data-chord')))).toEqual(twelveBar('A', 'quick'));
    await expect(page.getByTestId('bar-1')).toHaveAttribute('data-chord', 'D7');
    await page.getByTestId('key').selectOption('Bb');
    expect(await bars.evaluateAll((els) => els.map((e) => e.getAttribute('data-chord')))).toEqual(twelveBar('Bb', 'quick'));
    await expect(page.getByTestId('status')).toHaveText('12-bar in Bb: Bb7, Eb7, F7; quick change, walking bass.');
  });

  test('every key and both variants spell the progression correctly', async ({ page }) => {
    await page.goto(URL);
    for (const key of KEYS) {
      for (const variant of ['slow', 'quick'] as const) {
        const song = await compose(page, { key, variant }, 7);
        expect(song.chords.map((c: any) => c.name), `${key} ${variant}`).toEqual(twelveBar(key, variant));
        song.chords.forEach((c: any) => expect(c.root).toBe(pcOf(c.name)));
      }
    }
    expect((await compose(page, { key: 'E', variant: 'slow' }, 1)).chords.map((c: any) => c.name).slice(8)).toEqual(['B7', 'A7', 'E7', 'B7']);
    expect((await compose(page, { key: 'F#', variant: 'slow' }, 1)).chords[4].name).toBe('B7');
  });

  test('shuffle puts every off-beat at 2/3 of the beat (2:1); straight at 1/2', async ({ page }) => {
    await page.goto(URL);
    let song = await SONG(page);
    expect(song.swing).toBeCloseTo(2 / 3, 12);
    const offs = song.events.filter((e: any) => e.sub === 1);
    expect(offs.length).toBeGreaterThan(20);
    offs.forEach((e: any) => {
      expect(e.tb).toBeCloseTo(e.bar * 4 + e.beat + 2 / 3, 9);
      expect(frac(e.tb)).toBeCloseTo(2 / 3, 9);
    });
    song.events.filter((e: any) => e.sub === 0).forEach((e: any) => expect(e.tb).toBe(e.bar * 4 + e.beat));
    // boogie bass: long–short pairs, the long note twice the short one
    await page.getByTestId('bass').selectOption('boogie');
    song = await SONG(page);
    const b = song.events.filter((e: any) => e.voice === 'bass' && e.bar === 0);
    expect(b).toHaveLength(8);
    expect(b[1].tb - b[0].tb).toBeCloseTo(2 / 3, 9);
    expect(b[2].tb - b[1].tb).toBeCloseTo(1 / 3, 9);
    await page.getByTestId('feel').selectOption('straight');
    song = await SONG(page);
    song.events.filter((e: any) => e.sub === 1).forEach((e: any) => expect(frac(e.tb)).toBeCloseTo(0.5, 9));
  });

  test('every solo note is on the blues scale of its key, across keys and seeds', async ({ page }) => {
    await page.goto(URL);
    for (const key of ['A', 'E', 'Bb', 'C', 'F#']) {
      for (const seed of [1, 7, 42, 1927]) {
        const song = await compose(page, { key }, seed);
        const mel = song.events.filter((e: any) => e.voice === 'melody');
        expect(mel.length).toBeGreaterThan(20);
        const scale = bluesScale(key);
        mel.forEach((e: any) => expect(scale, `${key} seed ${seed} midi ${e.midi}`).toContain(e.midi % 12));
        expect(song.scalePcs.slice().sort((a: number, b: number) => a - b)).toEqual(scale.slice().sort((a, b) => a - b));
      }
    }
    // in A the scale is A C D E♭ E G: pitch classes 9 0 2 3 4 7
    expect(bluesScale('A').slice().sort((a, b) => a - b)).toEqual([0, 2, 3, 4, 7, 9]);
  });

  test('strong beats (1 and 3) land on chord tones of the current chord', async ({ page }) => {
    await page.goto(URL);
    let checked = 0;
    for (const key of ['A', 'G', 'Eb']) {
      for (const variant of ['slow', 'quick'] as const) {
        for (const seed of [3, 7, 99]) {
          const song = await compose(page, { key, variant }, seed);
          const chart = twelveBar(key, variant);
          const strong = song.events.filter((e: any) => e.voice === 'melody' && e.sub === 0 && (e.beat === 0 || e.beat === 2));
          expect(strong.length).toBeGreaterThanOrEqual(12);                     // every bar opens with a note
          for (const e of strong) {
            expect(dom7(pcOf(chart[e.bar])), `${key} ${variant} bar ${e.bar + 1}`).toContain(e.midi % 12);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
    // the piano roll draws the same solo
    const rects = await page.locator('#roll rect[data-midi]').count();
    expect(rects).toBe((await SONG(page)).events.filter((e: any) => e.voice === 'melody').length);
  });

  test('bass lines: walking quarters start each bar on the root; boogie plays 1-3-5-6-♭7-6-5-3', async ({ page }) => {
    await page.goto(URL);
    let song = await SONG(page);
    const chart = twelveBar('A', 'slow');
    for (let bar = 0; bar < 12; bar++) {
      const b = song.events.filter((e: any) => e.voice === 'bass' && e.bar === bar);
      expect(b.map((e: any) => e.beat)).toEqual([0, 1, 2, 3]);
      expect(b.every((e: any) => e.sub === 0)).toBe(true);
      expect(b[0].midi % 12).toBe(pcOf(chart[bar]));
    }
    await page.getByTestId('bass').selectOption('boogie');
    song = await SONG(page);
    for (let bar = 0; bar < 12; bar++) {
      const b = song.events.filter((e: any) => e.voice === 'bass' && e.bar === bar);
      expect(b.map((e: any) => e.midi - b[0].midi)).toEqual([0, 4, 7, 9, 10, 9, 7, 4]);
      expect(b[0].midi % 12).toBe(pcOf(chart[bar]));
    }
  });

  test('solos are seeded: same seed, same solo; New solo changes it and the URL', async ({ page }) => {
    await page.goto(URL);
    const a = await SONG(page);
    expect(a.seed).toBe(7);
    await expect(page.getByTestId('seed')).toHaveText('solo seed 7');
    expect((await compose(page, {}, 7)).events).toEqual(a.events);
    const other = await compose(page, {}, 8);
    expect(other.events.filter((e: any) => e.voice === 'melody')).not.toEqual(a.events.filter((e: any) => e.voice === 'melody'));
    await page.getByTestId('new-solo').click();
    const s = await S(page);
    expect(s.seed).not.toBe(7);
    await expect(page).toHaveURL(new RegExp(`seed=${s.seed}$`));
    const b = await SONG(page);
    await page.reload();
    expect((await SONG(page)).events).toEqual(b.events);                        // the link reproduces the solo
    await page.goto(URL);
    expect((await SONG(page)).events).toEqual(a.events);
  });

  test('no Web Audio: plays silently under page.clock with every note on the shuffle grid', async ({ page }) => {
    await page.addInitScript(() => { (window as any).AudioContext = undefined; (window as any).webkitAudioContext = undefined; });
    await page.clock.install({ time: new Date('2026-09-26T21:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-26T21:00:02Z'));
    await page.getByTestId('bpm').fill('90');
    await page.getByTestId('bpm').press('Enter');
    await page.getByTestId('play').click();
    await expect(page.getByTestId('status')).toContainText('Web Audio is not available');
    await page.clock.runFor(3000);
    const beat = 60 / 90;
    const { START_DELAY, LOOKAHEAD } = await page.evaluate(() => (window as any).__blues);
    const log = await LOG(page);
    expect(log.length).toBeGreaterThan(10);
    log.forEach((e: any) => {
      expect(e.t).toBeCloseTo(e.tb * beat, 9);
      expect(e.sounded).toBe(false);
      if (e.sub === 1) expect(e.t / beat - e.bar * 4 - e.beat).toBeCloseTo(2 / 3, 8);   // offbeat at 2/3 of the beat (log times are rounded to 1 ns)
    });
    expect(log[log.length - 1].t).toBeLessThan(3 - START_DELAY + LOOKAHEAD);
    // 2.95 s at 90 BPM = 4.43 beats: bar 2 (index 1) is lit
    const s = await S(page);
    expect(s).toMatchObject({ playing: true, clock: 'silent', audio: 'unavailable', bar: 1 });
    await expect(page.getByTestId('bar-1')).toHaveClass(/now/);
    await page.clock.runFor(29000);                                               // 48 beats = 32 s: round the top
    const later = await LOG(page);
    expect(later.some((e: any) => e.chorus === 1 && e.bar === 0)).toBe(true);
    later.filter((e: any) => e.chorus === 1).forEach((e: any) => expect(e.t).toBeCloseTo((48 + e.tb) * beat, 9));
    await page.getByTestId('play').click();
    await expect(page.locator('#chart .bar.now')).toHaveCount(0);
    const n = (await LOG(page)).length;
    await page.clock.runFor(2000);
    expect((await LOG(page)).length).toBe(n);
  });

  test('real Web Audio is gesture-gated: no context until Play, then notes sound', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('key').selectOption('E');
    await page.getByTestId('new-solo').click();
    expect((await S(page)).audio).toBe('none');
    await page.getByTestId('play').click();
    await expect.poll(async () => (await S(page)).audio).toBe('running');
    // the real audio clock is outside page.clock and runs slow on a loaded machine: poll generously, ask for a few notes
    await expect.poll(async () => (await S(page)).sounded, { timeout: 20_000 }).toBeGreaterThan(2);
    expect((await LOG(page)).some((e: any) => e.sounded)).toBe(true);
    await expect(page.getByTestId('status')).toContainText('Playing a 12-bar in E');
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'false');
  });

  test('controls are labelled and the chart and roll describe themselves', async ({ page }) => {
    await page.goto(URL);
    for (const name of ['Key', 'Changes', 'Bass line', 'Feel', 'Tempo (BPM)']) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    await expect(page.getByTestId('bar-4')).toHaveAttribute('aria-label', 'Bar 5: D7, IV');
    await expect(page.locator('#roll svg')).toHaveCount(3);
    await expect(page.locator('#roll svg').first()).toHaveAttribute('aria-label', /^Bars 1 to 4 \(A7, A7, A7, A7\): \d+ solo notes$/);
    await expect(page.getByText('Blind Lemon Jefferson performed there in the 1920s')).toBeVisible();
    await page.getByTestId('play').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('play')).toHaveText('Play');
  });
});
