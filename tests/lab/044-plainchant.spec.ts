import { test, expect } from '@playwright/test';

const URL = '/lab/044-plainchant.html?seed=5';

// final and reciting tone (tenor) of the eight church modes
const MODE_FACTS: Array<[string, string, string, string]> = [
  ['I', 'Dorian', 'D', 'A'], ['II', 'Hypodorian', 'D', 'F'], ['III', 'Phrygian', 'E', 'C'], ['IV', 'Hypophrygian', 'E', 'A'],
  ['V', 'Lydian', 'F', 'C'], ['VI', 'Hypolydian', 'F', 'A'], ['VII', 'Mixolydian', 'G', 'D'], ['VIII', 'Hypomixolydian', 'G', 'C'],
];

test.describe('044 Plainchant', () => {
  test('each of the eight modes shows the correct final and tenor', async ({ page }) => {
    await page.goto(URL);
    for (let i = 0; i < 8; i++) {
      const [n, name, fin, ten] = MODE_FACTS[i];
      await page.getByTestId(`mode-${i + 1}`).click();
      await expect(page.getByTestId(`mode-${i + 1}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('mode-title')).toContainText(`Mode ${n}`);
      await expect(page.getByTestId('mode-title')).toContainText(name);
      await expect(page.getByTestId('final')).toHaveText(fin);
      await expect(page.getByTestId('tenor')).toHaveText(ten);
      await expect(page.getByTestId('mode-table').locator('tbody tr').nth(i)).toHaveText(`${n}${name}${fin}${ten}`);
    }
    // authentic modes are odd-numbered, plagal ones even
    await expect(page.getByTestId('mode-title')).toContainText('plagal');
    await page.getByTestId('mode-7').click();
    await expect(page.getByTestId('mode-title')).toContainText('authentic');
  });

  test('composed melodies obey the mode: range, stepwise motion, recitation on the tenor, cadence on the final', async ({ page }) => {
    await page.goto(URL);
    const report = await page.evaluate(() => {
      const C = (window as any).__chant;
      const out: any[] = [];
      for (let m = 0; m < 8; m++) for (let t = 0; t < 6; t++) for (const s of [1, 2, 3, 42, 99]) {
        const M = C.MODES[m];
        const syl = C.compose(m, t, s).syl;
        const notes: number[] = syl.flatMap((x: any) => x.notes);
        const iv = notes.slice(1).map((d, i) => Math.abs(d - notes[i]));
        const counts: Record<number, number> = {};
        notes.forEach((d) => { counts[d] = (counts[d] || 0) + 1; });
        const most = Math.max(...Object.values(counts));
        out.push({
          m, t, s, long: syl.length >= 14,
          inRange: notes.every((d) => d >= M.lo && d <= M.hi),
          endsOnFinal: notes[notes.length - 1] === M.f,
          startsNearFinal: Math.abs(notes[0] - M.f) <= 1,
          maxLeap: Math.max(...iv),
          stepShare: iv.filter((x) => x <= 1).length / iv.length,
          tenorMost: counts[M.t] === most,
          hasTenor: notes.includes(M.t),
        });
      }
      return out;
    });
    expect(report).toHaveLength(8 * 6 * 5);
    for (const r of report) {
      const where = `mode ${r.m + 1}, text ${r.t}, seed ${r.s}`;
      expect(r.inRange, where).toBe(true);
      expect(r.endsOnFinal, where).toBe(true);
      expect(r.startsNearFinal, where).toBe(true);
      expect(r.maxLeap, where).toBeLessThanOrEqual(2);
      expect(r.stepShare, where).toBeGreaterThanOrEqual(0.85);
      expect(r.hasTenor, where).toBe(true);
      // in a verse long enough to recite, the tenor is the most frequent pitch
      if (r.long) expect(r.tenorMost, where).toBe(true);
    }
    // same seed, same chant
    const same = await page.evaluate(() => {
      const C = (window as any).__chant;
      return JSON.stringify(C.compose(2, 1, 7)) === JSON.stringify(C.compose(2, 1, 7)) && JSON.stringify(C.compose(2, 1, 7)) !== JSON.stringify(C.compose(2, 1, 8));
    });
    expect(same).toBe(true);
  });

  test('the staff: the chosen clef keeps every mode on the staff, and the first verse is pre-inked faintly', async ({ page }) => {
    await page.goto(URL);
    const pos = await page.evaluate(() => [0, 1, 2, 3, 4, 5, 6, 7].map((m) => (window as any).__chant.positions(m)));
    for (const [lo, hi] of pos) { expect(lo).toBeGreaterThanOrEqual(-2); expect(hi).toBeLessThanOrEqual(8); }
    const noteCount = await page.evaluate(() => (window as any).__chant.phrases[0].syl.reduce((a: number, s: any) => a + s.notes.length, 0));
    await expect(page.getByTestId('score').locator('rect[data-note]')).toHaveCount(noteCount);
    await expect(page.getByTestId('latin')).toHaveText('Laudate Dominum ✱ in sanctis eius.');
    await expect(page.getByTestId('english')).toHaveText('Praise ye the Lord in his holy places:');
    // nothing is inked before the chant begins
    const inked = await page.getByTestId('score').locator('rect[data-note][opacity="1"]').count();
    expect(inked).toBe(0);
    // the same seed composes the same first verse
    const a = await page.evaluate(() => JSON.stringify((window as any).__chant.phrases));
    await page.reload();
    expect(await page.evaluate(() => JSON.stringify((window as any).__chant.phrases))).toBe(a);
    await page.getByTestId('mode-4').click();
    expect(await page.evaluate(() => (window as any).__chant.phrases[0].mode)).toBe(3);
  });

  test('audio waits for a gesture, sings and inks notes, follows the mode with the drone, and mutes', async ({ page }) => {
    await page.goto(URL);
    const c = () => page.evaluate(() => { const x = (window as any).__chant; return { started: x.started, playing: x.playing, scheduled: x.scheduled, sung: x.sung, gain: x.masterGain, drone: x.droneHz, muted: x.muted }; });
    expect((await c()).started).toBe(false);
    await expect(page.getByTestId('mute')).toBeHidden();
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveText('Pause');
    await expect(page.getByTestId('status')).toHaveText('Singing in Mode I.');
    expect((await c()).started).toBe(true);
    await expect.poll(async () => (await c()).scheduled, { timeout: 5000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await c()).sung, { timeout: 8000 }).toBeGreaterThan(3);
    await expect(page.getByTestId('counter')).toHaveText(/^\d+ notes sung$/);
    await expect.poll(() => page.getByTestId('score').locator('rect[data-note][opacity="1"]').count(), { timeout: 5000 }).toBeGreaterThan(2);
    // drone sits an octave below the final: D2 ≈ 73.4 Hz in Mode I, G2 ≈ 98 Hz in Mode VII
    expect((await c()).drone).toBeCloseTo(73.42, 0);
    await page.getByTestId('mode-7').click();
    await expect(page.getByTestId('status')).toHaveText('Mode VII begins with the next verse.');
    await expect.poll(async () => (await c()).drone, { timeout: 8000 }).toBeGreaterThan(97.5);

    await page.getByTestId('mute').click();
    await expect(page.getByTestId('mute')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await c()).gain, { timeout: 5000 }).toBeLessThan(0.01);
    await page.getByTestId('mute').click();
    await expect.poll(async () => (await c()).gain, { timeout: 5000 }).toBeGreaterThan(0.8);
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveText('Resume');
    expect((await c()).playing).toBe(false);
  });
});
