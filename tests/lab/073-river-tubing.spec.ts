import { test, expect, Page } from '@playwright/test';

const URL = '/lab/073-river-tubing.html?seed=7';
const R = (page: Page) => page.evaluate(() => (window as any).__river.state);
const tick = (page: Page, n: number) => page.evaluate((n) => (window as any).__river.tick(n), n);

/** Start a float with the real-time loop detached, so every frame is stepped by the test. */
async function float(page: Page, opts: { sandbox?: boolean } = {}) {
  await page.goto(URL);
  await page.evaluate((sb) => { const r = (window as any).__river; r.manual(true); if (sb) r.sandbox(true); }, !!opts.sandbox);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('start-overlay')).toBeHidden();
  expect((await R(page)).mode).toBe('running');
}

test.describe('073 Float the River', () => {
  test('push off, float downstream and steer with the keyboard', async ({ page }) => {
    await float(page, { sandbox: true });
    const drift = await tick(page, 60);
    expect(drift.distance).toBeGreaterThanOrEqual(4); // about 5 m/s of current
    await expect(page.getByTestId('distance')).toHaveText(`${drift.distance} m`);
    await expect(page.getByTestId('score')).toHaveText(String(drift.score));
    // same seed, same frames: holding ← ends up well left of the no-input line, → well right
    const run = async (key: string | null) => {
      await page.evaluate(() => (window as any).__river.reset(true));
      if (key) await page.keyboard.down(key);
      const s = await tick(page, 40);
      if (key) await page.keyboard.up(key);
      return s.tube.x;
    };
    const none = await run(null), left = await run('ArrowLeft'), right = await run('d');
    expect(left).toBeLessThan(none - 40);
    expect(right).toBeGreaterThan(none + 40);
    // the tube never leaves the water, however long you kick
    await page.keyboard.down('ArrowLeft');
    const s = await tick(page, 240);
    await page.keyboard.up('ArrowLeft');
    const rv = await page.evaluate((y) => (window as any).__river.river(y), s.tube.y);
    expect(s.tube.x).toBeGreaterThanOrEqual(rv.c - rv.w / 2);
  });

  test('the river and its hazards are deterministic per seed', async ({ page }) => {
    await page.goto(URL);
    const layout = () => page.evaluate(() => (window as any).__river.layout(1, 8));
    const a = await layout();
    expect(a.filter((e: any) => e.kind === 'rock').length).toBeGreaterThan(5);
    expect(a.some((e: any) => e.kind === 'flip')).toBe(true);
    expect(a.some((e: any) => e.kind === 'cooler')).toBe(true); // a cooler is always placed in chunk 4
    const sim = async () => { await page.evaluate(() => { const r = (window as any).__river; r.manual(true); r.reset(true); }); return tick(page, 400); };
    const s1 = await sim();
    await page.reload();
    expect(await layout()).toEqual(a);
    const s2 = await sim();
    expect(s2.tube).toEqual(s1.tube);
    expect(s2.score).toBe(s1.score);
    await page.goto('/lab/073-river-tubing.html?seed=8');
    expect(await layout()).not.toEqual(a);
  });

  test('rocks cost a tube, a cooler buddy absorbs one hit, and three hits end the float', async ({ page }) => {
    await float(page, { sandbox: true });
    await page.evaluate(() => (window as any).__river.spawn('rock', { ahead: 90 }));
    let s = await tick(page, 60);
    expect(s.lives).toBe(2);
    expect(s.lastHit).toBe('rock');
    await expect(page.getByTestId('lives')).toHaveText('2');
    await expect(page.getByTestId('status')).toContainText('2 tubes left');
    // grab a cooler: it rides along and takes the next knock
    await tick(page, 120);
    await page.evaluate(() => (window as any).__river.spawn('cooler', { ahead: 60 }));
    s = await tick(page, 45);
    expect(s.buddy).toBe(true);
    await expect(page.getByTestId('buddy')).toHaveText('aboard');
    await page.evaluate(() => (window as any).__river.spawn('knee', { ahead: 60, r: 9 }));
    s = await tick(page, 60);
    expect(s.buddy).toBe(false);
    expect(s.lives).toBe(2);
    await expect(page.getByTestId('status')).toContainText('cooler buddy took that cypress knee');
    for (let i = 0; i < 2; i++) { await tick(page, 130); await page.evaluate(() => (window as any).__river.spawn('rock', { ahead: 70 })); await tick(page, 60); }
    s = await R(page);
    expect(s.lives).toBe(0);
    expect(s.mode).toBe('over');
    await expect(page.getByTestId('gameover')).toBeVisible();
    await expect(page.getByTestId('final-score')).toHaveText(s.score.toLocaleString('en-US'));
    await page.getByTestId('restart').click();
    await expect(page.getByTestId('gameover')).toBeHidden();
    await expect(page.getByTestId('lives')).toHaveText('3');
  });

  test('flip-flops score, and ducking passes under a low branch that otherwise hits', async ({ page }) => {
    await float(page, { sandbox: true });
    await page.evaluate(() => { const r = (window as any).__river; r.spawn('flip', { ahead: 60 }); r.spawn('flip', { ahead: 140 }); });
    let s = await tick(page, 90);
    expect(s.flips).toBe(2);
    expect(s.bonus).toBe(50);
    await expect(page.getByTestId('flips')).toHaveText('2');
    // a branch without ducking: a hit
    await page.evaluate(() => (window as any).__river.spawn('branch', { ahead: 60 }));
    s = await tick(page, 60);
    expect(s.lives).toBe(2);
    expect(s.lastHit).toBe('low branch');
    await tick(page, 120);
    // the same branch, ducking with Space just before it: limbo bonus, no hit
    await page.evaluate(() => (window as any).__river.spawn('branch', { ahead: 50 }));
    await tick(page, 10);
    await page.keyboard.press('Space');
    s = await tick(page, 50);
    expect(s.lives).toBe(2);
    expect(s.limbo).toBe(1);
    expect(s.bonus).toBe(65);
    await expect(page.getByTestId('status')).toContainText('Limbo');
  });

  test('rapids speed you up and pay out when cleared; eddies stall you', async ({ page }) => {
    await float(page, { sandbox: true });
    const calm = await tick(page, 60);
    await page.evaluate(() => (window as any).__river.spawn('rapid', { ahead: 20, len: 260 }));
    const inRapid = await tick(page, 60);
    expect(inRapid.inRapid).toBe(true);
    expect(inRapid.tube.vy).toBeGreaterThan(calm.tube.vy * 1.5);
    await expect(page.getByTestId('status')).toContainText('Rapids');
    const out = await tick(page, 120);
    expect(out.inRapid).toBe(false);
    expect(out.rapidsCleared).toBe(1);
    expect(out.bonus).toBe(40);
    // an eddy centred on the tube's line slows the forward current
    const flowIn = await page.evaluate(() => { const r = (window as any).__river, t = r.state.tube; r.spawn('eddy', { ahead: 0, x: t.x + 12, r: 60 }); return r.flowAt(t.x, t.y); });
    expect(flowIn.eddy).toBe(true);
    expect(flowIn.vy).toBeLessThan(out.flow.vy * 0.8);
  });

  test('dragging on the river pulls the tube toward the pointer, and pause freezes the float', async ({ page }) => {
    await float(page, { sandbox: true });
    const c = page.getByTestId('canvas');
    const box = (await c.boundingBox())!;
    const x0 = (await R(page)).tube.x;
    const cx = box.x + box.width * 0.92, cy = box.y + box.height * 0.7;
    await c.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy, isPrimary: true, bubbles: true });
    await c.dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy - 10, isPrimary: true, bubbles: true });
    const s = await tick(page, 50);
    await c.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy, isPrimary: true, bubbles: true });
    expect(s.tube.x).toBeGreaterThan(x0 + 40);
    await page.getByTestId('pause').click();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    const p1 = await tick(page, 30);
    expect(p1.mode).toBe('paused');
    expect(p1.tube.y).toBe(s.tube.y);
    await page.getByTestId('resume').click();
    const p2 = await tick(page, 30);
    expect(p2.tube.y).toBeGreaterThan(s.tube.y);
  });
});
