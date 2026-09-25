import { test, expect, Page } from '@playwright/test';

const URL = '/lab/115-two-step.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__two.state);

/** Fake clock, paused: nothing moves until the test says so. */
async function open(page: Page, url = URL) {
  await page.clock.install({ time: new Date('2026-09-25T20:00:00Z') });
  await page.goto(url);
  await page.clock.pauseAt(new Date('2026-09-25T20:00:05Z'));
}
/** Advance the fake clock until song time equals ms exactly. */
async function to(page: Page, ms: number) {
  const t = (await S(page)).songTime;
  expect(ms, 'time only runs forward').toBeGreaterThanOrEqual(t);
  if (ms > t) await page.clock.runFor(ms - t);
  expect((await S(page)).songTime).toBeCloseTo(ms, 6);
}
const keyFor = (lane: string) => (lane === 'L' ? 'f' : 'j');
/** The scoring rule, written out independently: base × (1 + ⌊combo before the hit / 10⌋), capped at ×4. */
function expectedScore(kinds: string[]) {
  let score = 0, combo = 0, best = 0;
  for (const k of kinds) {
    if (k === 'miss') { combo = 0; continue; }
    score += (k === 'perfect' ? 300 : 100) * Math.min(4, 1 + Math.floor(combo / 10));
    combo++; best = Math.max(best, combo);
  }
  return { score, combo, best };
}

test.describe('115 Two-Step', () => {
  test('the chart is quick-quick-slow-slow: six counts, quicks one count, slows two, feet alternating', async ({ page }) => {
    await open(page);
    const s = await S(page);
    expect(s.beatMs).toBe(500);                                       // 60 000 ms / 120 BPM
    expect(s.notes).toHaveLength(64);                                  // 16 figures × 4 steps
    s.notes.forEach((n: any, i: number) => {
      const fig = Math.floor(i / 4), k = i % 4;
      expect(n.step).toBe(['Q', 'Q', 'S', 'S'][k]);
      expect(n.len).toBe([1, 1, 2, 2][k]);
      expect(n.beat).toBe(fig * 6 + [0, 1, 2, 4][k]);                 // onsets on counts 1, 2, 3 and 5
      expect(n.count).toBe([1, 2, 3, 5][k]);
      expect(n.lane).toBe(i % 2 ? 'R' : 'L');                         // left, right, left, right …
      expect(n.t).toBe(n.beat * 500);
      if (i < 63) expect(n.beat + n.len).toBe(s.notes[i + 1].beat);   // each step lasts until the next one
    });
    for (let f = 0; f < 16; f++) expect(s.notes.slice(f * 4, f * 4 + 4).reduce((a: number, n: any) => a + n.len, 0)).toBe(6);
    // the same shape at another tempo, with the beat length from the BPM
    const c = await page.evaluate(() => (window as any).__two.chart(7, 150));
    expect(c.beatMs).toBe(400);
    c.notes.forEach((n: any, i: number) => expect(n.t).toBe(s.notes[i].beat * 400));
  });

  test('charts are seeded: same seed, same figures and chords; other seeds differ', async ({ page }) => {
    await open(page);
    const s = await S(page);
    expect(s.seed).toBe(7);
    const again = await page.evaluate(() => (window as any).__two.chart(7, 120));
    expect(again.figures).toEqual(s.figures);
    expect(again.chords).toEqual(s.chords);
    expect(s.figures.slice(0, 2)).toEqual(['Basic forward', 'Basic forward']);
    expect(s.chords.length).toBe(24);                                  // 96 counts = 24 bars of 4/4
    const others = await page.evaluate(() => [1, 2, 3, 4, 5].map((k) => JSON.stringify((window as any).__two.chart(k, 120).figures)));
    expect(new Set([JSON.stringify(s.figures), ...others]).size).toBeGreaterThan(3);
    await expect(page.getByTestId('figures').locator('li')).toHaveCount(16);
    await expect(page.getByTestId('seed')).toContainText('seed 7');
    await page.getByTestId('reseed').click();
    const seed = (await S(page)).seed;
    expect(page.url()).toContain(`seed=${seed}`);
    await expect(page.getByTestId('seed')).toContainText(`seed ${seed}`);
  });

  test('judgement windows: Perfect within ±45 ms, Good within ±100 ms, then a Miss', async ({ page }) => {
    await open(page);
    await page.getByTestId('start').click();
    const s = await S(page);
    expect(s.mode).toBe('play');
    expect(s.songTime).toBe(-4 * 500);                                 // four counts in
    const n = s.notes;
    const plan: [number, number, string][] = [[0, 0, 'perfect'], [1, 45, 'perfect'], [2, -45, 'perfect'], [3, 46, 'good'], [4, -46, 'good'], [5, 100, 'good'], [6, -100, 'good']];
    for (const [i, dt, want] of plan) {
      await to(page, n[i].t + dt);
      await page.keyboard.press(keyFor(n[i].lane));
      const st = await S(page);
      expect(st.log.at(-1), `note ${i} at ${dt} ms`).toMatchObject({ i, kind: want, dt });
    }
    await expect(page.getByTestId('n-perfect')).toHaveText('3');
    await expect(page.getByTestId('n-good')).toHaveText('4');
    await expect(page.getByTestId('status')).toContainText('Good (early)');
    // a step between prints is a stray: counted, but the combo survives
    await to(page, n[6].t + 250);
    await page.keyboard.press('f');
    let st = await S(page);
    expect(st.stray).toBe(1);
    expect(st.combo).toBe(7);
    // 100 ms late was the last Good; at 101 ms the window has closed, so the print is a Miss and the step a stray
    await to(page, n[7].t + 100);
    expect((await S(page)).notes[7].judged).toBe(null);
    await page.clock.runFor(1);
    await page.keyboard.press(keyFor(n[7].lane));
    st = await S(page);
    expect(st.stray).toBe(2);
    expect(st.notes[7].judged).toBe('miss');
    expect(st.combo).toBe(0);
    await expect(page.getByTestId('n-miss')).toHaveText('1');
    // the right time with the wrong foot is a stray too
    await to(page, n[8].t);
    await page.keyboard.press(keyFor('R'));
    expect((await S(page)).stray).toBe(3);
    await to(page, n[8].t + 150);
    expect((await S(page)).notes[8].judged).toBe('miss');
  });

  test('score and combo: base points × a multiplier that grows every 10 in a row', async ({ page }) => {
    await open(page);
    await page.getByTestId('start').click();
    const n = (await S(page)).notes;
    // 12 perfects, one miss, 3 goods, then 9 perfects
    const kinds = [...Array(12).fill('perfect'), 'miss', ...Array(3).fill('good'), ...Array(9).fill('perfect')];
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === 'miss') continue;
      await to(page, n[i].t + (kinds[i] === 'good' ? 70 : 10));
      await page.keyboard.press(keyFor(n[i].lane));
      if (i === 11) {
        await expect(page.getByTestId('combo')).toHaveText('12');
        await expect(page.getByTestId('mult')).toHaveText('2');
        expect((await S(page)).score).toBe(10 * 300 + 2 * 600);
      }
    }
    const want = expectedScore(kinds);
    const st = await S(page);
    expect(st.log.map((l: any) => l.kind)).toEqual(kinds);
    expect(st.score).toBe(want.score);
    expect(st.combo).toBe(want.combo);
    expect(st.maxCombo).toBe(12);
    await expect(page.getByTestId('score')).toHaveText(String(want.score));
    await expect(page.getByTestId('max-combo')).toHaveText('12');
    await expect(page.getByTestId('accuracy')).toHaveText(`${((100 * (21 + 1.5)) / 25).toFixed(1)}%`);
  });

  test('a full perfect song: 64 steps, top multiplier, grade S and the results card', async ({ page }) => {
    test.setTimeout(90_000);
    await open(page);
    await page.getByTestId('start').click();
    const n = (await S(page)).notes;
    for (const note of n) {
      await to(page, note.t);
      await page.keyboard.press(keyFor(note.lane));
    }
    const want = expectedScore(Array(64).fill('perfect'));
    expect(want.score).toBe(300 * (10 * 1 + 10 * 2 + 10 * 3 + 34 * 4));
    let st = await S(page);
    expect(st.score).toBe(want.score);
    expect(st.maxCombo).toBe(64);
    expect(st.mode).toBe('play');
    await to(page, n[63].t + 100 + 2 * 500 + 50);                       // the band plays out
    st = await S(page);
    expect(st.mode).toBe('done');
    await expect(page.getByTestId('results')).toBeVisible();
    await expect(page.getByTestId('final-score')).toHaveText(String(want.score));
    await expect(page.getByTestId('grade')).toHaveText('S');
    await expect(page.getByTestId('result-line')).toContainText('64 perfect, 0 good, 0 missed');
    await expect(page.getByTestId('again')).toBeFocused();
    await page.getByTestId('again').click();
    st = await S(page);
    expect(st.score).toBe(0);
    expect(st.mode).toBe('play');
  });

  test('practice mode calls the count: 1, 2 quick; 3 slow and 4; 5 slow and 6', async ({ page }) => {
    await open(page);
    await page.getByTestId('practice').click();
    await expect(page.getByTestId('practice')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('start').click();
    await expect(page.getByTestId('count-box')).toBeVisible();
    await to(page, -1750);
    await expect(page.getByTestId('count')).toHaveText('4');
    await expect(page.getByTestId('count-word')).toHaveText('count-in');
    const want = [['1', 'quick'], ['2', 'quick'], ['3', 'slow'], ['4', 'and'], ['5', 'slow'], ['6', 'and'], ['1', 'quick']];
    for (let c = 0; c < want.length; c++) {
      await to(page, c * 500 + 250);                                   // the middle of each count
      await expect(page.getByTestId('count')).toHaveText(want[c][0]);
      await expect(page.getByTestId('count-word')).toHaveText(want[c][1]);
      expect((await S(page)).count.n).toBe(want[c][0]);
    }
    await expect(page.getByTestId('figure')).toHaveText('Basic forward');
    await page.getByTestId('practice').click();
    await expect(page.getByTestId('count-box')).toBeHidden();
  });

  test('tap pads, arrow keys and keyboard-activated pads all step', async ({ page }) => {
    await open(page);
    await page.getByTestId('start').click();
    await expect(page.getByTestId('pad-left')).toBeFocused();
    const n = (await S(page)).notes;
    await to(page, n[0].t);
    await page.getByTestId('pad-left').click();
    await to(page, n[1].t + 20);
    await page.getByTestId('pad-right').click();
    await to(page, n[2].t - 60);
    await page.keyboard.press('ArrowLeft');
    await to(page, n[3].t);
    await page.keyboard.press('ArrowRight');
    await to(page, n[4].t);
    await page.getByTestId('pad-left').focus();
    await page.keyboard.press('Enter');
    const log = (await S(page)).log;
    expect(log.map((l: any) => [l.i, l.kind, l.source])).toEqual([[0, 'perfect', 'tap'], [1, 'perfect', 'tap'], [2, 'good', 'key'], [3, 'perfect', 'key'], [4, 'perfect', 'button']]);
  });

  test('tempo changes the beat: 150 BPM is 400 ms a count, 180 BPM is 333⅓', async ({ page }) => {
    await open(page);
    await page.getByTestId('bpm').selectOption('150');
    let s = await S(page);
    expect(s.beatMs).toBe(400);
    await page.getByTestId('start').click();
    expect((await S(page)).songTime).toBe(-1600);
    await to(page, 400 + 44);
    await page.keyboard.press('j');
    expect((await S(page)).stray).toBe(0);
    expect((await S(page)).log.at(-1)).toMatchObject({ i: 1, kind: 'perfect', dt: 44 });   // the left quick at 0 went by unstepped
    await page.getByTestId('bpm').selectOption('180');
    s = await S(page);
    expect(s.mode).toBe('ready');
    await expect(page.getByTestId('ready')).toBeVisible();
    expect(s.beatMs).toBeCloseTo(60000 / 180, 9);
    expect(s.notes[3].t).toBeCloseTo(4 * 60000 / 180, 9);
    expect(s.notes[63].t).toBeCloseTo(94 * 60000 / 180, 9);
  });

  test('plays without any audio: no AudioContext at all, the beat clock still runs', async ({ page }) => {
    await page.addInitScript(() => { delete (window as any).AudioContext; delete (window as any).webkitAudioContext; });
    await open(page);
    await page.getByTestId('sound').click();
    await expect(page.getByTestId('sound')).toBeDisabled();
    await expect(page.getByTestId('status')).toContainText('Sound is not available');
    await page.getByTestId('start').click();
    const n = (await S(page)).notes;
    await to(page, n[0].t + 20);
    await page.keyboard.press('f');
    const st = await S(page);
    expect(st.audio).toBe('none');
    expect(st.sound).toBe(false);
    expect(st.ticks).toBe(5);                                           // count-in 4 … 1 and the first downbeat
    expect(st.log[0]).toMatchObject({ kind: 'perfect', dt: 20 });
  });
});
