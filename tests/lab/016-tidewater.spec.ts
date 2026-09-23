import { test, expect, Page } from '@playwright/test';

const URL = '/lab/016-tidewater.html?seed=9';

// Independent oracle for the pitch mapping: angle (clockwise from 12 o'clock) → scale degree,
// distance from centre → octave band, root D3 (MIDI 50).
const SCALES: Record<string, number[]> = { pentatonic: [0, 2, 4, 7, 9], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11] };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function expectedNote(angleDeg: number, dist: number, scale: string) {
  const deg = SCALES[scale];
  const sector = Math.floor(angleDeg / (360 / deg.length));
  const band = dist < 0.36 ? 2 : dist < 0.66 ? 1 : 0;
  const midi = 50 + 12 * band + deg[sector];
  return NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

async function tapPool(page: Page, angleDeg: number, dist: number) {
  const g = await page.evaluate(() => (window as any).__garden.geometry());
  const a = (angleDeg * Math.PI) / 180;
  const x = g.size / 2 + Math.sin(a) * dist * g.radius;
  const y = g.size / 2 - Math.cos(a) * dist * g.radius;
  await page.getByTestId('pool').click({ position: { x, y } });
}
const garden = (page: Page) => page.evaluate(() => {
  const g = (window as any).__garden;
  return { stones: g.stones, scale: g.scale, playing: g.playing, muted: g.muted, hits: g.hits, recent: g.recent, rings: g.rings, bpm: g.bpm };
});
async function freezeClock(page: Page) {
  await page.clock.install({ time: new Date(2026, 4, 1, 6, 0) });
  await page.clock.pauseAt(new Date(2026, 4, 1, 6, 0, 1));
}

test.describe('Tidewater', () => {
  test('tapping the pool plants a stone with the right note; tapping it again lifts it', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('pool').scrollIntoViewIfNeeded();
    await tapPool(page, 100, 0.8);
    let s = await garden(page);
    expect(s.stones).toHaveLength(1);
    expect(s.stones[0].note).toBe(expectedNote(100, 0.8, 'pentatonic')); // E3
    await expect(page.getByTestId('announcer')).toHaveText(/Planted a stone: E3\. 1 stone\./);
    await expect(page.getByTestId('stone-count')).toHaveText('1 stone');

    await tapPool(page, 250, 0.25);
    s = await garden(page);
    expect(s.stones.map((x: any) => x.note)).toEqual(['E3', expectedNote(250, 0.25, 'pentatonic')]);

    await tapPool(page, 100, 0.8);
    s = await garden(page);
    expect(s.stones).toHaveLength(1);
    await expect(page.getByTestId('announcer')).toContainText('Lifted the E3 stone');

    await tapPool(page, 0, 0.02); // the centre is reserved for the ripple source
    expect((await garden(page)).stones).toHaveLength(1);
  });

  test('switching scale retunes every planted stone (pentatonic → dorian → lydian)', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('pool').scrollIntoViewIfNeeded();
    await tapPool(page, 160, 0.5);
    await tapPool(page, 300, 0.2);
    const notes = async () => (await garden(page)).stones.map((x: any) => x.note);
    expect(await notes()).toEqual([expectedNote(160, 0.5, 'pentatonic'), expectedNote(300, 0.2, 'pentatonic')]);
    expect(await notes()).toEqual(['F#4', 'B5']);

    for (const scale of ['dorian', 'lydian']) {
      await page.getByRole('radio', { name: new RegExp(scale, 'i') }).check();
      expect((await garden(page)).scale).toBe(scale);
      expect(await notes()).toEqual([expectedNote(160, 0.5, scale), expectedNote(300, 0.2, scale)]);
    }
    expect(await notes()).toEqual(['G#4', 'B5']);
    await expect(page.getByTestId('announcer')).toContainText('Scale: lydian. Stones now ring G#4, B5.');
  });

  test('ripples ring stones only while playing (fake clock, no audio needed)', async ({ page }) => {
    test.setTimeout(90_000);
    await freezeClock(page);
    await page.goto(URL);
    await page.getByTestId('pool').scrollIntoViewIfNeeded();
    await tapPool(page, 160, 0.5);
    await page.clock.runFor(1000);
    expect((await garden(page)).hits).toBe(0); // still water

    await page.getByTestId('play').click();
    await expect(page.getByTestId('play')).toHaveAccessibleName('Pause');
    expect((await garden(page)).playing).toBe(true);
    // 60 bpm: a ripple every second, crossing to r=0.5 in ~1.5 s → ripples born at 0 s and 1 s have rung by 3 s
    await page.clock.runFor(3000);
    let s = await garden(page);
    expect(s.hits).toBe(2);
    expect(s.recent).toEqual(['F#4', 'F#4']);
    await expect(page.getByTestId('recent-notes')).toContainText('F#4');

    await page.getByTestId('play').click();
    expect((await garden(page)).playing).toBe(false);
    await page.clock.runFor(3600); // in-flight ripples finish and fade
    s = await garden(page);
    expect(s.rings).toBe(0);
    const settled = s.hits;
    await page.clock.runFor(2000);
    expect((await garden(page)).hits).toBe(settled);
  });

  test('tempo controls how often ripples ring; mute silences the master bus', async ({ page }) => {
    test.setTimeout(90_000); // many animation frames under a fake clock
    await freezeClock(page);
    await page.goto(URL);
    await page.getByTestId('pool').scrollIntoViewIfNeeded();
    await tapPool(page, 45, 0.5);

    const countFor = async (bpm: number) => {
      await page.getByTestId('tempo').fill(String(bpm));
      await expect(page.getByTestId('tempo-out')).toHaveText(`${bpm} bpm`);
      const before = (await garden(page)).hits;
      await page.getByTestId('play').click();
      await page.clock.runFor(3000);
      await page.getByTestId('play').click();
      const n = (await garden(page)).hits - before;
      await page.clock.runFor(2500); // fast ripples are gone well within this
      return n;
    };
    const fast = await countFor(120); // fast first: its ripples clear the pool quickly
    const slow = await countFor(40);
    expect(slow).toBeGreaterThanOrEqual(1);
    expect(fast).toBeGreaterThan(slow * 2);

    const mute = page.getByTestId('mute');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    expect((await garden(page)).muted).toBe(true);
    const audio = await page.evaluate(() => (window as any).__garden.audio);
    expect(audio).not.toBeNull(); // the audio graph was built by the Play gesture
    if (audio.state === 'running') {
      await expect.poll(() => page.evaluate(() => (window as any).__garden.audio.master), { timeout: 5000 }).toBeLessThan(0.05);
    }
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
  });

  test('keyboard: arrows move a cursor over the pool and Enter plants a stone', async ({ page }) => {
    await page.goto(URL);
    const pool = page.getByTestId('pool');
    await pool.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    // cursor starts at (0.5, 0.3) in pool units → now (0.62, 0.36)
    await expect(page.getByTestId('announcer')).toContainText('Cursor on');
    await page.keyboard.press('Enter');
    const s = await garden(page);
    expect(s.stones).toHaveLength(1);
    expect(s.stones[0].x).toBeCloseTo(0.62, 5);
    expect(s.stones[0].y).toBeCloseTo(0.36, 5);
    const angle = (Math.atan2(0.62, -0.36) * 180) / Math.PI;
    expect(s.stones[0].note).toBe(expectedNote((angle + 360) % 360, Math.hypot(0.62, 0.36), 'pentatonic'));
    await expect(page.getByTestId('announcer')).toContainText(`Planted a stone: ${s.stones[0].note}`);
    await page.keyboard.press('Enter');
    expect((await garden(page)).stones).toHaveLength(0);
  });
});
