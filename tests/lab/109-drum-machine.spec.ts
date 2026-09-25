import { test, expect, Page } from '@playwright/test';

const URL = '/lab/109-drum-machine.html';
const S = (page: Page) => page.evaluate(() => (window as any).__drums.state);
const LOG = (page: Page) => page.evaluate(() => (window as any).__drums.log);
const PLAN = (page: Page, n = 16) => page.evaluate((n) => (window as any).__drums.plan(n), n);

// Independent oracles: a 16th note lasts 60/BPM/4 s, and swing s% (50 = straight, MPC-style) moves each
// off-beat 16th to 2·s/100 of the way through its pair, i.e. (2s/100 − 1) sixteenths late.
const s16 = (bpm: number) => 60 / bpm / 4;
const noteTime = (n: number, bpm: number, swing: number) => n * s16(bpm) + (n % 2 ? (2 * swing / 100 - 1) * s16(bpm) : 0);
const hex = (on: number[]) => {
  let s = '';
  for (let q = 0; q < 4; q++) { let v = 0; for (let b = 0; b < 4; b++) v = v * 2 + (on.includes(q * 4 + b) ? 1 : 0); s += v.toString(16); }
  return s;
};

async function setBpm(page: Page, v: number) {
  await page.getByTestId('bpm').fill(String(v));
  await page.getByTestId('bpm').press('Enter');
}
async function setRange(page: Page, id: string, v: number) {
  await page.getByTestId(id).evaluate((el: HTMLInputElement, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
}
/** Fake clock, paused, with Web Audio removed or wedged, so the scheduler runs on performance.now. */
async function silent(page: Page, mode: 'missing' | 'suspended', url = URL) {
  await page.addInitScript((mode) => {
    if (mode === 'missing') { (window as any).AudioContext = undefined; (window as any).webkitAudioContext = undefined; return; }
    const Real = (window as any).AudioContext;
    class Stuck extends Real { get state() { return 'suspended'; } resume() { return new Promise(() => {}); } }
    (window as any).AudioContext = Stuck;
  }, mode);
  const t = new Date('2026-09-25T12:00:00Z');
  await page.clock.install({ time: t });
  await page.goto(url);
  await page.clock.pauseAt(new Date(t.getTime() + 1000));
}

test.describe('109 Drum Machine', () => {
  test('the note plan: a 16th is 60/BPM/4 s, and swing delays only the off-beat 16ths', async ({ page }) => {
    await page.goto(URL);
    await setBpm(page, 120);
    let plan = await PLAN(page, 32);
    expect(plan).toHaveLength(32);
    plan.forEach((e: any) => expect(e.t).toBeCloseTo(e.n * 0.125, 9));      // 120 BPM: 125 ms per step, bar 2 continues
    expect(await page.evaluate(() => (window as any).__drums.sixteenth())).toBeCloseTo(0.125, 12);
    await setRange(page, 'swing', 60);
    await expect(page.getByTestId('swing-out')).toHaveText('60%');
    plan = await PLAN(page, 32);
    plan.forEach((e: any) => expect(e.t).toBeCloseTo(noteTime(e.n % 16, 120, 60) + Math.floor(e.n / 16) * 2, 9));
    expect(plan[1].t - plan[0].t).toBeCloseTo(0.15, 9);                    // 60% of a 250 ms pair
    expect(plan[2].t - plan[1].t).toBeCloseTo(0.10, 9);
    expect(plan[2].t).toBeCloseTo(0.25, 9);                                 // down-beats never move
    await expect(page.getByTestId('timing-text')).toHaveText('One sixteenth is 125.0 ms at 120 BPM, one bar 2.000 s. Swing 60% pushes each off-beat sixteenth 25.0 ms late.');
    // the timeline puts every dot where the plan says
    const dots = await page.locator('#timeline circle').evaluateAll((cs) => cs.map((c) => +c.getAttribute('data-t')!));
    dots.forEach((t, i) => expect(t).toBeCloseTo(noteTime(i, 120, 60), 5));
    // the extremes of the tempo range
    for (const bpm of [60, 200, 97]) {
      await setBpm(page, bpm);
      plan = await PLAN(page, 16);
      expect(plan[4].t).toBeCloseTo(60 / bpm, 9);                         // four 16ths make a beat
      expect(plan[3].t).toBeCloseTo(noteTime(3, bpm, 60), 9);
    }
  });

  test('tempo and swing are clamped to 60–200 BPM and 50–75%', async ({ page }) => {
    await page.goto(URL);
    await setBpm(page, 250);
    await expect(page.getByTestId('bpm')).toHaveValue('200');
    await expect(page.getByTestId('bpm-lcd')).toHaveText('200');
    await setBpm(page, 30);
    await expect(page.getByTestId('bpm')).toHaveValue('60');
    await setBpm(page, 133.6);
    expect((await S(page)).bpm).toBe(134);
    await setRange(page, 'bpm-range', 88);
    await expect(page.getByTestId('bpm')).toHaveValue('88');
    await expect(page.getByTestId('bpm-lcd')).toHaveText('88');
    await setRange(page, 'swing', 50);
    await expect(page.getByTestId('swing-out')).toHaveText('50% (straight)');
    await expect(page.getByTestId('timing-text')).toContainText('every step is evenly spaced');
    // a hand-edited link cannot push the machine out of range either
    await page.goto(`${URL}#bpm=999&swing=10`);
    expect((await S(page))).toMatchObject({ bpm: 200, swing: 50 });
  });

  test('lookahead scheduler on the fake clock: exact note times, nothing past the lookahead, playhead follows', async ({ page }) => {
    await silent(page, 'missing');
    await page.getByTestId('clear').click();
    await setBpm(page, 120);
    await page.getByTestId('step-kick-0').click();
    await page.getByTestId('step-snare-4').click();
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status')).toContainText('Web Audio is not available');
    await page.clock.runFor(2000);
    const { LOOKAHEAD, START_DELAY } = await page.evaluate(() => (window as any).__drums);
    const log = await LOG(page);
    log.forEach((e: any, i: number) => { expect(e.n).toBe(i); expect(e.t).toBeCloseTo(noteTime(i, 120, 50), 9); });
    // every note due inside the window was scheduled, and none beyond it
    const horizon = 2 - START_DELAY + LOOKAHEAD;
    expect(log[log.length - 1].t).toBeLessThan(horizon);
    expect(log[log.length - 1].t).toBeGreaterThan(horizon - 0.125 - 0.025);
    expect(log.filter((e: any) => e.voices.includes('kick')).map((e: any) => e.n)).toEqual([0, 16]);
    expect(log.filter((e: any) => e.voices.includes('snare')).map((e: any) => e.n)).toEqual([4]);
    expect(log.every((e: any) => e.sounded === false)).toBe(true);
    const s = await S(page);
    expect(s).toMatchObject({ clock: 'silent', audio: 'unavailable', playing: true });
    // 2 s after Play, 1.95 s after the first note: step floor(1.95 / 0.125) = 15 is lit
    expect(s.playhead).toBe(Math.floor((2 - START_DELAY) / 0.125) % 16);
    await expect(page.getByTestId('step-kick-15')).toHaveClass(/now/);
    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveText('Play');
    await expect(page.locator('.step.now')).toHaveCount(0);
    const n = (await LOG(page)).length;
    await page.clock.runFor(1000);
    expect((await LOG(page)).length).toBe(n);                              // stopped means stopped
  });

  test('changing tempo mid-bar: later steps use the new 16th, earlier ones keep theirs', async ({ page }) => {
    await silent(page, 'missing');
    await setBpm(page, 120);
    await setRange(page, 'swing', 50);
    await page.getByTestId('play').click();
    await page.clock.runFor(1000);
    await setBpm(page, 60);
    await page.clock.runFor(3000);
    const log = await LOG(page);
    expect(log.some((e: any) => e.bpm === 120)).toBe(true);
    expect(log.some((e: any) => e.bpm === 60)).toBe(true);
    for (let i = 1; i < log.length; i++) expect(log[i].t - log[i - 1].t).toBeCloseTo(s16(log[i - 1].bpm), 9);
    // with swing on, off-beats are late by the swing of their own tempo
    await setRange(page, 'swing', 75);
    await page.clock.runFor(2000);
    const late = (await LOG(page)).filter((e: any) => e.swing === 75);
    expect(late.length).toBeGreaterThan(4);
    for (let i = 1; i < late.length; i++) {
      const gap = late[i].t - late[i - 1].t;
      expect(gap).toBeCloseTo(late[i].n % 2 ? 1.5 * 0.25 : 0.5 * 0.25, 9);   // 75%: long-short pairs, 3:1
    }
  });

  test('a browser that keeps audio suspended still plays silently, in time', async ({ page }) => {
    await silent(page, 'suspended');
    expect((await S(page)).audio).toBe('none');                             // nothing before a gesture
    await page.getByTestId('play').click();
    await expect(page.getByTestId('status')).toContainText('Audio is suspended by the browser');
    await page.clock.runFor(1500);
    const s = await S(page);
    expect(s).toMatchObject({ clock: 'silent', audio: 'suspended', triggered: 0 });
    const log = await LOG(page);
    expect(log.length).toBeGreaterThan(10);
    log.forEach((e: any) => expect(e.t).toBeCloseTo(noteTime(e.n, 124, 50), 9));   // default preset: 124 BPM
    expect(log.every((e: any) => !e.sounded)).toBe(true);
    await page.getByTestId('aud-kick').click();
    await expect(page.getByTestId('status')).toContainText('suspended');
  });

  test('real Web Audio: nothing starts before a gesture, then hits are scheduled on the audio clock', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('step-rim-3').click();
    await setBpm(page, 150);
    await page.getByTestId('grid-seq').getByTestId('step-kick-2').focus();
    await page.keyboard.press('Space');
    expect((await S(page)).audio).toBe('none');                             // toggling and typing make no sound
    await page.getByTestId('play').click();
    await expect.poll(async () => (await S(page)).audio).toBe('running');
    await expect.poll(async () => (await S(page)).clock).toBe('audio');
    await expect.poll(async () => (await LOG(page)).filter((e: any) => e.sounded).length).toBeGreaterThan(3);
    expect((await S(page)).triggered).toBeGreaterThan(3);
    const log = await LOG(page);
    for (let i = 1; i < log.length; i++) expect(log[i].t - log[i - 1].t).toBeCloseTo(s16(150), 9);
    await page.getByTestId('play').click();
    await expect(page.getByTestId('status')).toHaveText('Stopped.');
  });

  test('keyboard: arrows move a roving focus round the grid, Space toggles', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('clear').click();
    const k0 = page.getByTestId('step-kick-0');
    await expect(k0).toHaveAttribute('tabindex', '0');
    await k0.focus();
    await page.keyboard.press('Space');
    await expect(k0).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status')).toHaveText('Kick step 1 on.');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('step-kick-2')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('step-snare-2')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('step-snare-2')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('step-snare-2')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('End');
    await expect(page.getByTestId('step-snare-15')).toBeFocused();
    await page.keyboard.press('ArrowRight');                               // wraps within the row
    await expect(page.getByTestId('step-snare-0')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');                                  // stops at the top row
    await expect(page.getByTestId('step-kick-0')).toBeFocused();
    for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('step-rim-0')).toBeFocused();
    await expect(page.locator('.step[tabindex="0"]')).toHaveCount(1);
    await expect(page.getByTestId('step-rim-0')).toHaveAttribute('tabindex', '0');
    await expect(page.getByTestId('grid-seq')).toHaveAttribute('role', 'grid');
    await expect(page.locator('[role="row"]')).toHaveCount(6);
    await expect(page.locator('[role="gridcell"]')).toHaveCount(96);
    expect((await S(page)).pattern.kick.map((b: boolean, i: number) => (b ? i : -1)).filter((i: number) => i >= 0)).toEqual([0]);
  });

  test('presets: four on the floor, boom-bap and a Texas two-step shuffle', async ({ page }) => {
    await page.goto(URL);
    const on = async (id: string) => (await S(page)).pattern[id].map((b: boolean, i: number) => (b ? i : -1)).filter((i: number) => i >= 0);
    await expect(page.getByTestId('preset-four')).toHaveAttribute('aria-pressed', 'true');   // the default
    expect(await on('kick')).toEqual([0, 4, 8, 12]);                        // a kick on every beat
    expect(await on('clap')).toEqual([4, 12]);                              // backbeat on 2 and 4
    expect(await on('ohh')).toEqual([2, 6, 10, 14]);                        // open hat on the off-beat eighths
    expect((await S(page)).bpm).toBe(124);
    await page.getByTestId('preset-boombap').click();
    expect((await S(page))).toMatchObject({ bpm: 90, swing: 58, preset: 'boombap' });
    expect(await on('snare')).toEqual([4, 12]);
    expect(await on('chh')).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    await expect(page.getByTestId('preset-four')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('preset-twostep').click();
    expect((await S(page))).toMatchObject({ bpm: 84, swing: 67 });
    await expect(page.getByTestId('swing-out')).toHaveText('67% (triplet)');
    expect(await on('kick')).toEqual([0, 4, 8, 12]);                        // boom …
    expect(await on('rim')).toEqual([2, 6, 10, 14]);                        // … chick
    // 67% swing is a near-triplet shuffle: each pair splits roughly 2:1
    const p = await PLAN(page, 3);
    expect((p[1].t - p[0].t) / (p[2].t - p[1].t)).toBeCloseTo(67 / 33, 6);
    await expect(page.getByTestId('status')).toHaveText('Texas two-step: 84 BPM, swing 67%.');
    // editing a step means it is no longer the preset
    await page.getByTestId('step-snare-0').click();
    await expect(page.getByTestId('preset-twostep')).toHaveAttribute('aria-pressed', 'false');
  });

  test('patterns travel in the URL hash, both ways', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('clear').click();
    await setBpm(page, 101);
    await setRange(page, 'swing', 62);
    for (const [v, s] of [['kick', 0], ['kick', 5], ['kick', 10], ['snare', 4], ['snare', 12], ['rim', 15]] as const) await page.getByTestId(`step-${v}-${s}`).click();
    await page.getByTestId('mute-rim').click();
    const hash = new URLSearchParams(new globalThis.URL(page.url()).hash.slice(1));
    expect(hash.get('bpm')).toBe('101');
    expect(hash.get('swing')).toBe('62');
    expect(hash.get('kick')).toBe(hex([0, 5, 10]));                         // 0b1000_0100_0010_0000 = 8420
    expect(hash.get('kick')).toBe('8420');
    expect(hash.get('snare')).toBe(hex([4, 12]));
    expect(hash.get('rim')).toBe('0001');
    expect(hash.get('chh')).toBe('0000');
    expect(hash.get('mute')).toBe('rim');
    await expect(page.getByTestId('share-link')).toHaveValue(page.url());
    // a link built by hand opens exactly that pattern
    const built = new URLSearchParams({ bpm: '77', swing: '70', kick: hex([0, 3, 6, 9, 12]), clap: hex([4, 12]), chh: 'zzzz', vol: '100.80.80.80.40.80' });
    const page2 = await page.context().newPage();
    await page2.goto(`${URL}#${built}`);
    for (let i = 0; i < 16; i++) {
      await expect(page2.getByTestId(`step-kick-${i}`)).toHaveAttribute('aria-pressed', String([0, 3, 6, 9, 12].includes(i)));
      await expect(page2.getByTestId(`step-clap-${i}`)).toHaveAttribute('aria-pressed', String(i === 4 || i === 12));
    }
    const s = await S(page2);
    expect(s).toMatchObject({ bpm: 77, swing: 70, preset: null });
    expect(s.pattern.chh.every((b: boolean) => !b)).toBe(true);             // junk hex is ignored
    expect(s.vol).toEqual({ kick: 100, snare: 80, chh: 80, ohh: 80, clap: 40, rim: 80 });
    await expect(page2.getByTestId('bpm-lcd')).toHaveText('77');
    await expect(page2.getByTestId('volout-clap')).toHaveText('40');
    // editing the hash in place reloads the pattern without a navigation
    await page2.evaluate(() => { location.hash = 'bpm=140&kick=f000'; });
    await expect(page2.getByTestId('bpm-lcd')).toHaveText('140');
    expect((await S(page2)).pattern.kick.slice(0, 5)).toEqual([true, true, true, true, false]);
  });

  test('mixer: mute and zero volume take a voice out of the schedule', async ({ page }) => {
    await silent(page, 'missing');
    await page.getByTestId('preset-four').click();
    await page.getByTestId('mute-kick').click();
    await expect(page.getByTestId('mute-kick')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.row[data-voice="kick"]')).toHaveClass(/muted/);
    await setRange(page, 'vol-clap', 0);
    await expect(page.getByTestId('volout-clap')).toHaveText('0');
    await page.getByTestId('play').click();
    await page.clock.runFor(2500);
    let log = await LOG(page);
    expect(log.length).toBeGreaterThan(16);
    const heard = new Set(log.flatMap((e: any) => e.voices));
    expect(heard.has('kick')).toBe(false);
    expect(heard.has('clap')).toBe(false);
    expect(heard.has('ohh')).toBe(true);
    expect(log.filter((e: any) => e.voices.includes('ohh')).every((e: any) => [2, 6, 10, 14].includes(e.step))).toBe(true);
    // unmute mid-play: the kick comes back on the next scheduled down-beats
    await page.getByTestId('mute-kick').click();
    await page.clock.runFor(2500);
    log = await LOG(page);
    const kicks = log.filter((e: any) => e.voices.includes('kick'));
    expect(kicks.length).toBeGreaterThanOrEqual(4);
    expect(kicks.every((e: any) => e.step % 4 === 0)).toBe(true);
    expect(new URLSearchParams(new globalThis.URL(page.url()).hash.slice(1)).get('vol')).toBe('80.80.80.80.0.80');
  });
});
