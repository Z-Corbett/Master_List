import { test, expect, Page } from '@playwright/test';

const URL = '/lab/116-live-oak.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__oak.state);
const setRange = (page: Page, id: string, v: number) =>
  page.getByTestId(id).evaluate((el: HTMLInputElement, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
const rw = (page: Page, axiom: string, rules: string, n: number, seed = 1) =>
  page.evaluate(([a, r, k, s]) => (window as any).__oak.rewrite(a, r, k, s), [axiom, rules, n, seed] as const);
/** Deterministic rewriting, done by the test itself: every symbol with a rule is replaced in parallel. */
const expand = (s: string, rules: Record<string, string>, n: number) => { for (let i = 0; i < n; i++) s = [...s].map((c) => rules[c] ?? c).join(''); return s; };

test.describe('116 Live Oak', () => {
  test('algae: A → AB, B → A grows by Fibonacci numbers, and each string is the previous two joined', async ({ page }) => {
    await page.goto(URL);
    const r = await rw(page, 'A', 'A -> AB\nB -> A', 12);
    const fib = [1, 2];
    while (fib.length < 13) fib.push(fib[fib.length - 1] + fib[fib.length - 2]);
    expect(r.lengths).toEqual(fib);                                   // 1, 2, 3, 5, 8, 13 … 377
    const s: string[] = ['A', 'AB'];
    for (let n = 2; n <= 8; n++) s.push(s[n - 1] + s[n - 2]);       // Lindenmayer's algae: s(n) = s(n−1) s(n−2)
    for (let n = 0; n <= 8; n++) expect((await rw(page, 'A', 'A -> AB\nB -> A', n)).str).toBe(s[n]);
    // through the UI
    await page.getByTestId('preset').selectOption('algae');
    await expect(page.getByTestId('string')).toHaveText('ABAABABAABAAB');
    await expect(page.getByTestId('lengths')).toHaveText('n0: 1 · n1: 2 · n2: 3 · n3: 5 · n4: 8 · n5: 13');
    await expect(page.getByTestId('segments')).toHaveText('0');
    await expect(page.getByTestId('warn')).toContainText('Nothing to draw');
  });

  test('Koch curves: the right strings, 4ⁿ and 5ⁿ segments, and an endpoint 3ⁿ steps away', async ({ page }) => {
    await page.goto(URL);
    expect((await rw(page, 'F', 'F -> F+F--F+F', 1)).str).toBe('F+F--F+F');
    for (const n of [2, 3]) expect((await rw(page, 'F', 'F -> F+F--F+F', n)).str).toBe(expand('F', { F: 'F+F--F+F' }, n));
    for (const [rule, angle, base] of [['F+F--F+F', 60, 4], ['F+F-F-F+F', 90, 5]] as const) {
      for (let n = 0; n <= 4; n++) {
        const str = expand('F', { F: rule }, n);
        const t = await page.evaluate(([s, a]) => (window as any).__oak.turtle(s, a, 0), [str, angle] as const);
        expect(t.segments).toBe(base ** n);
        expect(t.end.x).toBeCloseTo(3 ** n, 6);                        // each generation is three times as wide
        expect(t.end.y).toBeCloseTo(0, 6);
      }
    }
    await page.getByTestId('preset').selectOption('koch');
    await expect(page.getByTestId('angle-out')).toHaveText('60°');
    await expect(page.getByTestId('segments')).toHaveText('256');
    expect((await S(page)).end.x).toBeCloseTo(81 * 10, 4);             // the page's step is 10 units
  });

  test('the same seed grows the same tree; another seed grows a different one', async ({ page }) => {
    await page.goto(URL);
    const a = await S(page);
    const segA = await page.evaluate(() => (window as any).__oak.segments());
    expect(a.seed).toBe(7);
    await expect(page.getByTestId('seed-out')).toHaveText('7');
    await page.reload();
    expect((await S(page)).hash).toBe(a.hash);
    expect(await page.evaluate(() => (window as any).__oak.segments())).toEqual(segA);
    await page.goto('/lab/116-live-oak.html?seed=8');
    const b = await S(page);
    expect(b.hash).not.toBe(a.hash);
    // typing a seed rewrites the address so the tree can be shared
    await page.getByTestId('seed').fill('7');
    await page.getByTestId('seed').press('Enter');
    await page.getByTestId('seed').blur();
    await expect(page).toHaveURL(/seed=7/);
    expect((await S(page)).hash).toBe(a.hash);
    // a deterministic system ignores the seed
    await page.getByTestId('preset').selectOption('plant');
    const p7 = (await S(page)).hash;
    await page.getByTestId('seed').fill('12345');
    await page.getByTestId('seed').blur();
    expect((await S(page)).hash).toBe(p7);
  });

  test('segment count stays inside the bounds the rules allow, for every seed', async ({ page }) => {
    await page.goto(URL);
    const rulesText = await page.getByTestId('rules').inputValue();
    const axiom = await page.getByTestId('axiom').inputValue();
    // parse the rules independently and find the fewest and most F segments any sequence of choices can give
    const rules: Record<string, string[]> = {};
    for (const line of rulesText.split('\n')) {
      const m = line.replace(/#.*/, '').trim().match(/^(\S)\s*(?:\([\d.]+\))?\s*->\s*(\S*)$/);
      if (m) (rules[m[1]] ??= []).push(m[2]);
    }
    expect(Object.keys(rules).sort()).toEqual(['A', 'B']);
    const memo = new Map<string, [number, number]>();
    const range = (c: string, n: number): [number, number] => {
      const key = c + n;
      if (memo.has(key)) return memo.get(key)!;
      let out: [number, number];
      if (n === 0 || !rules[c]) out = c === 'F' || c === 'G' ? [1, 1] : [0, 0];
      else out = rules[c].map((s) => [...s].reduce((acc, ch) => { const r = range(ch, n - 1); return [acc[0] + r[0], acc[1] + r[1]]; }, [0, 0] as [number, number]))
        .reduce((a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])]);
      memo.set(key, out);
      return out;
    };
    const bounds = (n: number) => [...axiom].reduce((acc, ch) => { const r = range(ch, n); return [acc[0] + r[0], acc[1] + r[1]]; }, [0, 0]);
    const [lo, hi] = bounds(7);
    expect(lo).toBeLessThan(hi);
    const counts = new Set<number>();
    for (const seed of [1, 2, 3, 7, 99, 2024]) {
      await page.getByTestId('seed').fill(String(seed));
      await page.getByTestId('seed').blur();
      const s = await S(page);
      expect(s.segments).toBeGreaterThanOrEqual(lo);
      expect(s.segments).toBeLessThanOrEqual(hi);
      counts.add(s.segments);
    }
    expect(counts.size).toBeGreaterThan(1);                             // the rules really are stochastic
    // fewer iterations, tighter bounds
    await setRange(page, 'iter', 4);
    const s4 = await S(page);
    expect(s4.segments).toBeGreaterThanOrEqual(bounds(4)[0]);
    expect(s4.segments).toBeLessThanOrEqual(bounds(4)[1]);
    await setRange(page, 'iter', 0);
    expect((await S(page)).segments).toBe(2);                           // the axiom FFA draws its two trunk steps
  });

  test('runaway growth is capped: the fractal plant stops before 200,000 symbols', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset').selectOption('plant');
    const rules = { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' };
    await setRange(page, 'iter', 6);
    let s = await S(page);
    const six = expand('X', rules, 6);
    expect(s.length).toBe(six.length);
    expect(s.segments).toBe((six.match(/F/g) || []).length);
    await setRange(page, 'iter', 8);
    s = await S(page);
    const seven = expand(six, rules, 1);
    expect(expand(seven, rules, 1).length).toBeGreaterThan(200000);
    expect(s.stopped).toBe(7);
    expect(s.length).toBe(seven.length);
    expect(s.segments).toBe((seven.match(/F/g) || []).length);
    expect(s.segments).toBeLessThanOrEqual(200000);
    await expect(page.getByTestId('warn')).toHaveText('Stopped after 7 iterations: the next would pass 200,000 symbols.');
  });

  test('the rules editor: custom rules, weights and a helpful parse error', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset').selectOption('koch');
    await page.getByTestId('axiom').fill('F');
    await page.getByTestId('rules').fill('F -> F+F-F-F+F');
    await setRange(page, 'angle', 90);
    await setRange(page, 'iter', 3);
    await expect(page.getByTestId('segments')).toHaveText('125');
    const good = (await S(page)).hash;
    await page.getByTestId('rules').fill('F => FF');
    await expect(page.getByTestId('rule-error')).toContainText('Line 1: write a rule as "X -> FX" or "X (0.4) -> FX".');
    expect((await S(page)).hash).toBe(good);                            // the last good drawing stays up
    await page.getByTestId('rules').fill('F (0) -> FF');
    await expect(page.getByTestId('rule-error')).toContainText("weight must be more than 0");
    // a weighted pair: over many symbols both choices appear, roughly in proportion
    const r = await rw(page, 'X'.repeat(200), 'X (3) -> a\nX (1) -> b', 1, 5);
    const a = (r.str.match(/a/g) || []).length, b = (r.str.match(/b/g) || []).length;
    expect(a + b).toBe(200);
    expect(a / 200).toBeGreaterThan(0.6);
    expect(a / 200).toBeLessThan(0.9);
    await page.getByTestId('rules').fill('F -> FF+F');
    await expect(page.getByTestId('rule-error')).toHaveText('');
    await setRange(page, 'iter', 2);
    await expect(page.getByTestId('string')).toHaveText(expand('F', { F: 'FF+F' }, 2));
  });

  test('turtle explainer: each segment is traced to the symbol that drew it', async ({ page }) => {
    await page.goto(URL);
    const ex = await page.evaluate(() => (window as any).__oak.explainer);
    expect(ex.n).toBe(2);
    expect(ex.str).toBe((await rw(page, 'FFA', await page.getByTestId('rules').inputValue(), 2, 7)).str);
    const fIdx = [...ex.str].map((c: string, i: number) => (c === 'F' ? i : -1)).filter((i: number) => i >= 0);
    expect(ex.segs.map((s: any) => s.i)).toEqual(fIdx);                 // one segment per F, in order
    await expect(page.locator('[data-testid="ex-seg"], [data-testid="ex-hot"]')).toHaveCount(fIdx.length);
    // step to the third F: its segment turns hot and its symbol is highlighted
    await setRange(page, 'ex-step', fIdx[2]);
    await expect(page.getByTestId('ex-hot')).toHaveAttribute('data-i', String(fIdx[2]));
    await expect(page.getByTestId('ex-cur')).toHaveText('F');
    await expect(page.getByTestId('ex-caption')).toContainText('draw forward one step. That\'s segment 3 of');
    await expect(page.locator('#exSegs line[data-state="done"]')).toHaveCount(2);
    // one step on is a non-drawing symbol, and nothing is hot
    await page.getByTestId('ex-next').click();
    const nxt = ex.str[fIdx[2] + 1];
    await expect(page.getByTestId('ex-cur')).toHaveText(nxt);
    if (nxt !== 'F') await expect(page.getByTestId('ex-hot')).toHaveCount(0);
    const firstBracket = ex.str.indexOf('[');
    await setRange(page, 'ex-step', firstBracket);
    await expect(page.getByTestId('ex-caption')).toContainText('[: save the turtle');
    // clicking a segment finds its symbol
    const last = fIdx[fIdx.length - 1];
    await page.locator(`#exSegs line[data-i="${last}"]`).dispatchEvent('click');
    await expect(page.getByTestId('ex-step')).toHaveValue(String(last));
    await expect(page.getByTestId('ex-hot')).toHaveAttribute('data-i', String(last));
    await expect(page.getByTestId('ex-caption')).toContainText(`segment ${fIdx.length} of ${fIdx.length}`);
    await expect(page.getByTestId('ex-step')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('ex-cur')).toHaveText(ex.str[0]);
  });

  test('seasons and light change the scene, never the tree; the oak stays green in winter', async ({ page }) => {
    await page.goto(URL);
    const base = await S(page);
    expect(base.moss).toBeGreaterThan(20);
    expect(base.moss).toBeLessThanOrEqual(320);
    expect(base.leaves).toBeGreaterThan(50);
    for (const season of ['winter', 'spring', 'fall']) {
      await page.getByTestId('season').selectOption(season);
      const s = await S(page);
      expect(s.hash).toBe(base.hash);
      expect(s.moss).toBe(base.moss);
    }
    await page.getByTestId('season').selectOption('winter');
    await expect(page.getByTestId('season-note')).toContainText('evergreen');
    await page.getByTestId('season').selectOption('spring');
    await expect(page.getByTestId('season-note')).toContainText("drop last year's leaves as the new ones push out");
    await page.getByTestId('tod').selectOption('night');
    await expect(page.getByTestId('canvas')).toHaveAttribute('aria-label', /spring at night/);
    expect((await S(page)).hash).toBe(base.hash);
    await page.getByTestId('moss-on').uncheck();
    expect((await S(page)).moss).toBe(0);
    await expect(page.getByTestId('moss')).toHaveText('0');
  });

  test('a live oak grows wider than it is tall, and sprawl is what flattens it', async ({ page }) => {
    await page.goto(URL);
    const ratios = (sprawl: number) => page.evaluate((sp) => {
      const el = document.getElementById('sprawl') as HTMLInputElement; el.value = String(sp); el.dispatchEvent(new Event('input'));
      const out: number[] = [];
      for (let seed = 1; seed <= 16; seed++) { const i = document.getElementById('seed') as HTMLInputElement; i.value = String(seed); i.dispatchEvent(new Event('change')); out.push((window as any).__oak.state.ratio); }
      return out;
    }, sprawl);
    const mean = (xs: number[]) => xs.reduce((p, q) => p + q, 0) / xs.length;
    const sprawled = await ratios(70), upright = await ratios(0);
    expect(Math.min(...sprawled)).toBeGreaterThan(1.1);                 // every seed is wider than tall
    expect(mean(sprawled)).toBeGreaterThan(1.35);
    expect(mean(upright)).toBeLessThan(mean(sprawled) - 0.1);           // without the pull toward level it stands taller
    await expect(page.getByTestId('sprawl-out')).toHaveText('0%');
    // angle and randomness change the drawing, not the rewritten string
    const before = await S(page);
    await setRange(page, 'angle', 30);
    const after = await S(page);
    expect(after.length).toBe(before.length);
    expect(after.hash).not.toBe(before.hash);
    await setRange(page, 'rand', 0);
    await expect(page.getByTestId('rand-out')).toHaveText('0%');
    expect((await S(page)).length).toBe(before.length);
  });
});
