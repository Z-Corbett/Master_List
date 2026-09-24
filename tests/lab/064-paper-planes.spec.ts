import { test, expect, Page } from '@playwright/test';

const URL = '/lab/064-paper-planes.html?seed=4';
const planes = (page: Page) => page.evaluate(() => (window as any).__planes.state);

/** Search designs and throws with the page's own deterministic simulator for one that satisfies `cond`. */
function findThrow(page: Page, cond: string) {
  return page.evaluate((cond) => {
    const P = (window as any).__planes, ok = new Function('r', `return ${cond}`) as (r: any) => boolean;
    for (const style of ['dart', 'glider', 'stunt']) for (const clips of [0, 1, 2, 3]) for (const span of [16, 20, 26]) for (const sweep of [10, 25])
      for (const angle of [-5, 0, 5, 10, 20, 30, 40]) for (const speed of [4, 6, 8, 10, 12]) {
        const r = P.simulate({ style, clips, span, sweep }, { angle, speed });
        if (ok(r)) return { d: { style, clips, span, sweep }, l: { angle, speed }, r };
      }
    return null;
  }, cond);
}
async function throwWith(page: Page, found: any) {
  await page.getByTestId(`style-${found.d.style}`).click();
  await page.getByTestId(`clips-${found.d.clips}`).click();
  await page.getByTestId('span').fill(String(found.d.span));
  await page.getByTestId('sweep').fill(String(found.d.sweep));
  await page.getByTestId('angle').fill(String(found.l.angle));
  await page.getByTestId('speed').fill(String(found.l.speed));
  await page.getByTestId('throw').click();
}

test.describe('064 Paper Planes', () => {
  test('the design sheet: fold style, clips, span and sweep drive the derived numbers', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('style-glider').click();
    await expect(page.getByTestId('style-glider')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('style-dart')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('clips-3').click();
    await page.getByTestId('span').fill('25');
    await page.getByTestId('sweep').fill('30');
    await expect(page.getByTestId('span-out')).toHaveText('25 cm');
    await expect(page.getByTestId('sweep-out')).toHaveText('30°');
    // glider chord 12 cm: area = 25 × 12 = 300 cm², aspect ratio = 25² / 300 ≈ 2.1, mass = 5 g + 3 clips
    await expect(page.getByTestId('derived')).toContainText('wing area 300 cm² · aspect ratio 2.1');
    await expect(page.getByTestId('derived')).toContainText('mass 8 g');
    await expect(page.getByTestId('preview')).toHaveAttribute('aria-label', 'Top view: Glider, 25 cm span, 30 degree sweep, 3 paper clips');
    await expect(page.getByTestId('preview').locator('rect')).toHaveCount(3); // the three clips are drawn
    // more nose weight lowers the trim angle and raises stability
    const [light, heavy] = await page.evaluate(() => { const P = (window as any).__planes; return [P.derive({ clips: 0 }), P.derive({ clips: 3 })]; });
    expect(heavy.trim).toBeLessThan(light.trim);
    expect(heavy.stab).toBeGreaterThan(light.stab);
    await expect(page.getByTestId('model-note')).toContainText('simplified flight model');
  });

  test('flights are deterministic per seed and behave sensibly', async ({ page }) => {
    await page.goto(URL);
    const run = () => page.evaluate(() => { const P = (window as any).__planes; return [P.simulate({ style: 'dart', clips: 1, span: 20, sweep: 20 }, { angle: 10, speed: 7 }), P.wind]; });
    const [a, wa] = await run();
    const [b] = await run();
    expect(b).toEqual(a);
    await page.goto('/lab/064-paper-planes.html?seed=5');
    const [c, wc] = await run();
    expect(wc).not.toEqual(wa);
    expect(c).not.toEqual(a);
    await page.goto(URL);
    const s = await page.evaluate(() => {
      const P = (window as any).__planes, d = { style: 'dart', clips: 1, span: 20, sweep: 20 };
      return { soft: P.simulate(d, { angle: 5, speed: 4 }), hard: P.simulate(d, { angle: 5, speed: 10 }), dive: P.simulate({ ...d, clips: 3 }, { angle: -10, speed: 4 }), stunt: P.simulate({ style: 'stunt', clips: 2, span: 16, sweep: 15 }, { angle: 20, speed: 9 }) };
    });
    expect(s.hard.distance).toBeGreaterThan(s.soft.distance);
    expect(s.dive.hang).toBeLessThan(1); // a nose-heavy plane thrown downward falls fast from 1.8 m
    expect(s.stunt.loops).toBeGreaterThanOrEqual(1); // flaps up + speed = a loop
    for (const r of [s.soft, s.hard, s.dive, s.stunt]) { expect(r.hang).toBeGreaterThan(0); expect(r.maxY).toBeGreaterThanOrEqual(1.8); }
  });

  test('a throw scores distance and hang time, and only a better throw replaces the best (with its ghost)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await page.getByTestId('angle').fill('10');
    await page.getByTestId('speed').fill('7');
    const expected = await page.evaluate(() => (window as any).__planes.simulate({}, {}));
    await page.getByTestId('throw').click();
    await expect(page.getByTestId('distance')).toHaveText(`${expected.distance.toFixed(2)} m`);
    await expect(page.getByTestId('hang')).toHaveText(`${expected.hang.toFixed(2)} s`);
    await expect(page.getByTestId('loops')).toHaveText(String(expected.loops));
    await expect(page.getByTestId('best')).toHaveText(`${expected.distance.toFixed(2)} m`);
    await expect(page.getByTestId('throws')).toHaveText('1');
    await expect(page.getByTestId('event')).toContainText('New best!');
    await expect(page.getByTestId('sky')).toHaveAttribute('aria-label', new RegExp(`Last throw: ${expected.distance.toFixed(2)} metres`));

    // a feeble throw does not replace the record
    await page.getByTestId('speed').fill('3');
    await page.getByTestId('angle').fill('-10');
    await page.getByTestId('throw').click();
    await expect(page.getByTestId('throws')).toHaveText('2');
    const st = await planes(page);
    expect(st.last.distance).toBeLessThan(expected.distance);
    expect(st.best.distance).toBe(expected.distance);
    expect(st.best.points).toBeGreaterThan(5);
    await expect(page.getByTestId('best')).toHaveText(`${expected.distance.toFixed(2)} m`);
    await page.getByTestId('ghost').click();
    await expect(page.getByTestId('ghost')).toHaveAttribute('aria-pressed', 'false');
    // the best flight is remembered for this seed
    await page.reload();
    await expect(page.getByTestId('best')).toHaveText(`${expected.distance.toFixed(2)} m`);
  });

  test('all four target challenges can be completed and stay ticked', async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    const conds: Record<string, string> = {
      bullseye: 'r.distance >= 12.3 && r.distance <= 13.7',
      hang: 'r.hang >= 3.7',
      loop: 'r.loops >= 1 && r.distance >= 3.3',
      net: 'r.netOk && r.distance > 9',
    };
    for (const [id, cond] of Object.entries(conds)) {
      await expect(page.getByTestId(`ch-${id}`)).toHaveAttribute('data-done', 'false');
      const found = await findThrow(page, cond);
      expect(found, `a throw exists for ${id}`).not.toBeNull();
      await throwWith(page, found);
      await expect(page.getByTestId('distance')).toHaveText(`${found!.r.distance.toFixed(2)} m`);
      await expect(page.getByTestId(`ch-${id}`)).toHaveAttribute('data-done', 'true');
    }
    await page.reload();
    for (const id of Object.keys(conds)) await expect(page.getByTestId(`ch-${id}`)).toHaveAttribute('data-done', 'true');
  });

  test('the animated flight runs on the clock, and dragging on the field aims and throws', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-05-01T15:00:00') });
    await page.clock.pauseAt(new Date('2026-05-01T15:00:01'));
    await page.goto(URL);
    const exp = await page.evaluate(() => (window as any).__planes.simulate({}, {}));
    await page.getByTestId('throw').click();
    await expect(page.getByTestId('throw')).toBeDisabled();
    await page.clock.runFor(500);
    await expect(page.getByTestId('hud')).toHaveText(/m high · 0\.\d s$/);
    expect((await planes(page)).flying).toBe(true);
    await page.clock.runFor(Math.ceil(exp.hang * 1000) + 300);
    await expect(page.getByTestId('hud')).toHaveText(`Landed at ${exp.distance.toFixed(2)} m after ${exp.hang.toFixed(2)} s`);
    await expect(page.getByTestId('throw')).toBeEnabled();

    // slingshot: pull down-left from a point on the field to aim up-right
    await page.getByTestId('instant').click();
    const box = (await page.getByTestId('sky').boundingBox())!;
    const x0 = box.x + box.width * 0.5, y0 = box.y + box.height * 0.4;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 - 90, y0 + 50, { steps: 5 });
    await page.mouse.up();
    const st = await planes(page);
    expect(st.launch.angle).toBe(Math.round(Math.atan2(50, 90) * 180 / Math.PI));
    expect(st.launch.speed).toBeGreaterThan(7);
    await expect(page.getByTestId('angle-out')).toHaveText(`${st.launch.angle}°`);
    await expect(page.getByTestId('throws')).toHaveText('2');
  });
});
