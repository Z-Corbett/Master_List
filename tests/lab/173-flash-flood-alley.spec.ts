import { test, expect, Page } from '@playwright/test';

const URL = '/lab/173-flash-flood-alley.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__flood.state);
const ticks = (page: Page, n: number) => page.evaluate((n) => (window as any).__flood.ticks(n), n);
const untilDone = (page: Page) => page.evaluate(() => (window as any).__flood.untilDone());
const F = (page: Page, fn: string, ...args: any[]) =>
  page.evaluate(([fn, args]) => (window as any).__flood[fn as string](...(args as any[])), [fn, args] as const);

/** Load with the real-time loop detached, so every tick of the automaton is driven by the test. */
async function open(page: Page, url = URL) {
  await page.goto(url);
  await page.evaluate(() => (window as any).__flood.manual(true));
}
async function pickLevel(page: Page, n: number) {
  await page.getByTestId('level').selectOption(String(n));
  expect((await S(page)).level).toBe(n);
}
/** Clear every debris cell in the culvert (in page coordinates, so no budget bookkeeping in the test). */
async function clearCulvert(page: Page) {
  await page.evaluate(() => {
    const f = (window as any).__flood, L = f.layout, lv = L.LEVELS[f.state.level];
    for (const y of [L.CREEK_FLOOR - 2, L.CREEK_FLOOR - 4]) for (let x = L.TERRACE[0]; x <= lv.debris + 2; x += 2) f.paint(x, y, 'dig');
  });
}
/** A sandbag wall on the terrace between the creek and the first house, `h` rows tall. */
async function levee(page: Page, h: number) {
  await page.evaluate((h) => {
    const f = (window as any).__flood, L = f.layout;
    for (let y = L.TERRACE_TOP - 2; y >= L.TERRACE_TOP - h; y -= 3) { f.paint(56, y, 'sand'); f.ticks(4); }
    f.ticks(60);
  }, h);
}

test.describe('173 Flash Flood Alley', () => {
  test('water falls, levels out flat and is never created or destroyed', async ({ page }) => {
    await open(page);
    await F(page, 'sandbox');
    await F(page, 'fill', 40, 10, 59, 19, 'water');          // a 20 x 10 slab of water in mid-air
    expect((await S(page)).water).toBe(200);
    await ticks(page, 30);
    expect((await S(page)).water).toBe(200);
    // after a while it has spread over the floor and the surface is flat to within one cell
    const s = await ticks(page, 900);
    expect(s.water).toBe(200);
    const surf: number[] = await F(page, 'surface', 1, 118);
    const tops = surf.filter((y) => y >= 0);
    expect(tops.length).toBeGreaterThan(90);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    // nothing is left hanging in the air: every water cell has something under it
    const floating = await page.evaluate(() => {
      const f = (window as any).__flood; let n = 0;
      for (let x = 1; x < 119; x++) for (let y = 0; y < 66; y++) if (f.cell(x, y) === 'water' && f.cell(x, y + 1) === 'air') n++;
      return n;
    });
    expect(floating).toBe(0);
  });

  test('sandbags drop straight down, stack into a wall and sink through water', async ({ page }) => {
    await open(page);
    await F(page, 'sandbox');
    const placed = await F(page, 'paint', 60, 10, 'sand');
    expect(placed).toBe(21);                                  // the 5 x 5 brush minus its corners
    await ticks(page, 80);
    const s = await S(page);
    expect(s.sand).toBe(21);
    // stacked on the floor as a column 5 wide: no sandbag outside x 58..62, none resting on air
    const shape = await page.evaluate(() => {
      const f = (window as any).__flood; const xs = new Set<number>(); let floating = 0;
      for (let x = 1; x < 119; x++) for (let y = 0; y < 67; y++) if (f.cell(x, y) === 'sand') { xs.add(x); if (f.cell(x, y + 1) === 'air') floating++; }
      return { xs: [...xs].sort((a, b) => a - b), floating, col60: f.column(60) };
    });
    expect(shape.xs).toEqual([58, 59, 60, 61, 62]);
    expect(shape.floating).toBe(0);
    expect(shape.col60.slice(62, 67)).toBe('sssss');
    // pour sandbags into a pool: they end up underneath the water, and both are conserved
    await F(page, 'sandbox');
    await F(page, 'fill', 1, 60, 118, 66, 'water');
    await F(page, 'paint', 30, 20, 'sand');
    const t = await ticks(page, 120);
    expect(t.sand).toBe(21);
    expect(t.water).toBe(118 * 7);
    expect(await F(page, 'column', 30)).toMatch(/^a+w+s+b$/);
  });

  test('left alone, the storm floods the houses on Shoal Creek', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('dry')).toHaveText('3/3');
    await expect(page.getByTestId('storm')).toHaveText('Prep');
    await page.getByTestId('rain').click();
    await expect(page.getByTestId('rain')).toBeDisabled();
    await expect(page.getByTestId('scene')).toBeFocused();   // focus moved off the disabled button
    let s = await ticks(page, 60);
    expect(s.phase).toBe('storm');
    expect(s.rained).toBeGreaterThan(40);
    s = await untilDone(page);
    expect(s.phase).toBe('done');
    expect(s.stormTick).toBe(s.rainT + s.settleT);
    expect(s.dry).toBe(0);
    expect(s.rained).toBeGreaterThan(700);
    await expect(page.getByTestId('result')).toBeVisible();
    await expect(page.getByTestId('result-stars')).toHaveText('☆☆☆');
    await expect(page.getByTestId('result-text')).toContainText('0 of 3 houses dry');
    await expect(page.getByTestId('dry')).toHaveText('0/3');
    await expect(page.getByTestId('next')).toBeFocused();
  });

  test('clearing the culvert with the keyboard and a finger keeps Shoal Creek dry', async ({ page }) => {
    await open(page);
    const before = await S(page);
    expect(before.debris).toBeGreaterThan(30);
    // keyboard: focus the scene, pick the shovel, walk the cursor to the culvert mouth and dig
    await page.getByTestId('scene').focus();
    await page.keyboard.press('2');
    await expect(page.getByTestId('tool-dig')).toHaveAttribute('aria-pressed', 'true');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown');
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
    let s = await S(page);
    expect(s.cursor).toEqual({ x: 51, y: 58 });
    await page.keyboard.press('Space');
    s = await S(page);
    expect(s.dug).toBeGreaterThan(5);
    expect(s.digLeft).toBe(before.digLeft - s.dug);
    await expect(page.getByTestId('dig-left')).toHaveText(String(s.digLeft));
    // touch: drag along the culvert
    const scene = page.getByTestId('scene'), box = (await scene.boundingBox())!;
    const at = (cx: number, cy: number) => ({ pointerId: 3, pointerType: 'touch', bubbles: true,
      clientX: box.x + ((cx + 0.5) / 120) * box.width, clientY: box.y + ((cy + 0.5) / 68) * box.height });
    await scene.dispatchEvent('pointerdown', at(53, 57));
    for (const x of [55, 57, 59]) await scene.dispatchEvent('pointermove', at(x, 57));
    await scene.dispatchEvent('pointerup', at(59, 57));
    await clearCulvert(page);                               // tidy up any corners the brush missed
    s = await S(page);
    expect(s.debris).toBeLessThan(10);
    await page.keyboard.press('r');
    s = await untilDone(page);
    expect(s.dry).toBe(3);
    expect(s.safe).toBeGreaterThan(s.rained * 0.9);
    expect(s.score).toBe(3000 + s.safe + 2 * (s.sandLeft + s.digLeft));
    await expect(page.getByTestId('result-score')).toHaveText(s.score.toLocaleString('en-US'));
    await expect(page.getByTestId('result-stars')).toHaveText('★★★');
    // on to the next creek: the overlay hides and focus goes back to the scene, not a hidden button
    await page.getByTestId('next').click();
    await expect(page.getByTestId('result')).toBeHidden();
    await expect(page.getByTestId('scene')).toBeFocused();
    s = await S(page);
    expect(s.level).toBe(1);
    expect(s.phase).toBe('prep');
    await expect(page.getByTestId('status')).toContainText('Onion Creek');
  });

  test('Bull Creek needs the culvert cleared and a levee', async ({ page }) => {
    await open(page);
    await pickLevel(page, 2);
    await clearCulvert(page);
    await page.getByTestId('rain').click();
    let s = await untilDone(page);
    expect(s.dry).toBeLessThan(3);
    // same storm, now with a sandbag wall 16 rows tall in front of the houses
    await page.getByTestId('retry').click();
    await expect(page.getByTestId('result')).toBeHidden();
    await clearCulvert(page);
    await levee(page, 16);
    s = await S(page);
    expect(s.sandUsed).toBeGreaterThan(60);
    await page.getByTestId('rain').click();
    s = await untilDone(page);
    expect(s.dry).toBe(3);
    await expect(page.getByTestId('result-stars')).toHaveText('★★★');
  });

  test('sandbags and the shovel run out, and bedrock and concrete cannot be dug', async ({ page }) => {
    await open(page);
    const lv = await page.evaluate(() => (window as any).__flood.layout.LEVELS[0]);
    let total = 0;
    for (let y = 10; y < 45 && total < lv.sand; y += 5) for (let x = 60; x < 110 && total < lv.sand; x += 5) total += await F(page, 'paint', x, y, 'sand');
    let s = await S(page);
    expect(total).toBe(lv.sand);
    expect(s.sandLeft).toBe(0);
    expect(await F(page, 'paint', 20, 5, 'sand')).toBe(0);
    await expect(page.getByTestId('status')).toHaveText('Out of sandbags.');
    await expect(page.getByTestId('sand-left')).toHaveText('0');
    // the culvert's concrete roof and the bedrock survive the shovel
    const L = await page.evaluate(() => (window as any).__flood.layout);
    const roof = L.CREEK_FLOOR - lv.culvertH - 1;
    expect(await F(page, 'cell', 70, roof)).toBe('concrete');
    await F(page, 'paint', 70, roof, 'dig');
    expect(await F(page, 'cell', 70, roof)).toBe('concrete');
    await F(page, 'paint', 30, 66, 'dig');
    expect(await F(page, 'cell', 30, 67)).toBe('bedrock');
    // dig limestone until the crew is worn out
    for (let x = 4; x < 34 && (await S(page)).digLeft > 0; x += 3) await F(page, 'paint', x, 50, 'dig');
    s = await S(page);
    expect(s.digLeft).toBe(0);
    expect(s.dug).toBe(lv.dig);
    expect(await F(page, 'paint', 10, 55, 'dig')).toBe(0);
    await expect(page.getByTestId('status')).toHaveText('The shovel crew is worn out.');
  });

  test('the storm replays exactly from a seed; pause freezes it', async ({ page }) => {
    const run = async (url: string) => {
      await open(page, url);
      await page.getByTestId('rain').click();
      await ticks(page, 300);
      return page.evaluate(() => (window as any).__flood.hash());
    };
    const a = await run(URL), b = await run(URL);
    expect(a).toBe(b);
    const others = new Set<number>();
    for (const seed of [1, 2, 3]) others.add(await run(`/lab/173-flash-flood-alley.html?seed=${seed}`));
    expect(others.size).toBe(3);
    expect(others.has(a)).toBe(false);
    // pause: the tick counter and the grid stop
    const s0 = await S(page);
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status')).toHaveText('Paused.');
    const h0 = await page.evaluate(() => (window as any).__flood.hash());
    const p = await ticks(page, 120);
    expect(p.tick).toBe(s0.tick);
    expect(p.paused).toBe(true);
    expect(await page.evaluate(() => (window as any).__flood.hash())).toBe(h0);
    expect(await F(page, 'paint', 60, 20, 'sand')).toBe(0);  // no building while paused
    await page.keyboard.press('p');
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'false');
    expect((await ticks(page, 10)).tick).toBe(s0.tick + 10);
  });
});
