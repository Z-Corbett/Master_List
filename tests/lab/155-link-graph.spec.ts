import { test, expect, Page } from '@playwright/test';

const URL_ = '/lab/155-link-graph.html';
const G = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__graph.state)));

// ---- independent oracles ----
// PageRank by power iteration on the dense Google matrix: G = d·(S) + (1−d)/N, where S is the column-stochastic
// link matrix with dangling columns replaced by 1/N. Written separately from the page's sparse version.
function googlePageRank(pages: string[], edges: [string, string][], d = 0.85) {
  const N = pages.length, ix = new Map(pages.map((p, i) => [p, i]));
  const out = new Array(N).fill(0);
  for (const [f] of edges) out[ix.get(f)!]++;
  const M: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (const [f, t] of edges) M[ix.get(t)!][ix.get(f)!] += 1 / out[ix.get(f)!];
  for (let j = 0; j < N; j++) if (!out[j]) for (let i = 0; i < N; i++) M[i][j] = 1 / N;
  let x = new Array(N).fill(1 / N);
  for (let k = 0; k < 5000; k++) {
    const y = new Array(N).fill(0);
    for (let i = 0; i < N; i++) { let s = 0; for (let j = 0; j < N; j++) s += M[i][j] * x[j]; y[i] = d * s + (1 - d) / N; }
    const delta = y.reduce((s, v, i) => s + Math.abs(v - x[i]), 0);
    x = y;
    if (delta < 1e-15) break;
  }
  return Object.fromEntries(pages.map((p, i) => [p, x[i]]));
}
function depths(pages: string[], edges: [string, string][], home: string) {
  const dist: Record<string, number | null> = Object.fromEntries(pages.map((p) => [p, null]));
  dist[home] = 0;
  let frontier = [home];
  for (let d = 1; frontier.length; d++) {
    const next: string[] = [];
    for (const u of frontier) for (const [f, t] of edges) if (f === u && dist[t] === null) { dist[t] = d; next.push(t); }
    frontier = next;
  }
  return dist;
}
async function load(page: Page, pages: string, links: string, home = '/') {
  await page.getByTestId('pages').fill(pages);
  await page.getByTestId('links').fill(links);
  await page.getByTestId('home').fill(home);
  await page.getByTestId('analyze').click();
}

test.describe('155 Internal Link Graph', () => {
  test('PageRank matches an independent power iteration to 1e-9 and sums to 1', async ({ page }) => {
    await page.goto(URL_);
    const S = await G(page);
    expect(S.pages.length).toBe(42);
    const want = googlePageRank(S.pages, S.edges);
    let sum = 0;
    for (const p of S.pages) { expect(Math.abs(S.pr[p] - want[p]), p).toBeLessThan(1e-9); sum += S.pr[p]; }
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    // the fixed point really is a fixed point of the formula
    const out: Record<string, number> = {}; for (const p of S.pages) out[p] = 0;
    for (const [f] of S.edges) out[f]++;
    const dang = S.pages.filter((p: string) => !out[p]).reduce((s: number, p: string) => s + S.pr[p], 0);
    for (const p of S.pages) {
      const inflow = S.edges.filter((e: string[]) => e[1] === p).reduce((s: number, e: string[]) => s + S.pr[e[0]] / out[e[0]], 0);
      expect(Math.abs(0.15 / 42 + 0.85 * (inflow + dang / 42) - S.pr[p])).toBeLessThan(1e-10);
    }
    expect(S.dangling).toEqual(S.pages.filter((p: string) => !out[p]));
    await expect(page.getByTestId('pr-status')).toContainText('Ranks sum to 1.000000000000');
    // an orphan gets only the teleport share and its cut of the dangling pool: the floor, the same for every orphan
    const floor = 0.15 / 42 + 0.85 * dang / 42;
    for (const o of ['/guides/snow-shelters', '/landing/summer-promo', '/shop/clearance-2025']) expect(Math.abs(S.pr[o] - floor)).toBeLessThan(1e-12);
    expect(Math.min(...S.pages.map((p: string) => S.pr[p]))).toBeCloseTo(floor, 12);
  });

  test('hand-solvable graphs: a cycle, and a dangling page', async ({ page }) => {
    await page.goto(URL_);
    await load(page, 'A\nB\nC', 'A -> B\nB -> C\nC -> A', 'A');
    let S = await G(page);
    for (const p of ['A', 'B', 'C']) expect(S.pr[p]).toBeCloseTo(1 / 3, 12);
    // A -> B, B has no links: PR(A) = 0.075 + 0.85·PR(B)/2 and PR(A) + PR(B) = 1 → PR(A) = 0.5 / 1.425
    await load(page, 'A\nB', 'A -> B', 'A');
    S = await G(page);
    expect(Math.abs(S.pr.A - 0.5 / 1.425)).toBeLessThan(1e-12);
    expect(Math.abs(S.pr.B - (1 - 0.5 / 1.425))).toBeLessThan(1e-12);
    expect(S.dangling).toEqual(['B']);
    await expect(page.getByTestId('page-table').locator('tbody tr').first()).toHaveAttribute('data-page', 'B');
    await expect(page.getByTestId('pr-status')).toContainText('1 dangling page.');
  });

  test('orphans are exactly the pages with no inbound links', async ({ page }) => {
    await page.goto(URL_);
    const S = await G(page);
    const inbound = new Set(S.edges.map((e: string[]) => e[1]));
    const want = S.pages.filter((p: string) => p !== '/' && !inbound.has(p));
    expect(S.orphans).toEqual(want);
    expect([...S.orphans].sort()).toEqual(['/guides/snow-shelters', '/landing/summer-promo', '/shop/clearance-2025']);
    await expect(page.getByTestId('n-orphans')).toHaveText('3');
    await expect(page.getByTestId('orphans').locator('li')).toHaveText(want);
    // an orphan is unreachable even though it links out
    expect(S.depth['/landing/summer-promo']).toBeNull();
    await expect(page.getByTestId('page-table').locator('tr[data-page="/shop/clearance-2025"] td').first()).toHaveClass('orphan');
  });

  test('click depth from home is a breadth-first search', async ({ page }) => {
    await page.goto(URL_);
    const S = await G(page);
    expect(S.depth).toEqual(depths(S.pages, S.edges, '/'));
    expect(S.depth['/']).toBe(0);
    expect(S.depth['/shop/tents/aspen-dome']).toBe(2);          // the sale page is a shortcut: / → /shop/sale/ → aspen-dome
    expect(S.depth['/guides/beginners/first-night/checklist/printable/large-print']).toBe(6);
    await expect(page.getByTestId('max-depth')).toHaveText('6');
    await expect(page.getByTestId('page-table').locator('tr[data-page="/guides/snow-shelters"] td').nth(1)).toHaveText('–');
    // change the home page: depths follow
    await page.getByTestId('home').fill('/blog/');
    await page.getByTestId('analyze').click();
    const T = await G(page);
    expect(T.depth).toEqual(depths(T.pages, T.edges, '/blog/'));
    expect(T.depth['/blog/']).toBe(0);
  });

  test('broken internal links: targets that are not in the page list', async ({ page }) => {
    await page.goto(URL_);
    const S = await G(page);
    expect(S.broken).toEqual([
      { from: '/shop/tents/', to: '/shop/tents/ridgeline-4p' },
      { from: '/blog/2026/spring-gear', to: '/guides/knotz' },
      { from: '/about/press', to: '/about/press-kit.pdf' },
    ]);
    await expect(page.getByTestId('n-broken')).toHaveText('3');
    await expect(page.getByTestId('broken')).toContainText('/blog/2026/spring-gear → /guides/knotz');
    for (const e of S.edges) { expect(S.pages).toContain(e[0]); expect(S.pages).toContain(e[1]); }
    await expect(page.getByTestId('graph').locator('rect[data-broken]')).toHaveCount(3);
    // adding the missing page to the list fixes that link
    await page.getByTestId('pages').fill((await page.getByTestId('pages').inputValue()) + '\n/guides/knotz');
    await page.getByTestId('analyze').click();
    await expect(page.getByTestId('n-broken')).toHaveText('2');
  });

  test('suggested links bring every page within the target depth', async ({ page }) => {
    await page.goto(URL_);
    const S = await G(page);
    expect(S.suggestions.length).toBeGreaterThan(0);
    for (const s of S.suggestions) {
      expect(S.pages).toContain(s.from);
      expect(s.now).toBeLessThanOrEqual(3);
    }
    // the first suggestion targets a depth-4 page from its own section
    expect(S.suggestions[0]).toMatchObject({ from: '/blog/archive/', to: '/blog/archive/2024/old-post', was: 4, now: 3 });
    const withSugg: [string, string][] = [...S.edges, ...S.suggestions.map((s: any) => [s.from, s.to])];
    const d = depths(S.pages, withSugg, '/');
    expect(Object.values(d).every((v) => v !== null && v <= 3)).toBe(true);
    await page.getByTestId('apply').click();
    await expect(page.getByTestId('max-depth')).toHaveText('3');
    await expect(page.getByTestId('n-orphans')).toHaveText('0');
    await expect(page.getByTestId('suggestions').locator('li')).toHaveText(['None']);
    await expect(page.getByTestId('apply')).toBeDisabled();
    await expect(page.getByTestId('analyze')).toBeFocused();
    // a stricter target makes more suggestions
    await page.getByTestId('demo').click();
    await page.getByTestId('target-depth').fill('2');
    await page.getByTestId('target-depth').dispatchEvent('change');
    const T = await G(page);
    expect(T.suggestions.length).toBeGreaterThan(S.suggestions.length);
    const d2 = depths(T.pages, [...T.edges, ...T.suggestions.map((s: any) => [s.from, s.to])], '/');
    expect(Object.values(d2).every((v) => v !== null && v <= 2)).toBe(true);
  });

  test('pasted input: duplicates, self-links, unknown sources and bad lines are handled', async ({ page }) => {
    await page.goto(URL_);
    await load(page, '/\n/a\n/b', '/ -> /a\n/ -> /a\n/a -> /a\n/c -> /b\n/a → /b\nnot a link line\n/b -> /missing', '/');
    const S = await G(page);
    expect(S.pages).toEqual(['/', '/a', '/b', '/c']);
    expect(S.edges).toEqual([['/', '/a'], ['/c', '/b'], ['/a', '/b']]);
    expect(S.broken).toEqual([{ from: '/b', to: '/missing' }]);
    expect(S.orphans).toEqual(['/c']);
    const errs = page.getByTestId('parse-errors');
    await expect(errs).toContainText('Line 6: expected "from -> to", got "not a link line"');
    await expect(errs).toContainText('1 duplicate link counted once.');
    await expect(errs).toContainText('1 self-link ignored.');
    await expect(errs).toContainText('1 link source was missing from the page list and added.');
    const want = googlePageRank(S.pages, S.edges);
    for (const p of S.pages) expect(Math.abs(S.pr[p] - want[p])).toBeLessThan(1e-9);
  });

  test('the layout is seeded: same seed, same picture; nodes stay inside the frame', async ({ page }) => {
    await page.goto(`${URL_}?seed=7`);
    const a = await page.evaluate(() => (window as any).__graph.positions);
    await page.goto(`${URL_}?seed=7`);
    const b = await page.evaluate(() => (window as any).__graph.positions);
    expect(b).toEqual(a);
    for (const p of Object.values(a) as { x: number; y: number }[]) {
      expect(p.x).toBeGreaterThanOrEqual(30); expect(p.x).toBeLessThanOrEqual(870);
      expect(p.y).toBeGreaterThanOrEqual(30); expect(p.y).toBeLessThanOrEqual(590);
    }
    await page.getByTestId('seed').fill('8');
    await page.getByTestId('relayout').click();
    const c = await page.evaluate(() => (window as any).__graph.positions);
    expect(c).not.toEqual(a);
    await expect(page.getByTestId('graph').locator('.node')).toHaveCount(42);
    await expect(page.getByTestId('graph').locator('line[data-edge]')).toHaveCount((await G(page)).edges.length);
  });

  test('nodes are keyboard-operable and show their links', async ({ page }) => {
    await page.goto(URL_);
    const node = page.locator('#graph .node[data-page="/shop/tents/"]');
    await node.focus();
    await page.keyboard.press('Enter');
    const detail = page.getByTestId('detail');
    await expect(detail).toContainText('/shop/tents/ · depth 2');
    await expect(detail).toContainText('Linked from (4): /shop/, /shop/tents/ridgeline-2p, /shop/tents/ridgeline-3p, /shop/tents/aspen-dome');
    await expect(detail).toContainText('Broken links (1): /shop/tents/ridgeline-4p');
    await expect(node).toHaveClass(/sel/);
    await expect(node).toHaveAttribute('aria-label', /depth 2, PageRank \d+\.\d\d%/);
    // click works too (touch on mobile)
    await page.locator('#graph .node[data-page="/landing/summer-promo"]').click({ force: true });
    await expect(detail).toContainText('unreachable from home');
    await expect(detail).toContainText('Linked from (0): none');
  });
});
