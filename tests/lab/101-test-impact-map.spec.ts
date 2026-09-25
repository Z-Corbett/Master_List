import { test, expect, Page } from '@playwright/test';

const URL = '/lab/101-test-impact-map.html';

// The spec's own copy of the fictional app: who imports whom, and what each test targets.
const EDGES: Record<string, string[]> = {
  'src/ui/CheckoutPage.tsx': ['src/checkout/checkout.ts', 'src/utils/dates.ts'],
  'src/ui/Header.tsx': ['src/auth/session.ts', 'src/cart/cart.ts', 'src/config/flags.ts'],
  'src/ui/ProductPage.tsx': ['src/api/catalog.ts', 'src/cart/cart.ts', 'src/utils/money.ts'],
  'src/checkout/checkout.ts': ['src/cart/cart.ts', 'src/api/orders.ts', 'src/auth/session.ts', 'src/config/flags.ts'],
  'src/cart/cart.ts': ['src/utils/money.ts', 'src/lib/store.ts', 'src/api/catalog.ts'],
  'src/ui/AccountPage.tsx': ['src/auth/session.ts', 'src/api/orders.ts', 'src/utils/dates.ts'],
  'src/auth/session.ts': ['src/lib/http.ts', 'src/lib/store.ts'],
  'src/api/catalog.ts': ['src/lib/http.ts'],
  'src/api/orders.ts': ['src/lib/http.ts', 'src/utils/money.ts'],
  'src/lib/store.ts': [], 'src/lib/http.ts': [], 'src/utils/money.ts': [], 'src/config/flags.ts': [], 'src/utils/dates.ts': [],
};
type T = { id: string; dur: number; targets: string[] | null; smoke?: boolean };
const TESTS: T[] = [
  { id: 'unit-money', dur: 4, targets: ['src/utils/money.ts'] },
  { id: 'unit-dates', dur: 3, targets: ['src/utils/dates.ts'] },
  { id: 'unit-http', dur: 6, targets: ['src/lib/http.ts'] },
  { id: 'unit-store', dur: 5, targets: ['src/lib/store.ts'] },
  { id: 'unit-catalog', dur: 12, targets: ['src/api/catalog.ts'] },
  { id: 'unit-orders', dur: 14, targets: ['src/api/orders.ts'] },
  { id: 'unit-session', dur: 10, targets: ['src/auth/session.ts'] },
  { id: 'unit-cart', dur: 18, targets: ['src/cart/cart.ts'] },
  { id: 'unit-checkout', dur: 25, targets: ['src/checkout/checkout.ts'] },
  { id: 'e2e-browse', dur: 60, targets: ['src/ui/ProductPage.tsx', 'src/ui/Header.tsx'], smoke: true },
  { id: 'e2e-purchase', dur: 120, targets: ['src/ui/CheckoutPage.tsx', 'src/ui/ProductPage.tsx'], smoke: true },
  { id: 'e2e-account', dur: 75, targets: ['src/ui/AccountPage.tsx'] },
  { id: 'e2e-login', dur: 45, targets: ['src/ui/Header.tsx'], smoke: true },
  { id: 'visual-header', dur: 30, targets: ['src/ui/Header.tsx'] },
  { id: 'a11y-pages', dur: 40, targets: ['src/ui/ProductPage.tsx', 'src/ui/CheckoutPage.tsx', 'src/ui/AccountPage.tsx'] },
  { id: 'legacy-pack', dur: 90, targets: null },
  { id: 'api-contracts', dur: 35, targets: null },
];
const FULL = TESTS.reduce((a, t) => a + t.dur, 0);
const base = (p: string) => p.split('/').pop()!;
const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);

/** Oracle: BFS over the reversed edges, written independently of the page. */
function oracle(changed: string[], smoke = true, uncovered = true) {
  const rev: Record<string, string[]> = {};
  for (const k of Object.keys(EDGES)) rev[k] = [];
  for (const [m, ds] of Object.entries(EDGES)) for (const d of ds) rev[d].push(m);
  const global = changed.includes('package-lock.json');
  const dist = new Map<string, number>();
  const q = changed.filter((c) => c in EDGES);
  q.forEach((c) => dist.set(c, 0));
  for (let i = 0; i < q.length; i++) for (const v of rev[q[i]]) if (!dist.has(v)) { dist.set(v, dist.get(q[i])! + 1); q.push(v); }
  const affected = global ? new Set(Object.keys(EDGES)) : new Set(dist.keys());
  const selected = TESTS.filter((t) => global || (t.targets === null ? uncovered : t.targets.some((x) => affected.has(x)) || (!!t.smoke && smoke))).map((t) => t.id);
  const time = TESTS.filter((t) => selected.includes(t.id)).reduce((a, t) => a + t.dur, 0);
  return { affected, dist, selected, time, savedPct: Math.round((1 - time / FULL) * 100) };
}
const selectedIds = (page: Page) => page.locator('[data-testid^="t-"][data-selected="true"]').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-testid')!.slice(2)));

async function expectMatches(page: Page, o: ReturnType<typeof oracle>) {
  await expect(page.getByTestId('affected-count')).toHaveText(String(o.affected.size));
  await expect(page.getByTestId('selected-count')).toHaveText(String(o.selected.length));
  await expect(page.getByTestId('selected-time')).toHaveText(fmt(o.time));
  await expect(page.getByTestId('saved')).toHaveText(`${o.savedPct}%`);
  expect((await selectedIds(page)).sort()).toEqual([...o.selected].sort());
}

test.describe('101 Test Impact Map', () => {
  test('the page ships the same graph and suite as the spec, and draws every module and import', async ({ page }) => {
    await page.goto(URL);
    const api = await page.evaluate(() => { const w = (window as any).__impact; return { modules: w.modules, tests: w.tests }; });
    const pageEdges = Object.fromEntries(api.modules.map((m: any) => [m.id, [...m.deps].sort()]));
    expect(pageEdges).toEqual(Object.fromEntries(Object.entries(EDGES).map(([k, v]) => [k, [...v].sort()])));
    expect(api.tests.map((t: any) => [t.id, t.dur, t.targets, !!t.smoke])).toEqual(TESTS.map((t) => [t.id, t.dur, t.targets, !!t.smoke]));
    const nEdges = Object.values(EDGES).reduce((a, d) => a + d.length, 0);
    await expect(page.locator('#graph [data-edge]')).toHaveCount(nEdges);
    await expect(page.locator('#graph .node')).toHaveCount(Object.keys(EDGES).length);
    await expect(page.getByTestId('full-time')).toHaveText(fmt(FULL));        // 592 s = 9m 52s
    expect(FULL).toBe(592);
    await expect(page.getByTestId('graph')).toHaveAttribute('aria-label', new RegExp(`14 modules and ${nEdges} imports`));
  });

  test('changing money.ts: the reverse-dependency walk reaches every importer, and the right tests are picked', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('file-money.ts').check();
    const o = oracle(['src/utils/money.ts']);
    expect(o.affected.size).toBe(8);
    await expectMatches(page, o);
    for (const [m, d] of o.dist) await expect(page.getByTestId(`aff-${base(m)}`)).toHaveAttribute('data-hops', String(d));
    // modules the walk can't reach are left alone
    for (const m of ['http.ts', 'store.ts', 'session.ts', 'catalog.ts', 'flags.ts', 'dates.ts']) {
      await expect(page.getByTestId(`node-${m}`)).toHaveAttribute('data-state', 'idle');
    }
    await expect(page.getByTestId('node-money.ts')).toHaveAttribute('data-state', 'changed');
    await expect(page.getByTestId('node-CheckoutPage.tsx')).toHaveAttribute('data-state', 'affected');
  });

  test('every "why" chain is a real path of imports back to a changed file', async ({ page }) => {
    await page.goto(URL);
    const changed = ['src/utils/money.ts', 'src/utils/dates.ts'];
    for (const c of changed) await page.getByTestId(`file-${base(c)}`).check();
    const o = oracle(changed);
    const byBase = Object.fromEntries(Object.keys(EDGES).map((k) => [base(k), k]));
    for (const [m, d] of o.dist) {
      const chain = (await page.getByTestId(`chain-${base(m)}`).textContent())!.split(' ← ').map((b) => byBase[b]);
      expect(chain.length).toBe(d + 1);                                  // BFS gives shortest chains
      expect(chain[0]).toBe(m);
      expect(changed).toContain(chain[chain.length - 1]);
      for (let i = 0; i + 1 < chain.length; i++) expect(EDGES[chain[i]]).toContain(chain[i + 1]);
    }
    await expect(page.getByTestId('aff-AccountPage.tsx')).toHaveAttribute('data-hops', '1');   // imports dates directly
  });

  test('a leaf page change runs little, and the smoke toggle is the difference', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-leaf').click();
    let o = oracle(['src/ui/CheckoutPage.tsx']);
    await expectMatches(page, o);
    expect(o.affected.size).toBe(1);
    await expect(page.getByTestId('t-e2e-login')).toHaveAttribute('data-reason', 'smoke');
    await expect(page.getByTestId('t-e2e-purchase')).toHaveAttribute('data-reason', 'affected');
    await page.getByTestId('smoke').uncheck();
    o = oracle(['src/ui/CheckoutPage.tsx'], false);
    await expectMatches(page, o);
    await expect(page.getByTestId('t-e2e-login')).toHaveAttribute('data-selected', 'false');
    await expect(page.getByTestId('t-e2e-purchase')).toHaveAttribute('data-selected', 'true');   // affected beats the toggle
    await expect(page.getByTestId('risks').locator('[data-risk="no-smoke"]')).toHaveCount(1);
  });

  test('tests with no coverage data always run; switching that off saves time and is flagged as a blind spot', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('file-cart.ts').check();
    const on = oracle(['src/cart/cart.ts']);
    await expectMatches(page, on);
    await expect(page.getByTestId('t-legacy-pack')).toHaveAttribute('data-reason', 'no-coverage');
    await page.getByTestId('uncovered').uncheck();
    const off = oracle(['src/cart/cart.ts'], true, false);
    await expectMatches(page, off);
    expect(on.time - off.time).toBe(90 + 35);
    await expect(page.getByTestId('t-api-contracts')).toHaveAttribute('data-reason', 'no-coverage-skipped');
    await expect(page.getByTestId('risks').locator('[data-risk="blind"]')).toContainText('2 tests with no coverage data');
  });

  test('a docs-only change reaches no module, so only the always-run buckets are left', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-docs').click();
    const o = oracle(['README.md']);
    expect(o.affected.size).toBe(0);
    expect(o.time).toBe(90 + 35 + 60 + 120 + 45);
    await expectMatches(page, o);
    await expect(page.getByTestId('affected-list')).toContainText('No module in the graph is affected');
    await expect(page.getByTestId('risks').locator('[data-risk="outside"]')).toContainText('README.md');
  });

  test('a lockfile bump is global: the full suite runs and nothing is saved', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-lock').click();
    const o = oracle(['package-lock.json']);
    await expectMatches(page, o);
    expect(o.selected.length).toBe(TESTS.length);
    await expect(page.getByTestId('saved')).toHaveText('0%');
    await expect(page.getByTestId('selected-time')).toHaveText(fmt(FULL));
    await expect(page.locator('[data-reason="global"]')).toHaveCount(TESTS.length);
    await expect(page.getByTestId('risks').locator('[data-risk="global"]')).toHaveCount(1);
  });

  test('flags.ts has no test of its own; the risk panel says so, and its importers light up on the map', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('file-flags.ts').check();
    const o = oracle(['src/config/flags.ts']);
    await expectMatches(page, o);
    expect([...o.affected].map(base).sort()).toEqual(['CheckoutPage.tsx', 'Header.tsx', 'checkout.ts', 'flags.ts']);
    await expect(page.getByTestId('risks').locator('[data-risk="no-direct"]')).toContainText('flags.ts has no test of its own');
    for (const m of ['checkout.ts', 'Header.tsx', 'CheckoutPage.tsx']) await expect(page.getByTestId(`node-${m}`)).toHaveAttribute('data-state', 'affected');
    // the walk's edges are highlighted: exactly the imports between affected modules
    const hot = await page.locator('#graph [data-edge]').evaluateAll((es) => es.filter((e) => e.getAttribute('stroke') === '#f2a93b').map((e) => e.getAttribute('data-edge')));
    const want = Object.entries(EDGES).flatMap(([m, ds]) => ds.filter((d) => o.affected.has(m) && o.affected.has(d)).map((d) => `${m}>${d}`));
    expect(hot.sort()).toEqual(want.sort());
  });

  test('property check: 30 seeded random change sets all agree with the spec\'s BFS', async ({ page }) => {
    await page.goto(URL);
    let s = 20260925;
    const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const files = [...Object.keys(EDGES), 'README.md'];
    for (let i = 0; i < 30; i++) {
      const pick = files.filter(() => rnd() < 0.18);
      const r = await page.evaluate((f) => (window as any).__impact.select(f), pick);
      const o = oracle(pick);
      expect(new Set(r.affected), `case ${i}: ${pick.join(', ')}`).toEqual(o.affected);
      expect(r.tests.filter((t: any) => t.selected).map((t: any) => t.id)).toEqual(o.selected);
      expect(r.selTime).toBe(o.time);
      for (const [m, d] of o.dist) expect(r.dist[m]).toBe(d);
      await expect(page.getByTestId('selected-time')).toHaveText(fmt(o.time));
    }
  });

  test('keyboard, map clicks, presets and Clear all drive the same state; the summary is live', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('summary')).toHaveAttribute('aria-live', 'polite');
    const box = page.getByTestId('file-session.ts');
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await expectMatches(page, oracle(['src/auth/session.ts']));
    await expect(page.getByTestId('summary')).toHaveAttribute('aria-label', /modules affected/);
    // clicking a node on the map toggles that file too
    await page.getByTestId('node-orders.ts').click();
    await expect(page.getByTestId('file-orders.ts')).toBeChecked();
    await expectMatches(page, oracle(['src/auth/session.ts', 'src/api/orders.ts']));
    await page.getByTestId('node-orders.ts').click();
    await expect(page.getByTestId('file-orders.ts')).not.toBeChecked();
    // a preset replaces the selection; Clear empties it
    await page.getByTestId('preset-money').click();
    await expect(box).not.toBeChecked();
    await expect(page.getByTestId('file-money.ts')).toBeChecked();
    await page.getByTestId('clear').click();
    await expectMatches(page, oracle([]));
    await expect(page.getByTestId('affected-list')).toContainText('Tick a changed file');
  });
});
