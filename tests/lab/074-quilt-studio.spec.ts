import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/lab/074-quilt-studio.html?seed=3';
const Q = (page: Page) => page.evaluate(() => (window as any).__quilt.state);
async function clickBlock(page: Page, i: number) {
  const pt = await page.evaluate((i) => (window as any).__quilt.blockClientPoint(i), i);
  await page.getByTestId('quilt').click({ position: pt });
}

test.describe('074 Quilt Studio', () => {
  test('block patterns tile the square exactly, with the right share of each fabric', async ({ page }) => {
    await page.goto(URL);
    const cov = await page.evaluate(() => (window as any).__quilt.patternCoverage());
    for (const k of ['nine', 'cabin', 'geese', 'hst', 'ohio']) expect(cov[k].total).toBeCloseTo(1, 9);
    // nine-patch: four background squares, four corner squares and a centre
    expect(cov.nine.byRole[0]).toBeCloseTo(4 / 9, 9);
    expect(cov.nine.byRole[1]).toBeCloseTo(4 / 9, 9);
    expect(cov.nine.byRole[2]).toBeCloseTo(1 / 9, 9);
    // Ohio star: 4 corners + 8 background triangles = 6/9, eight star points = 2/9, centre = 1/9
    expect(cov.ohio.byRole[0]).toBeCloseTo(6 / 9, 9);
    expect(cov.ohio.byRole[1]).toBeCloseTo(2 / 9, 9);
    // flying geese: each goose is half its unit
    expect(cov.geese.byRole[0]).toBeCloseTo(0.5, 9);
    // log cabin, 0.1-wide logs round a 0.2 hearth: in each round the two light logs are laid first, so they are
    // shorter; light = Σ(4a + w)·w = 0.44, dark = Σ(4a + 3w)·w = 0.52 for a = 0.1…0.4
    expect(cov.cabin.byRole[3]).toBeCloseTo(0.04, 9);
    expect(cov.cabin.byRole[0]).toBeCloseTo(0.44, 9);
    expect(cov.cabin.byRole[1] + cov.cabin.byRole[2]).toBeCloseTo(0.52, 9);
  });

  test('settings drive the finished size, and every layout is fully covered by fabric', async ({ page }) => {
    await page.goto(URL);
    // 4 × 5 blocks at 12 in plus a 4 in border
    await expect(page.getByTestId('size-out')).toContainText('56 × 68 in');
    await expect(page.getByTestId('block-count')).toContainText('20 blocks');
    const covered = async () => { const a = await page.evaluate(() => (window as any).__quilt.areas()); expect(a.sum).toBeCloseTo(a.total, 6); return a; };
    await covered();
    await page.getByTestId('layout').selectOption('sashing');
    await expect(page.getByTestId('size-out')).toContainText('66 × 80 in'); // 4·12 + 5·2 + 8, 5·12 + 6·2 + 8
    await covered();
    await page.getByTestId('layout').selectOption('onpoint');
    // on point each block takes its diagonal: 12√2 ≈ 16.97 in
    await expect(page.getByTestId('size-out')).toContainText('75.9 × 92.9 in');
    await expect(page.getByTestId('block-count')).toContainText('32 blocks on point'); // 20 + 4 × 3 in between
    const onpoint = await covered();
    // setting triangles are cut from the background fabric
    expect(onpoint.finished[0]).toBeGreaterThan(await page.evaluate(() => 32 * 144 * 0.3));
    await page.getByTestId('borders').uncheck();
    await expect(page.getByTestId('size-out')).toContainText('67.9 × 84.9 in');
    await page.getByTestId('rows').fill('3');
    await page.getByTestId('block-size').selectOption('8');
    expect((await Q(page)).blocks.length).toBe(3 * 4 + 2 * 3);
    await covered();
    await expect(page.getByTestId('quilt')).toHaveAttribute('aria-label', /18 blocks on point/);
  });

  test('clicking a block turns it, swaps its fabrics or stamps a new block; on-point clicks hit the right diamond', async ({ page }) => {
    await page.goto(URL);
    await clickBlock(page, 5);
    let s = await Q(page);
    expect(s.blocks[5].rot).toBe(1);
    expect(s.blocks.filter((b: any) => b.rot).length).toBe(1);
    await expect(page.getByTestId('status')).toHaveText('Block 6 turned to 90°.');
    const before = s.blocks[7].perm;
    await page.getByTestId('tool-swap').click();
    await expect(page.getByTestId('tool-swap')).toHaveAttribute('aria-pressed', 'true');
    await clickBlock(page, 7);
    s = await Q(page);
    expect(s.blocks[7].perm).toEqual([0, before[3], before[1], before[2]]);
    await page.getByTestId('pattern-nine').click();
    await page.getByTestId('pattern-ohio').click(); // current stamp: Ohio star (already on all blocks)
    await page.getByTestId('pattern-sampler').click();
    await page.getByTestId('tool-stamp').click();
    const was = (await Q(page)).blocks[2].pattern;
    await clickBlock(page, 2);
    expect((await Q(page)).blocks[2].pattern).not.toBe(was);
    // on point: an in-between diamond (index 20 is the first of those)
    await page.getByTestId('layout').selectOption('onpoint');
    await page.getByTestId('tool-rotate').click();
    await clickBlock(page, 20);
    await expect(page.getByTestId('status')).toHaveText('Block 21 turned to 90°.');
  });

  test('keyboard: arrows move the selection, Enter applies the tool, S swaps', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('quilt').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('status')).toContainText('Block 6 of 20 selected');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    let s = await Q(page);
    expect(s.sel).toBe(5);
    expect(s.blocks[5].rot).toBe(2);
    const p = s.blocks[5].perm;
    await page.keyboard.press('s');
    s = await Q(page);
    expect(s.blocks[5].perm).toEqual([0, p[3], p[1], p[2]]);
    await page.getByTestId('reset-rot').click();
    expect((await Q(page)).blocks.every((b: any) => b.rot === 0)).toBe(true);
  });

  test('fabric order is seeded: the same seed gives the same quilt and the same shuffles', async ({ page }) => {
    const run = async (url: string) => {
      await page.goto(url);
      const a = (await Q(page)).blocks.map((b: any) => b.perm);
      const sigA = await page.evaluate(() => (window as any).__quilt.signature());
      await page.getByTestId('shuffle').click();
      await expect(page.getByTestId('status')).toHaveText('Fabrics shuffled (1).');
      const b = (await Q(page)).blocks.map((b: any) => b.perm);
      const sigB = await page.evaluate(() => (window as any).__quilt.signature());
      return { a, b, sigA, sigB };
    };
    const one = await run(URL), two = await run(URL), other = await run('/lab/074-quilt-studio.html?seed=4');
    expect(two).toEqual(one);
    expect(one.b).not.toEqual(one.a);
    expect(one.sigB).not.toBe(one.sigA);
    expect(other.a).not.toEqual(one.a);
    // each block uses three different accent fabrics from the bundle of five
    for (const perm of one.b) { expect(perm[0]).toBe(0); expect(new Set(perm.slice(1)).size).toBe(3); for (const f of perm.slice(1)) { expect(f).toBeGreaterThanOrEqual(1); expect(f).toBeLessThanOrEqual(5); } }
    await page.getByTestId('palette-bluebonnet').click();
    await expect(page.getByTestId('palette-bluebonnet')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('yardage')).toContainText('Bluebonnet ditsy');
  });

  test('yardage is labelled approximate, in eighths, and follows the design; quilting and PNG export', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('yardage-note')).toContainText('rough estimate');
    const rows = await page.evaluate(() => (window as any).__quilt.yardage());
    for (const r of rows) expect(Number.isInteger(r.yards * 8)).toBe(true);
    await expect(page.getByTestId('yardage')).toContainText('Backing');
    await expect(page.getByTestId('yardage')).toContainText('Binding');
    const muslin = rows.find((r: any) => r.name === 'Unbleached muslin');
    await page.getByTestId('borders').uncheck();
    await expect(page.getByTestId('yardage')).not.toContainText('Binding');
    await page.getByTestId('layout').selectOption('onpoint');
    const onpoint = (await page.evaluate(() => (window as any).__quilt.yardage())).find((r: any) => r.name === 'Unbleached muslin');
    expect(onpoint.yards).toBeGreaterThan(muslin.yards); // setting triangles need more background
    // quilting lines change the picture; none leaves just the top
    const sig = () => page.evaluate(() => (window as any).__quilt.signature());
    const cross = await sig();
    await page.getByTestId('quilting').selectOption('none');
    const none = await sig();
    await page.getByTestId('quilting').selectOption('meander');
    expect(await sig()).not.toBe(none);
    expect(none).not.toBe(cross);
    const dlP = page.waitForEvent('download');
    await page.getByTestId('export').click();
    const dl = await dlP;
    expect(dl.suggestedFilename()).toBe('quilt-cabin-onpoint-3.png');
    const bytes = readFileSync(await dl.path());
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
