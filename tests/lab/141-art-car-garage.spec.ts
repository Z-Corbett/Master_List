import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/lab/141-art-car-garage.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__artcar.state);
const DATA = (page: Page, id: string) => page.evaluate((id) => (window as any).__artcar.data(id), id);
const HASH = (page: Page) => page.evaluate(() => (window as any).__artcar.hash());
const IDS = ['paint', 'mosaic', 'caps', 'flames', 'eyes', 'addons'];

async function allData(page: Page) {
  const out: Record<string, unknown> = {};
  for (const id of IDS) out[id] = await DATA(page, id);
  return out;
}

test.describe('141 Art Car Garage', () => {
  test('six layers render bottom to top in stack order, and the canvas is described', async ({ page }) => {
    await page.goto(URL);
    const s = await S(page);
    expect(s.seed).toBe(7);
    expect(s.order).toEqual(IDS);
    expect(s.renderLog).toEqual(IDS);                                      // drawn in exactly this order
    // the list shows the top of the stack first
    const listed = await page.locator('#stack li').evaluateAll((els) => els.map((e) => e.getAttribute('data-layer')));
    expect(listed).toEqual([...IDS].reverse());
    await expect(page.getByTestId('canvas')).toHaveAttribute('aria-label', /^A sedan decorated, bottom to top, with \w+ paint, \d+ mosaic tiles, \d+ bottle caps, \d+ flames, \d+ googly eyes, /);
    await expect(page.getByTestId('seed')).toHaveText('seed 7');
    await expect(page.getByTestId('down-paint')).toBeDisabled();
    await expect(page.getByTestId('up-addons')).toBeDisabled();
  });

  test('reordering changes the draw order and the pixels; moving back restores the exact image', async ({ page }) => {
    await page.goto(URL);
    const before = await HASH(page);
    for (let i = 0; i < 5; i++) await page.getByTestId('up-paint').click();
    let s = await S(page);
    expect(s.order).toEqual(['mosaic', 'caps', 'flames', 'eyes', 'addons', 'paint']);
    expect(s.renderLog.at(-1)).toBe('paint');
    await expect(page.getByTestId('status')).toHaveText('Paint job moved up.');
    // paint on top covers the bodywork layers, so the image must change
    const onTop = await HASH(page);
    expect(onTop).not.toBe(before);
    await expect(page.locator('#stack li').first()).toHaveAttribute('data-layer', 'paint');
    // at the top "Up" is disabled, so focus lands on the same layer's "Down" for keyboard users
    await expect(page.getByTestId('down-paint')).toBeFocused();
    for (let i = 0; i < 5; i++) await page.getByTestId('down-paint').click();
    s = await S(page);
    expect(s.renderLog).toEqual(IDS);
    expect(await HASH(page)).toBe(before);
    // a single swap is reflected in the render log straight away
    await page.getByTestId('up-mosaic').click();
    expect((await S(page)).renderLog).toEqual(['paint', 'caps', 'mosaic', 'flames', 'eyes', 'addons']);
  });

  test('hidden layers are skipped by the renderer', async ({ page }) => {
    await page.goto(URL);
    const before = await HASH(page);
    await page.getByTestId('hide-flames').click();
    await expect(page.getByTestId('hide-flames')).toHaveAttribute('aria-pressed', 'true');
    expect((await S(page)).renderLog).toEqual(['paint', 'mosaic', 'caps', 'eyes', 'addons']);
    expect(await HASH(page)).not.toBe(before);
    await page.getByTestId('hide-flames').click();
    expect(await HASH(page)).toBe(before);
  });

  test('reroll changes only the unlocked layers', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('lock-paint').click();
    await page.getByTestId('lock-eyes').click();
    await expect(page.getByTestId('lock-eyes')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('reroll-eyes')).toBeDisabled();
    const s0 = await S(page), d0 = await allData(page), h0 = await HASH(page);
    await page.getByTestId('reroll-all').click();
    await expect(page.getByTestId('status')).toHaveText('Rerolled 4 unlocked layers.');
    const s1 = await S(page), d1 = await allData(page);
    for (const id of IDS) {
      const a = s0.layers.find((l: any) => l.id === id), b = s1.layers.find((l: any) => l.id === id);
      if (id === 'paint' || id === 'eyes') { expect(b.seed, id).toBe(a.seed); expect(d1[id], id).toEqual(d0[id]); }
      else { expect(b.seed, id).not.toBe(a.seed); expect(d1[id], id).not.toEqual(d0[id]); }
    }
    expect(s1.rerolls).toBe(4);
    expect(s1.order).toEqual(s0.order);                                    // reroll never reorders
    expect(await HASH(page)).not.toBe(h0);
    // a single-layer reroll touches one layer only
    await page.getByTestId('reroll-caps').click();
    const d2 = await allData(page);
    for (const id of IDS) if (id === 'caps') expect(d2[id]).not.toEqual(d1[id]); else expect(d2[id], id).toEqual(d1[id]);
    // everything locked: nothing changes
    for (const id of ['mosaic', 'caps', 'flames', 'addons']) await page.getByTestId(`lock-${id}`).click();
    await page.getByTestId('reroll-all').click();
    await expect(page.getByTestId('status')).toHaveText('Every layer is locked, so nothing changed.');
    expect(await allData(page)).toEqual(d2);
  });

  test('deterministic per seed, including the reroll sequence; other seeds differ', async ({ page }) => {
    await page.goto(URL);
    const a = { s: await S(page), d: await allData(page), h: await HASH(page) };
    await page.getByTestId('reroll-all').click();
    const afterReroll = { s: await S(page), h: await HASH(page) };
    await page.reload();
    expect((await S(page)).layers).toEqual(a.s.layers);
    expect(await allData(page)).toEqual(a.d);
    expect(await HASH(page)).toBe(a.h);                                     // pixel-identical
    await page.getByTestId('reroll-all').click();
    expect((await S(page)).layers).toEqual(afterReroll.s.layers);
    expect(await HASH(page)).toBe(afterReroll.h);
    await page.goto('/lab/141-art-car-garage.html?seed=8');
    const b = await S(page);
    expect(b.layers.map((l: any) => l.seed)).not.toEqual(a.s.layers.map((l: any) => l.seed));
    expect(await HASH(page)).not.toBe(a.h);
    // New car seed writes a new, reproducible seed to the URL
    await page.getByTestId('new-seed').click();
    const n = (await S(page)).seed;
    await expect(page).toHaveURL(new RegExp(`seed=${n}$`));
    const h = await HASH(page);
    await page.reload();
    expect(await HASH(page)).toBe(h);
  });

  test('decorations respect the car: caps and tiles inside its box, eyes never overlap, seeds survive a car swap', async ({ page }) => {
    await page.goto(URL);
    const seeds = (await S(page)).layers.map((l: any) => l.seed);
    const boxes: Record<string, number[]> = { sedan: [110, 208, 858, 410], pickup: [100, 212, 862, 410], bug: [135, 175, 830, 410], bus: [70, 170, 890, 410] };
    for (const car of ['pickup', 'bug', 'bus', 'sedan']) {
      await page.getByTestId(`car-${car}`).check();
      const s = await S(page);
      expect(s.car).toBe(car);
      expect(s.layers.map((l: any) => l.seed)).toEqual(seeds);
      const [x0, y0, x1, y1] = boxes[car];
      const caps = (await DATA(page, 'caps')).caps;
      expect(caps.length).toBeGreaterThan(10);
      caps.forEach((c: any) => { expect(c.x).toBeGreaterThanOrEqual(x0); expect(c.x).toBeLessThanOrEqual(x1); expect(c.y).toBeGreaterThanOrEqual(y0); expect(c.y).toBeLessThanOrEqual(y1); });
      const m = await DATA(page, 'mosaic');
      expect(m.tiles.length).toBeGreaterThan(5);
      m.tiles.forEach((t: any) => { expect(t.x).toBeGreaterThanOrEqual(x0 - m.size); expect(t.x + m.size).toBeLessThanOrEqual(x1 + m.size); });
      const eyes = (await DATA(page, 'eyes')).eyes;
      expect(eyes.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < eyes.length; i++) for (let j = i + 1; j < eyes.length; j++) {
        expect(Math.hypot(eyes[i].x - eyes[j].x, eyes[i].y - eyes[j].y)).toBeGreaterThanOrEqual(eyes[i].r + eyes[j].r);
      }
      const add = (await DATA(page, 'addons')).items;
      expect(add.length).toBeGreaterThanOrEqual(1);
      add.forEach((i: any) => expect(['horns', 'fins', 'armadillo']).toContain(i.kind));
    }
    await expect(page.getByTestId('status')).toHaveText('Now decorating a sedan. Layer seeds kept.');
    // every add-on kind turns up across seeds, including the giant armadillo
    const kinds = new Set<string>();
    for (let sd = 1; sd <= 30; sd++) (await page.evaluate((sd) => (window as any).__artcar.generate('addons', 'sedan', sd), sd)).items.forEach((i: any) => kinds.add(i.kind));
    expect([...kinds].sort()).toEqual(['armadillo', 'fins', 'horns']);
  });

  test('parade mode under page.clock: the car rolls across without slipping, confetti falls, then back to the garage', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-04-18T15:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-04-18T15:00:02Z'));
    const { PARADE_MS, CAR_W, W, r } = await page.evaluate(() => { const a = (window as any).__artcar; return { PARADE_MS: a.PARADE_MS, CAR_W: a.CAR_W, W: a.W, r: a.wheelRadius() }; });
    await page.getByTestId('parade').click();
    await expect(page.getByTestId('parade')).toHaveAttribute('aria-pressed', 'true');
    let p = (await S(page)).parade;
    expect(p).toMatchObject({ running: true, p: 0, carX: -CAR_W, confetti: 0 });
    await page.clock.runFor(PARADE_MS / 2);
    p = (await S(page)).parade;
    expect(p.p).toBeGreaterThan(0.48);
    expect(p.p).toBeLessThanOrEqual(0.5);
    expect(p.carX).toBeCloseTo(-CAR_W + p.p * (W + CAR_W), 6);             // linear across the whole width
    expect(p.wheelAngle).toBeCloseTo((p.carX + CAR_W) / r, 6);            // arc length = distance travelled
    expect(p.confetti).toBeGreaterThan(20);
    const mid = p.confetti;
    await page.clock.runFor(PARADE_MS / 4);
    p = (await S(page)).parade;
    expect(p.confetti).toBeGreaterThan(mid);
    await page.clock.runFor(PARADE_MS / 2);
    p = (await S(page)).parade;
    expect(p).toMatchObject({ running: false, p: 1, carX: W });
    await expect(page.getByTestId('status')).toHaveText('Parade complete. Back in the garage.');
    await expect(page.getByTestId('parade')).toHaveText('Start the parade');
    // and it can be stopped early
    await page.getByTestId('parade').click();
    await page.clock.runFor(1000);
    await page.getByTestId('parade').click();
    await expect(page.getByTestId('status')).toHaveText('Parade stopped.');
    const stopped = (await S(page)).parade;
    await page.clock.runFor(3000);
    expect((await S(page)).parade).toEqual(stopped);
  });

  test('export saves a 960 × 540 PNG named for the car and seed', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('car-bus').check();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
    expect(download.suggestedFilename()).toBe('art-car-bus-seed-7.png');
    const buf = readFileSync((await download.path())!);
    expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);   // PNG signature
    expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(buf.readUInt32BE(16)).toBe(960);
    expect(buf.readUInt32BE(20)).toBe(540);
    await expect(page.getByTestId('status')).toHaveText('Exported art-car-bus-seed-7.png (960 × 540).');
  });

  test('keyboard: car radios, stack buttons and parade all work without a pointer', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('car-sedan').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('car-pickup')).toBeChecked();
    expect((await S(page)).car).toBe('pickup');
    await page.getByTestId('up-eyes').focus();
    await page.keyboard.press('Enter');
    expect((await S(page)).order).toEqual(['paint', 'mosaic', 'caps', 'flames', 'addons', 'eyes']);
    await expect(page.getByTestId('down-eyes')).toBeFocused();              // Up is now disabled at the top
    await page.keyboard.press('Space');
    expect((await S(page)).order).toEqual(IDS);
    await expect(page.getByTestId('down-eyes')).toBeFocused();
    await page.getByTestId('lock-caps').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('lock-caps')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('lock-caps')).toBeFocused();
  });
});
