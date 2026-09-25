import { test, expect, Page } from '@playwright/test';

const URL = '/lab/104-prompt-cache-planner.html';
type Seg = { id: string; size: number; period: number };

/** Read the plan from the form itself: order from the list, size and frequency from each segment's fields. */
async function plan(page: Page): Promise<Seg[]> {
  return page.locator('#segs > li').evaluateAll((lis) => lis.map((li) => ({
    id: (li as HTMLElement).dataset.id!,
    size: Number((li.querySelector('[data-f="size"]') as HTMLInputElement).value),
    period: Number((li.querySelector('[data-f="period"]') as HTMLSelectElement).value),
  })));
}

/** Independent oracle: the cache holds last turn's prompt; the hit is the longest prefix of unchanged segments. */
function oracle(segs: Seg[], read = 0.1, write = 1.25) {
  const total = segs.reduce((a, s) => a + s.size, 0);
  const rows = [];
  for (let t = 1; t <= 20; t++) {
    let cached = 0;
    if (t > 1) {
      for (const s of segs) {
        const changed = s.period > 0 && t % s.period === 0;
        if (changed) break;
        cached += s.size;
      }
    }
    rows.push({ t, cached, uncached: total - cached, cost: cached * read + (total - cached) * write, base: total });
  }
  const cached = rows.reduce((a, r) => a + r.cached, 0);
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const base = rows.reduce((a, r) => a + r.base, 0);
  return { rows, cached, uncached: base - cached, cost, base, rel: cost / base };
}
function* perms<T>(xs: T[]): Generator<T[]> {
  if (xs.length <= 1) { yield xs; return; }
  for (let i = 0; i < xs.length; i++) for (const p of perms([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...p];
}
const num = (s: string | null) => Number(s!.replace(/,/g, ''));
const pct = (x: number) => (x * 100).toFixed(1) + '%';
const orderOf = async (page: Page) => (await plan(page)).map((s) => s.id);

async function expectMatchesOracle(page: Page, read = 0.1, write = 1.25) {
  const want = oracle(await plan(page), read, write);
  for (const r of want.rows) {
    await expect(page.getByTestId(`cached-${r.t}`)).toHaveText(r.cached.toLocaleString('en-US'));
    await expect(page.getByTestId(`uncached-${r.t}`)).toHaveText(r.uncached.toLocaleString('en-US'));
    await expect(page.getByTestId(`cost-${r.t}`)).toHaveText(pct(r.cost / r.base));
  }
  await expect(page.getByTestId('tot-cached')).toHaveText(want.cached.toLocaleString('en-US'));
  await expect(page.getByTestId('tot-uncached')).toHaveText(want.uncached.toLocaleString('en-US'));
  await expect(page.getByTestId('rel-cost')).toHaveText(pct(want.rel));
  return want;
}

test.describe('104 Prompt Cache Planner', () => {
  test('defaults: five segments, twenty turns, and turn 1 is a cold cache', async ({ page }) => {
    await page.goto(URL);
    const segs = await plan(page);
    expect(segs.map((s) => s.id)).toEqual(['docs', 'sys', 'hist', 'tools', 'user']);
    await expect(page.locator('#tbody tr')).toHaveCount(20);
    const total = segs.reduce((a, s) => a + s.size, 0);
    expect(total).toBe(7200 + 1800 + 3400 + 2600 + 150);
    await expect(page.getByTestId('cached-1')).toHaveText('0');
    await expect(page.getByTestId('uncached-1')).toHaveText(total.toLocaleString('en-US'));
    await expect(page.getByTestId('break-1')).toHaveText('cold cache');
    // a full miss is billed entirely at the write multiplier: 125% of the no-cache price
    await expect(page.getByTestId('cost-1')).toHaveText('125.0%');
    await expect(page.locator('[data-testid^="bar-"]')).toHaveCount(20);
  });

  test('every turn matches the longest-unchanged-prefix oracle', async ({ page }) => {
    await page.goto(URL);
    const want = await expectMatchesOracle(page);
    // hand-checked turns: turn 2, the docs (first) are unchanged but the history breaks the prefix
    expect(want.rows[1].cached).toBe(7200 + 1800);
    // turn 5, the docs themselves change, so nothing hits
    expect(want.rows[4].cached).toBe(0);
    await expect(page.getByTestId('break-5')).toHaveText('Reference docs');
    await expect(page.getByTestId('break-2')).toHaveText('Conversation history');
    // chart bars carry the same numbers
    for (const r of want.rows) {
      await expect(page.getByTestId(`bar-${r.t}`)).toHaveAttribute('data-cached', String(r.cached));
    }
  });

  test('multipliers are labelled illustrative and are user-editable', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('illustrative')).toHaveText(/illustrative defaults/i);
    await expect(page.getByTestId('price-read')).toHaveValue('0.1');
    await expect(page.getByTestId('price-write')).toHaveValue('1.25');
    await expect(page.getByLabel('Cache read (hit), × base')).toBeVisible();
    await page.getByTestId('price-read').fill('0.5');
    await page.getByTestId('price-write').fill('1');
    await expectMatchesOracle(page, 0.5, 1);
    // read = write = 1 means caching changes nothing: exactly the no-cache cost
    await page.getByTestId('price-read').fill('1');
    await expect(page.getByTestId('rel-cost')).toHaveText('100.0%');
    // a nonsense value is refused and the last good one kept
    await page.getByTestId('price-write').fill('-3');
    await expect(page.getByTestId('warn')).toContainText('multipliers');
    await expect(page.getByTestId('price-write')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('rel-cost')).toHaveText('100.0%');
  });

  test('Optimize puts stable segments first and reaches the brute-force best of all 120 orders', async ({ page }) => {
    await page.goto(URL);
    const before = oracle(await plan(page));
    const segs = await plan(page);
    let best = -1;
    for (const p of perms(segs)) best = Math.max(best, oracle(p).cached);
    await page.getByTestId('optimize').click();
    const order = await orderOf(page);
    expect(order).toEqual(['sys', 'tools', 'docs', 'hist', 'user']);
    const after = await expectMatchesOracle(page);
    expect(after.cached).toBe(best);
    expect(after.cost).toBeLessThan(before.cost);
    // the "optimized order" readout agrees, and optimizing again changes nothing
    await expect(page.getByTestId('rel-best')).toHaveText(pct(after.rel));
    await page.getByTestId('optimize').click();
    await expect(page.getByTestId('announce')).toHaveText(/Already optimal/);
    expect(await orderOf(page)).toEqual(order);
  });

  test('keyboard reordering with the up and down buttons keeps focus and announces the move', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('up-docs')).toBeDisabled();
    await expect(page.getByTestId('down-user')).toBeDisabled();
    await page.getByTestId('up-sys').focus();
    await page.keyboard.press('Enter');
    expect(await orderOf(page)).toEqual(['sys', 'docs', 'hist', 'tools', 'user']);
    await expect(page.getByTestId('announce')).toHaveText('System prompt moved to position 1 of 5.');
    // it is now first, so its up button is disabled and focus moved to its down button
    await expect(page.getByTestId('up-sys')).toBeDisabled();
    await expect(page.getByTestId('down-sys')).toBeFocused();
    await page.getByTestId('down-tools').focus();
    await page.keyboard.press('Space');
    expect(await orderOf(page)).toEqual(['sys', 'docs', 'hist', 'user', 'tools']);
    await expect(page.getByTestId('pos-tools')).toHaveText('#5');
    await expectMatchesOracle(page);
    // buttons work by click/tap too
    await page.getByTestId('up-tools').click();
    await page.getByTestId('up-tools').click();
    expect(await orderOf(page)).toEqual(['sys', 'docs', 'tools', 'hist', 'user']);
    await expectMatchesOracle(page);
  });

  test('dragging a segment by its handle reorders the prompt', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse drag is exercised on desktop; the up/down buttons cover touch');
    await page.goto(URL);
    const grip = page.getByTestId('grip-docs').boundingBox();
    const target = page.getByTestId('seg-tools').boundingBox();
    const g = (await grip)!, t = (await target)!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, t.y + t.height - 4, { steps: 12 });
    await page.mouse.up();
    expect(await orderOf(page)).toEqual(['sys', 'hist', 'tools', 'docs', 'user']);
    await expect(page.getByTestId('announce')).toHaveText('Reference docs moved to position 4 of 5.');
    await expectMatchesOracle(page);
  });

  test('changing frequencies: a fully static prompt is a full hit after turn 1', async ({ page }) => {
    await page.goto(URL);
    for (const id of ['docs', 'hist', 'tools', 'user']) await page.getByTestId(`freq-${id}`).selectOption('0');
    const total = (await plan(page)).reduce((a, s) => a + s.size, 0);
    for (let t = 2; t <= 20; t++) await expect(page.getByTestId(`uncached-${t}`)).toHaveText('0');
    await expect(page.getByTestId('break-7')).toHaveText('— (full hit)');
    // one cold write at 1.25, then 19 reads at 0.1: (1.25 + 19 × 0.1) / 20
    await expect(page.getByTestId('rel-cost')).toHaveText(pct((1.25 + 19 * 0.1) / 20));
    await expect(page.getByTestId('tot-cached')).toHaveText((19 * total).toLocaleString('en-US'));
    // one volatile segment at the top ruins everything, even when all else is static
    await page.getByTestId('freq-docs').selectOption('1');
    for (let t = 2; t <= 20; t++) await expect(page.getByTestId(`cached-${t}`)).toHaveText('0');
    await expect(page.getByTestId('rel-cost')).toHaveText('125.0%');
    await expectMatchesOracle(page);
  });

  test('segment sizes are editable and validated', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('size-docs').fill('20000');
    await expectMatchesOracle(page);
    await page.getByTestId('size-sys').fill('0');
    await expect(page.getByTestId('size-sys')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('warn')).toContainText('whole numbers');
    // the last valid size (1800) is still in use
    const st = await page.evaluate(() => (window as any).__cache.state);
    expect(st.rows[0].uncached).toBe(20000 + 1800 + 3400 + 2600 + 150);
    await page.getByTestId('size-sys').fill('2500');
    await expect(page.getByTestId('warn')).toHaveText('');
    await expectMatchesOracle(page);
    await page.getByTestId('reset').click();
    await expect(page.getByTestId('size-docs')).toHaveValue('7200');
    expect(await orderOf(page)).toEqual(['docs', 'sys', 'hist', 'tools', 'user']);
  });

  test('the turn inspector shows where the prefix breaks', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('optimize').click();
    const turn = page.getByTestId('turn');
    await turn.fill('10');                                   // tools change on turn 10
    await expect(page.getByTestId('turn-label')).toHaveText('10');
    await expect(page.getByTestId('blk-sys')).toHaveAttribute('data-state', 'hit');
    await expect(page.getByTestId('blk-tools')).toHaveAttribute('data-state', 'changed');
    await expect(page.getByTestId('blk-docs')).toHaveAttribute('data-state', 'miss');
    await expect(page.getByTestId('strip-text')).toHaveText('Turn 10: Tool definitions changed, so the hit stops there. 1,800 tokens are read from the cache and 13,350 are processed again.');
    await expect(page.getByTestId('row-10')).toHaveClass(/sel/);
    await turn.fill('3');
    await expect(page.getByTestId('blk-docs')).toHaveAttribute('data-state', 'hit');
    await expect(page.getByTestId('blk-hist')).toHaveAttribute('data-state', 'changed');
    await turn.fill('1');
    await expect(page.getByTestId('strip-text')).toContainText('the cache is empty');
    await expect(page.getByTestId('blk-sys')).toHaveAttribute('data-state', 'miss');
  });
});
