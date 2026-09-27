import { test, expect, Page } from '@playwright/test';

const URL = '/lab/118-trace-replay.html';
const state = (page: Page) => page.evaluate(() => (window as any).__trace.state);
const actions = (page: Page) => page.evaluate(() => (window as any).__trace.actions);

// The recorded run, written out by hand from the fixture's story: step, verb, duration (ms).
const EXPECTED = [
  [1, 'goto', 612], [2, 'click', 348], [3, 'click', 231], [4, 'click', 402], [5, 'expect', 64],
  [6, 'fill', 118], [7, 'fill', 96], [8, 'click', 540], [9, 'expect', 5000],
] as const;
const TOTAL = EXPECTED.reduce((a, [, , d]) => a + d, 0);        // 7411 ms

test.describe('118 Trace Replay', () => {
  test('timeline: durations add up to the run, steps are back to back, and segments are drawn to scale', async ({ page }) => {
    await page.goto(URL);
    expect(TOTAL).toBe(7411);
    const A = await actions(page);
    expect(A.map((a: any) => [a.i, a.type, a.dur])).toEqual(EXPECTED.map((e) => [...e]));
    expect(await page.evaluate(() => (window as any).__trace.total)).toBe(TOTAL);
    let t = 0;
    for (const a of A) { expect(a.start, `step ${a.i} starts where the last ended`).toBe(t); t += a.dur; }
    await expect(page.getByTestId('total')).toHaveText('9 actions · 7.41 s');
    await expect(page.getByTestId('action-9')).toContainText('5.00 s');
    await expect(page.getByTestId('action-5')).toContainText('64 ms');
    // on screen: each segment's width and offset are its share of the track
    const track = (await page.getByTestId('timeline').boundingBox())!;
    for (const [i, , dur] of EXPECTED) {
      const box = (await page.getByTestId(`seg-${i}`).boundingBox())!;
      const start = A[i - 1].start;
      expect(Math.abs(box.width - (track.width * dur) / TOTAL), `seg ${i} width`).toBeLessThan(1.5);
      expect(Math.abs(box.x - track.x - (track.width * start) / TOTAL), `seg ${i} left`).toBeLessThan(1.5);
    }
    await page.getByTestId('action-9').click();
    await expect(page.getByTestId('playhead')).toHaveText('7.41 s of 7.41 s');
    await page.getByTestId('action-3').click();
    await expect(page.getByTestId('playhead')).toHaveText(`${((612 + 348 + 231) / 1000).toFixed(2)} s of 7.41 s`);
  });

  test('before and after snapshots switch, and show what the action changed', async ({ page }) => {
    await page.goto(`${URL}#step=3`);
    const before = page.getByTestId('snap-before').frameLocator('iframe');
    const after = page.getByTestId('snap-after').frameLocator('iframe');
    // "After" is the default tab
    await expect(page.getByTestId('snap-after')).toBeVisible();
    await expect(page.getByTestId('snap-before')).toBeHidden();
    await expect(after.getByText('Cart (1)')).toBeVisible();
    await expect(after.locator('[data-hl]')).toHaveText('Added ✓');
    await page.getByTestId('tab-before').click();
    await expect(page.getByTestId('tab-before')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('snap-after')).toBeHidden();
    await expect(before.getByText('Cart (0)')).toBeVisible();
    await expect(before.locator('[data-hl]')).toHaveText('Add Hojicha to cart');   // the click target is outlined
    expect(page.url()).toContain('#step=3&snap=before');
    // side by side shows both at once
    await page.getByTestId('side-by-side').click();
    await expect(page.getByTestId('side-by-side')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('snap-before')).toBeVisible();
    await expect(page.getByTestId('snap-after')).toBeVisible();
    // the fill steps: the value appears only after
    await page.getByTestId('action-7').click();
    await expect(before.locator('#p')).toHaveValue('');
    await expect(after.locator('#p')).toHaveValue('LEAF10');
    await expect(after.locator('#e')).toHaveValue('guest@example.test');
    // the first goto starts from a blank page
    await page.getByTestId('action-1').click();
    await expect(before.locator('body')).toHaveText('about:blank');
    await expect(after.getByRole('heading', { name: 'Loose-leaf tea, roasted slow.' })).toBeVisible();
  });

  test('snapshots are inert: a sandboxed frame with no scripts', async ({ page }) => {
    await page.goto(`${URL}#step=8`);
    for (const id of ['snap-before', 'snap-after']) {
      const f = page.getByTestId(id).locator('iframe');
      await expect(f).toHaveAttribute('sandbox', '');
      expect(await f.getAttribute('srcdoc')).not.toMatch(/<script/i);
    }
    await expect(page.getByTestId('snap-after').frameLocator('iframe').getByRole('alert')).toHaveText('This code has expired.');
  });

  test('network filters: type, errors only, URL text and scope all change the count', async ({ page }) => {
    await page.goto(URL);
    const A = await actions(page);
    const all = A.flatMap((a: any) => a.network);
    expect(all).toHaveLength(14);
    const count = page.getByTestId('net-count');
    const rows = page.getByTestId('req');
    // step 1 alone: the page load
    await expect(count).toHaveText('Showing 5 of 5 requests in step 1');
    await expect(rows).toHaveCount(5);
    await page.getByTestId('type-image').click();
    await expect(rows).toHaveCount(1);
    await page.getByTestId('net-all').check();
    const images = all.filter((r: any) => r.type === 'image').length;
    expect(images).toBe(3);
    await expect(count).toHaveText(`Showing ${images} of 14 requests in the whole run`);
    await page.getByTestId('type-fetch').click();
    const fetches = all.filter((r: any) => r.type === 'fetch');
    await expect(rows).toHaveCount(fetches.length);
    await page.getByTestId('net-errors').check();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('/api/promo');
    await expect(rows.first()).toContainText('422');
    await page.getByTestId('net-errors').uncheck();
    await page.getByTestId('net-filter').fill('cart');
    const cartFetches = fetches.filter((r: any) => r.url.includes('cart'));
    expect(cartFetches.length).toBe(3);                  // POST /api/cart, GET /api/cart twice
    await expect(rows).toHaveCount(3);
    await page.getByTestId('type-all').click();
    await page.getByTestId('net-filter').fill('zzz');
    await expect(count).toHaveText('Showing 0 of 14 requests in the whole run');
    await expect(page.getByTestId('net-table')).toContainText('No requests match.');
    // the page's own list agrees with an independent filter over the raw data
    await page.getByTestId('net-filter').fill('.webp');
    const ids = await page.evaluate(() => (window as any).__trace.visibleRequests());
    expect(ids).toEqual(all.filter((r: any) => r.url.includes('.webp')).map((r: any) => r.id));
  });

  test('keyboard scrubbing on the timeline slider and the action list', async ({ page }) => {
    await page.goto(URL);
    const tl = page.getByTestId('timeline');
    await tl.focus();
    await expect(tl).toHaveAttribute('aria-valuenow', '1');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect((await state(page)).step).toBe(3);
    await expect(tl).toHaveAttribute('aria-valuenow', '3');
    await expect(tl).toHaveAttribute('aria-valuetext', 'Step 3 of 9: click');
    await expect(page.getByTestId('action-3')).toHaveAttribute('aria-current', 'step');
    await page.keyboard.press('End');
    await expect(tl).toHaveAttribute('aria-valuetext', 'Step 9 of 9: expect, failed');
    await page.keyboard.press('ArrowRight');                           // clamps at the end
    expect((await state(page)).step).toBe(9);
    await page.keyboard.press('PageUp');
    expect((await state(page)).step).toBe(6);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');                            // clamps at the start
    expect((await state(page)).step).toBe(1);
    await expect(page.getByTestId('live')).toHaveText(/^Step 1: goto/);
    // the action list moves with the up and down arrows and keeps focus
    await page.getByTestId('action-4').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('action-5')).toBeFocused();
    expect((await state(page)).step).toBe(5);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('action-3')).toBeFocused();
    // the snapshot tabs switch with the arrow keys too
    await page.getByTestId('tab-after').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('tab-before')).toBeFocused();
    expect((await state(page)).snap).toBe('before');
  });

  test('clicking the timeline picks the action running at that moment', async ({ page }) => {
    await page.goto(URL);
    const A = await actions(page);
    const box = (await page.getByTestId('timeline').boundingBox())!;
    for (const i of [2, 4, 8, 9]) {
      const a = A[i - 1];
      const mid = (a.start + a.dur / 2) / TOTAL;
      await page.getByTestId('timeline').click({ position: { x: box.width * mid, y: box.height / 2 } });
      expect((await state(page)).step, `click at ${Math.round(mid * 100)}%`).toBe(i);
    }
    await expect(page.getByTestId('timeline')).toBeFocused();
    await expect(page.getByTestId('seg-9')).toHaveClass(/cur/);
  });

  test('deep links: #step=N opens that step, clicks write the hash, and hash changes are followed', async ({ page }) => {
    await page.goto(`${URL}#step=9`);
    await expect(page.getByTestId('error')).toBeVisible();
    await expect(page.getByTestId('current')).toContainText("toHaveText('$16.20')");
    await page.getByTestId('action-4').click();
    await expect(page).toHaveURL(/#step=4$/);
    await expect(page.getByTestId('error')).toBeHidden();
    await page.evaluate(() => { location.hash = '#step=2&snap=before'; });
    await expect(page.getByTestId('action-2')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('tab-before')).toHaveAttribute('aria-selected', 'true');
    // out-of-range and junk values are clamped, not crashed on
    await page.goto(`${URL}#step=99`);
    expect((await state(page)).step).toBe(9);
    await page.goto(`${URL}#step=abc`);
    expect((await state(page)).step).toBe(1);
    // reloading keeps the step
    await page.goto(`${URL}#step=6`);
    await page.reload();
    await expect(page.getByTestId('action-6')).toHaveAttribute('aria-current', 'step');
  });

  test('the failing step: error, call log, highlighted target and the jump button', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('error')).toBeHidden();
    await expect(page.getByTestId('runinfo')).toContainText('1 failed');
    await page.getByTestId('jump-failure').click();
    expect((await state(page)).step).toBe(9);
    await expect(page.getByTestId('timeline')).toBeFocused();
    const msg = page.getByTestId('error-message');
    await expect(msg).toContainText('Expected: "$16.20"');
    await expect(msg).toContainText('Received: "$18.00"');
    await expect(msg).toContainText('Timeout:  5000ms');
    await expect(page.getByTestId('error').locator('li')).toHaveCount(4);
    await expect(page.getByTestId('seg-9')).toHaveClass(/failed/);
    await expect(page.getByTestId('action-9')).toHaveClass(/failed/);
    // the total in the snapshot is the value the assertion received
    await expect(page.getByTestId('snap-after').frameLocator('iframe').locator('[data-hl]')).toHaveText('$18.00');
    // exactly one step failed
    expect((await actions(page)).filter((a: any) => a.failed).map((a: any) => a.i)).toEqual([9]);
  });

  test('console output belongs to its step, and the run totals are right', async ({ page }) => {
    await page.goto(`${URL}#step=8`);
    const logs = page.getByTestId('log');
    await expect(logs).toHaveCount(2);
    await expect(logs.nth(0)).toHaveAttribute('data-level', 'error');
    await expect(logs.nth(0)).toContainText('422');
    await expect(logs.nth(1)).toContainText('PROMO_EXPIRED');
    await page.getByTestId('action-2').click();
    await expect(logs).toHaveCount(0);
    await expect(page.getByTestId('console')).toContainText('Nothing logged');
    const A = await actions(page);
    const levels = A.flatMap((a: any) => a.console.map((c: any) => c.level));
    expect(levels.filter((l: string) => l === 'error')).toHaveLength(1);
    expect(levels.filter((l: string) => l === 'warning')).toHaveLength(2);
    await expect(page.getByTestId('console-totals')).toHaveText('whole run: 1 error, 2 warnings');
  });
});
