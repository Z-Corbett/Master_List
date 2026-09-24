import { test, expect, Page } from '@playwright/test';

const URL = '/lab/091-armadillo-dash.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__dash.state);
const frames = (page: Page, n: number) => page.evaluate((n) => (window as any).__dash.frames(n), n);
const until = (page: Page, gap: number) => page.evaluate((g) => (window as any).__dash.until(g), gap);
const place = (page: Page, kind: string, ahead: number, h = 6) =>
  page.evaluate(([k, a, h]) => (window as any).__dash.place(k, a, h), [kind, ahead, h] as const);

/** Start a run with the real-time loop detached, so every 1/120 s step is driven by the test. */
async function start(page: Page, url = URL) {
  await page.goto(url);
  await page.evaluate(() => (window as any).__dash.manual(true));
  await page.getByTestId('start').click();
  await expect(page.getByTestId('ready')).toBeHidden();
  expect((await S(page)).mode).toBe('run');
}

test.describe('091 Armadillo Dash', () => {
  test('the road is seeded and the pace picks up', async ({ page }) => {
    await start(page);
    const a = await frames(page, 400);
    expect(a.frame).toBe(400);
    expect(a.t).toBeCloseTo(400 / 120, 3);
    expect(a.speed).toBeGreaterThan(315);
    expect(a.dist).toBeGreaterThan(1000);
    expect(a.spawned.length).toBeGreaterThan(0);
    await expect(page.getByTestId('speed')).toHaveText(/\d+ mph/);
    // same seed, same frames: an identical road
    await start(page);
    const b = await frames(page, 400);
    expect(b.obstacles).toEqual(a.obstacles);
    expect(b.items).toEqual(a.items);
    // a different seed lays out a different road
    const layouts = new Set<string>();
    for (const seed of [1, 2, 3, 4]) {
      await start(page, `/lab/091-armadillo-dash.html?seed=${seed}`);
      const s = await frames(page, 400);
      layouts.add(JSON.stringify([s.obstacles, s.items]));
    }
    expect(layouts.size).toBeGreaterThan(1);
    // speed keeps climbing with time
    await start(page);
    await place(page, 'grub', 20000);
    const s1 = await frames(page, 120 * 10);
    const s2 = await frames(page, 120 * 10);
    expect(s2.speed).toBeGreaterThan(s1.speed + 50);
  });

  test('prickly pear: running into it ends the run, jumping clears it', async ({ page }) => {
    await start(page);
    await place(page, 'pear', 260);
    let s = await frames(page, 240);
    expect(s.mode).toBe('over');
    expect(s.cause).toBe('pear');
    await expect(page.getByTestId('gameover')).toBeVisible();
    await expect(page.getByTestId('cause')).toContainText('prickly pear');
    // again, and this time jump with Space when it is close
    await page.getByTestId('again').click();
    await place(page, 'pear', 260);
    await until(page, 60);
    await page.keyboard.press('Space');
    s = await frames(page, 6);
    expect(s.onGround).toBe(false);
    expect(s.y).toBeGreaterThan(0);
    s = await frames(page, 150);
    expect(s.mode).toBe('run');
    expect(s.jumps).toBe(1);
    expect(s.cleared).toBe(1);
    expect(s.onGround).toBe(true);
    // a cedar post is cleared the same way, with the Jump button
    await place(page, 'post', 260);
    await until(page, 60);
    await page.getByTestId('jump').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', bubbles: true });
    s = await frames(page, 150);
    expect(s.mode).toBe('run');
    expect(s.cleared).toBe(2);
  });

  test('curling rolls under barbed wire and tumbleweeds; standing tall does not', async ({ page }) => {
    await start(page);
    await place(page, 'wire', 200);
    let s = await frames(page, 200);
    expect(s.mode).toBe('over');
    expect(s.cause).toBe('wire');
    await expect(page.getByTestId('cause')).toContainText('Curl under it');
    await page.getByTestId('again').click();
    // hold ArrowDown: the armadillo is a ball, lower than the bottom strand
    await place(page, 'wire', 200);
    await page.keyboard.down('ArrowDown');
    s = await frames(page, 2);
    expect(s.curled).toBe(true);
    expect(s.player.h).toBeLessThan(s.obstacles[0].lift);
    s = await frames(page, 150);
    await page.keyboard.up('ArrowDown');
    expect(s.mode).toBe('run');
    expect(s.cleared).toBe(1);
    // the curl lasts a beat after release, then it stands again
    s = await frames(page, 60);
    expect(s.curled).toBe(false);
    // tumbleweed via the left side of the road (touch)
    await place(page, 'tumble', 260);
    const scene = page.getByTestId('scene'), box = (await scene.boundingBox())!;
    const at = { pointerId: 5, pointerType: 'touch', clientX: box.x + box.width * 0.15, clientY: box.y + box.height * 0.7, bubbles: true };
    await scene.dispatchEvent('pointerdown', at);
    s = await frames(page, 160);
    expect(s.curled).toBe(true);
    expect(s.mode).toBe('run');
    expect(s.cleared).toBe(2);
    await scene.dispatchEvent('pointerup', at);
    s = await frames(page, 60);
    expect(s.curled).toBe(false);
  });

  test('grubs and lone stars add to the score', async ({ page }) => {
    await start(page);
    let s = await place(page, 'grub', 150, 6);
    const before = s.bonus;
    s = await frames(page, 90);
    expect(s.grubs).toBe(1);
    expect(s.bonus).toBe(before + 25);
    // a star floats high: stay on the ground and it goes by, jump and it is yours
    await place(page, 'star', 150, 80);
    s = await frames(page, 120);
    expect(s.stars).toBe(0);
    await place(page, 'star', 160, 80);
    await page.keyboard.press('ArrowUp');
    s = await frames(page, 90);
    expect(s.stars).toBe(1);
    expect(s.bonus).toBe(before + 25 + 250);
    await expect(page.getByTestId('status')).toHaveText('A lone star! +250');
    await expect(page.getByTestId('score')).toHaveText(String(s.score));
  });

  test('the best score is kept between visits', async ({ page }) => {
    await start(page);
    await place(page, 'grub', 120);
    await frames(page, 60);
    await place(page, 'pear', 600);
    const s = await frames(page, 400);
    expect(s.mode).toBe('over');
    expect(s.score).toBeGreaterThan(25);
    await expect(page.getByTestId('final')).toHaveText(String(s.score));
    await expect(page.getByTestId('best-line')).toContainText(`Best: ${s.score}`);
    await expect(page.getByTestId('again')).toBeFocused();
    await page.reload();
    await expect(page.getByTestId('best')).toHaveText(String(s.score));
    // a shorter run does not lower it
    await page.evaluate(() => (window as any).__dash.manual(true));
    await page.getByTestId('start').click();
    await place(page, 'post', 100);
    const t = await frames(page, 200);
    expect(t.mode).toBe('over');
    expect(t.best).toBe(s.score);
    await expect(page.getByTestId('best')).toHaveText(String(s.score));
  });

  test('day turns to golden hour and dusk; pause stops the clock', async ({ page }) => {
    test.setTimeout(60_000);
    await start(page);
    await place(page, 'grub', 90000);      // an empty road for a long while
    let s = await frames(page, 120 * 30);
    expect(s.phase).toBe('day');
    const dayTop = s.sky.top.reduce((a: number, b: number) => a + b, 0);
    s = await frames(page, 120 * 60);         // 90 s in
    expect(s.phase).toBe('golden hour');
    s = await frames(page, 120 * 15);         // 105 s in
    expect(s.phase).toBe('dusk');
    expect(s.mode).toBe('run');
    expect(s.sky.top.reduce((a: number, b: number) => a + b, 0)).toBeLessThan(dayTop - 150);
    await expect(page.getByTestId('status')).toHaveText('The light changes: dusk.');
    expect(s.speed).toBe(700);               // top speed reached
    // pause
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    const p = await frames(page, 120);
    expect(p.mode).toBe('paused');
    expect(p.t).toBe(s.t);
    await page.keyboard.press('p');
    expect((await frames(page, 12)).t).toBeGreaterThan(s.t);
  });
});
