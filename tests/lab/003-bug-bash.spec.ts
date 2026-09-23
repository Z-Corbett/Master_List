import { test, expect, type Page } from '@playwright/test';

type Bug = { id: number; type: string; x: number; y: number; r: number; hp: number };
type GameState = { status: string; score: number; combo: number; lives: number; level: number; high: number; lineY: number; bugs: Bug[] };

const state = (page: Page) => page.evaluate(() => (window as any).__game.state as GameState);
const spawn = (page: Page, type: string, x: number, y: number) =>
  page.evaluate(([t, a, b]) => (window as any).__game.spawn(t, a, b), [type, x, y] as const);

/** Start a game with the world on hold (no movement, spawning or combo decay) and the board empty. */
async function startFrozen(page: Page) {
  await page.goto('/lab/003-bug-bash.html?seed=11');
  await page.getByTestId('start-btn').click();
  await page.evaluate(() => { const g = (window as any).__game; g.hold(true); g.clear(); });
}
/** Pointer click in game coordinates (canvas CSS pixels). Uses page.mouse to skip actionability waits on the rAF-driven canvas. */
async function squash(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('game-canvas').boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
}

test.describe('Bug Bash', () => {
  // canvas + rAF game under parallel load: give the multi-step flows headroom
  test.describe.configure({ timeout: 60_000 });

  test('start screen introduces the species and Start begins play', async ({ page }) => {
    await page.goto('/lab/003-bug-bash.html?seed=11');
    const start = page.getByTestId('start-screen');
    await expect(start).toBeVisible();
    await expect(start).toContainText('Heisenbug');
    await expect(start).toContainText('Memory leak');
    expect((await state(page)).status).toBe('start');
    await page.getByTestId('start-btn').click();
    await expect(start).toBeHidden();
    expect((await state(page)).status).toBe('playing');
    await expect(page.getByTestId('lives')).toHaveAttribute('aria-label', '3 lives left');
  });

  test('tapping bugs squashes them and chains a combo multiplier; a miss breaks it', async ({ page }) => {
    await startFrozen(page);
    for (const [x, y] of [[80, 120], [160, 160], [240, 200]]) {
      await spawn(page, 'regression', x, y);
      await squash(page, x, y);
    }
    // 10×1 + 10×2 + 10×3
    await expect(page.getByTestId('score')).toHaveText('60');
    await expect(page.getByTestId('combo')).toHaveText('×3');
    expect((await state(page)).bugs).toHaveLength(0);

    await squash(page, 30, 40); // empty space
    await expect(page.getByTestId('combo')).toHaveText('×1');
    await expect(page.getByTestId('score')).toHaveText('60');
  });

  test('a memory leak takes three hits; ten squashes level up', async ({ page }) => {
    await startFrozen(page);
    await spawn(page, 'leak', 150, 220);
    await squash(page, 150, 220);
    await squash(page, 150, 220);
    let s = await state(page);
    expect(s.bugs).toHaveLength(1);
    expect(s.bugs[0].hp).toBe(1);
    await expect(page.getByTestId('score')).toHaveText('0');
    await squash(page, 150, 220);
    await expect(page.getByTestId('score')).toHaveText('40');

    const spots = Array.from({ length: 9 }, (_, i) => [60 + (i % 3) * 90, 120 + Math.floor(i / 3) * 70]);
    await page.evaluate((pts) => pts.forEach(([x, y]) => (window as any).__game.spawn('race', x, y)), spots);
    for (const [x, y] of spots) await squash(page, x, y);
    await expect(page.getByTestId('level')).toHaveText('2');
    s = await state(page);
    expect(s.level).toBe(2);
  });

  test('escapes cost lives, game over saves the high score across reloads', async ({ page }) => {
    await startFrozen(page);
    await spawn(page, 'regression', 120, 150);
    await squash(page, 120, 150);
    await expect(page.getByTestId('score')).toHaveText('10');

    const { lineY } = await state(page);
    await spawn(page, 'regression', 100, lineY + 20);
    await page.evaluate(() => (window as any).__game.step(50));
    await expect(page.getByTestId('lives')).toHaveAttribute('data-lives', '2');

    await spawn(page, 'race', 150, lineY + 20);
    await spawn(page, 'heisenbug', 200, lineY + 20);
    await page.evaluate(() => (window as any).__game.step(50));
    expect((await state(page)).status).toBe('over');
    await expect(page.getByTestId('over-screen')).toBeVisible();
    await expect(page.getByTestId('final-score')).toHaveText('10');
    await expect(page.getByTestId('new-high')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('bugbash.high'))).toBe('10');

    await page.reload();
    await expect(page.getByTestId('high-score')).toHaveText('10');
  });

  test('P and the pause button pause and resume; paused time does not advance bugs', async ({ page }) => {
    await startFrozen(page);
    await page.evaluate(() => (window as any).__game.hold(false));
    await spawn(page, 'regression', 150, 100);
    await page.keyboard.press('p');
    await expect(page.getByTestId('pause-screen')).toBeVisible();
    expect((await state(page)).status).toBe('paused');
    const before = (await state(page)).bugs[0].y;
    await page.evaluate(() => (window as any).__game.step(1000));
    expect((await state(page)).bugs[0].y).toBe(before);
    await page.keyboard.press('p');
    await expect(page.getByTestId('pause-screen')).toBeHidden();

    await page.getByTestId('pause-btn').click();
    await expect(page.getByTestId('pause-screen')).toBeVisible();
    await page.getByTestId('resume-btn').click();
    expect((await state(page)).status).toBe('playing');
    await page.evaluate(() => (window as any).__game.step(500));
    expect((await state(page)).bugs[0].y).toBeGreaterThan(before);
  });
});
