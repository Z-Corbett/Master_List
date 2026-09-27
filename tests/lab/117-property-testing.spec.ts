import { test, expect, Page } from '@playwright/test';

const URL = '/lab/117-property-testing.html?seed=7';
const run = (page: Page, fn: string, impl: string, prop: string, seed: number) =>
  page.evaluate((a) => (window as any).__pbt.run(a), { fn, impl, prop, seed });

async function pick(page: Page, fn: string, impl: 'buggy' | 'fixed', prop: string) {
  await page.getByTestId('fn').selectOption(fn);
  await page.getByTestId(`impl-${impl}`).check({ force: true });
  await page.getByTestId('prop').selectOption(prop);
}

test.describe('117 Property-Based Testing Lab', () => {
  test('the dedup sort shrinks to [0, 0] from every seed (oracle and permutation properties)', async ({ page }) => {
    await page.goto(URL);
    for (const prop of ['oracle', 'perm']) {
      for (let seed = 1; seed <= 25; seed++) {
        const r = await run(page, 'sort', 'buggy', prop, seed);
        expect(r.passed, `seed ${seed} should find the bug`).toBe(false);
        expect(r.minimal, `${prop} seed ${seed}`).toEqual([0, 0]);
        // the original counterexample really does contain a duplicate
        expect(new Set(r.original).size).toBeLessThan(r.original.length);
      }
    }
    // and in the UI
    await expect(page.getByTestId('minimal')).toHaveText('[0, 0]');
    await expect(page.getByTestId('verdict')).toContainText('Falsified');
  });

  test('the other bugs shrink to their known minimal counterexamples', async ({ page }) => {
    await page.goto(URL);
    for (let seed = 1; seed <= 20; seed++) {
      // RLE: a lone digit is misread as part of the count ("10" decodes to "10")
      expect((await run(page, 'rle', 'buggy', 'roundtrip', seed)).minimal).toBe('0');
      // overlap: two one-day bookings on the same day (1 Jan) are said not to overlap
      expect((await run(page, 'overlap', 'buggy', 'oracle', seed)).minimal).toEqual({ a: { start: 0, len: 0 }, b: { start: 0, len: 0 } });
      expect((await run(page, 'overlap', 'buggy', 'reflexive', seed)).minimal).toEqual({ start: 0, len: 0 });
      // money: 1 cent split two ways loses the cent
      expect((await run(page, 'split', 'buggy', 'total', seed)).minimal).toEqual({ cents: 1, ways: 2 });
      expect((await run(page, 'split', 'buggy', 'oracle', seed)).minimal).toEqual({ cents: 1, ways: 2 });
    }
    // the minimal inputs fail for the reason the page says, checked against the functions directly
    const facts = await page.evaluate(() => {
      const P = (window as any).__pbt;
      const rle = P.impl('rle', 'buggy'), ov = P.impl('overlap', 'buggy'), sp = P.impl('split', 'buggy'), so = P.impl('sort', 'buggy');
      return { e: rle.encode('0'), d: rle.decode(rle.encode('0')), ov: ov({ start: 0, end: 0 }, { start: 0, end: 0 }), sp: sp(1, 2), so: so([0, 0]) };
    });
    expect(facts).toEqual({ e: '10', d: '10', ov: false, sp: [0, 0], so: [0] });
  });

  test('every shrink step still fails and is no bigger than the one before', async ({ page }) => {
    await page.goto(URL);
    const size = (v: any): number => (Array.isArray(v) ? v.length * 1000 + v.reduce((a: number, x: number) => a + Math.abs(x), 0)
      : typeof v === 'string' ? v.length * 10 + [...v].reduce((a, c) => a + 'ab01'.indexOf(c), 0)
      : typeof v === 'number' ? Math.abs(v) : Object.values(v).reduce((a: number, x) => a + size(x), 0));
    for (const [fn, prop] of [['sort', 'oracle'], ['rle', 'roundtrip'], ['overlap', 'oracle'], ['split', 'total']]) {
      let r: any, seed = 0;
      do r = await run(page, fn, 'buggy', prop, ++seed); while (r.steps.length < 3 && seed < 60);
      expect(r.steps.length, `${fn}: a seed with a few shrink steps`).toBeGreaterThanOrEqual(3);
      for (let k = 1; k < r.steps.length; k++) expect(size(r.steps[k].value), `${fn} step ${k}`).toBeLessThan(size(r.steps[k - 1].value));
      const stillFail = await page.evaluate(({ fn, steps }) => {
        const P = (window as any).__pbt, f = P.impl(fn, 'buggy');
        return steps.map((s: any) => {
          const v = s.value;
          if (fn === 'sort') return JSON.stringify(f(v)) !== JSON.stringify([...v].sort((a: number, b: number) => a - b));
          if (fn === 'rle') { try { return f.decode(f.encode(v)) !== v; } catch { return true; } }
          if (fn === 'overlap') { const a = { start: v.a.start, end: v.a.start + v.a.len }, b = { start: v.b.start, end: v.b.start + v.b.len }; return f(a, b) !== (a.start <= b.end && b.start <= a.end); }
          return f(v.cents, v.ways).reduce((x: number, y: number) => x + y, 0) !== v.cents;
        });
      }, { fn, steps: r.steps });
      expect(stillFail.every(Boolean), `${fn}: every step is a counterexample`).toBe(true);
    }
  });

  test('the fixed implementations pass all 100 cases of every property, for many seeds', async ({ page }) => {
    await page.goto(URL);
    const res = await page.evaluate(() => {
      const P = (window as any).__pbt, out: string[] = [];
      for (const [fn, props] of Object.entries(P.FNS) as [string, string[]][]) for (const prop of props) for (let seed = 0; seed < 10; seed++) {
        const r = P.run({ fn, impl: 'fixed', prop, seed });
        if (!r.passed || r.cases.length !== 100) out.push(`${fn}/${prop}/${seed}`);
      }
      return out;
    });
    expect(res).toEqual([]);
    await pick(page, 'split', 'fixed', 'total');
    await expect(page.getByTestId('verdict')).toHaveText('OK: the property held for all 100 cases (seed 7).');
    await expect(page.locator('[data-testid^="case-"][data-state="pass"]')).toHaveCount(100);
    await expect(page.getByTestId('skip')).toBeDisabled();
  });

  test('some properties cannot see a bug: idempotence and ordering pass on the dedup sort', async ({ page }) => {
    await page.goto(URL);
    for (let seed = 0; seed < 10; seed++) {
      expect((await run(page, 'sort', 'buggy', 'idem', seed)).passed).toBe(true);
      expect((await run(page, 'sort', 'buggy', 'ordered', seed)).passed).toBe(true);
      expect((await run(page, 'overlap', 'buggy', 'symmetric', seed)).passed).toBe(true);
      expect((await run(page, 'split', 'buggy', 'fair', seed)).passed).toBe(true);
    }
    await pick(page, 'sort', 'buggy', 'idem');
    await expect(page.getByTestId('verdict')).toContainText('held for all 100');
    await expect(page.getByTestId('why')).toContainText('this property just can’t see it');
  });

  test('runs are deterministic per seed, and different seeds generate different cases', async ({ page }) => {
    await page.goto(URL);
    const a = await run(page, 'sort', 'buggy', 'oracle', 1234);
    const b = await run(page, 'sort', 'buggy', 'oracle', 1234);
    expect(b).toEqual(a);
    const inputs = await page.evaluate(() => {
      const P = (window as any).__pbt;
      return [1, 2, 3].map((s) => JSON.stringify(Array.from({ length: 30 }, (_, i) => P.sample('rle', 'roundtrip', s, i))));
    });
    expect(new Set(inputs).size).toBe(3);
    // case i does not depend on what ran before it: the i-th sample equals the i-th case of a full run
    const r = await run(page, 'split', 'fixed', 'total', 5);
    const s = await page.evaluate(() => (window as any).__pbt.sample('split', 'total', 5, 42));
    expect(r.cases[42].input).toEqual(s);
    // the seed from the URL is used, and a reload with the same seed gives the same verdict
    await expect(page.getByTestId('seed')).toHaveValue('7');
    const v = await page.getByTestId('verdict').textContent();
    await page.reload();
    await expect(page.getByTestId('verdict')).toHaveText(v!);
  });

  test('generators respect their bounds and grow with size', async ({ page }) => {
    await page.goto(URL);
    const g = await page.evaluate(() => {
      const P = (window as any).__pbt;
      const samples = (fn: string, prop: string) => Array.from({ length: 100 }, (_, i) => P.sample(fn, prop, 3, i));
      return { sort: samples('sort', 'oracle'), rle: samples('rle', 'roundtrip'), split: samples('split', 'total'), ov: samples('overlap', 'oracle'), int: P.shrinkInt(3, 0), big: P.shrinkInt(1000, 0) };
    });
    for (const [i, xs] of g.sort.entries()) {
      expect(xs.length).toBeLessThanOrEqual(12);
      const size = Math.min(50, 1 + (i >> 1));
      for (const x of xs) expect(Math.abs(x)).toBeLessThanOrEqual(size);
    }
    for (const s of g.rle) expect(s).toMatch(/^[ab01]{0,10}$/);
    for (const v of g.split) { expect(v.ways).toBeGreaterThanOrEqual(1); expect(v.ways).toBeLessThanOrEqual(12); expect(v.cents).toBeGreaterThanOrEqual(0); }
    for (const v of g.ov) for (const r of [v.a, v.b]) { expect(r.len).toBeGreaterThanOrEqual(0); expect(r.len).toBeLessThanOrEqual(6); }
    expect(g.sort.slice(0, 10).every((xs: number[]) => xs.length <= 5)).toBe(true);      // early cases are small
    expect(g.sort.slice(60).some((xs: number[]) => xs.length >= 8)).toBe(true);           // later ones grow
    expect(g.int).toEqual([0, 1, 2]);                                                    // small ints: every nearer value
    expect(g.big.slice(0, 7)).toEqual([0, 1, 2, 3, 4, 500, 750]);                                  // large ints: target, then halving
    expect(g.big.at(-1)).toBe(999);
  });

  test('watching the shrinker: Run animates one step per tick under page.clock; Step and Skip work', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-26T12:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-26T12:00:02Z'));
    await pick(page, 'sort', 'buggy', 'oracle');
    // a seed whose counterexample takes a few steps to shrink
    const seed = await page.evaluate(() => { let s = 0; while (s < 200 && (window as any).__pbt.run({ fn: 'sort', impl: 'buggy', prop: 'oracle', seed: s }).steps.length < 5) s++; return s; });
    expect(seed).toBeLessThan(200);
    await page.getByTestId('seed').fill(String(seed));
    await page.getByTestId('run').click();
    expect(page.url()).toContain(`seed=${seed}`);
    const n = await page.evaluate(() => (window as any).__pbt.result.steps.length);
    expect(n).toBeGreaterThan(2);
    expect(await page.evaluate(() => (window as any).__pbt.shown)).toBe(0);
    await expect(page.getByTestId('shrink-card')).toHaveAttribute('data-state', 'shrinking');
    await page.clock.runFor(350);
    expect(await page.evaluate(() => (window as any).__pbt.shown)).toBe(1);
    await expect(page.getByTestId('step-1')).toHaveAttribute('aria-current', 'step');
    await page.clock.runFor(350 * n);
    expect(await page.evaluate(() => (window as any).__pbt.shown)).toBe(n - 1);
    await expect(page.getByTestId('shrink-card')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('minimal')).toHaveText('[0, 0]');
    await expect(page.getByTestId('why')).toContainText('sortNums([0, 0]) = [0], reference gives [0, 0]');
    // the money split, through the UI: one cent between two people
    await pick(page, 'split', 'buggy', 'total');
    await expect(page.getByTestId('minimal')).toHaveText('$0.01 split 2 ways');
    await expect(page.getByTestId('why')).toContainText('split(1, 2) = [0, 0], sum 0 of 1');
    await pick(page, 'sort', 'buggy', 'oracle');
    // replay then step manually, then skip to the end
    await page.getByTestId('play').click();
    await page.getByTestId('step-btn').click();
    await page.getByTestId('step-btn').click();
    expect(await page.evaluate(() => (window as any).__pbt.shown)).toBe(2);
    await page.getByTestId('skip').click();
    expect(await page.evaluate(() => (window as any).__pbt.shown)).toBe(n - 1);
    await expect(page.getByTestId('step-btn')).toBeDisabled();
  });

  test('case grid: stops at the first failure, and cells are keyboard navigable', async ({ page }) => {
    await page.goto(URL);
    await pick(page, 'rle', 'buggy', 'roundtrip');
    const r = await page.evaluate(() => (window as any).__pbt.result);
    const f = r.failIndex;
    await expect(page.locator('[data-state="pass"]')).toHaveCount(f);
    await expect(page.locator('[data-state="fail"]')).toHaveCount(1);
    await expect(page.locator('[data-state="skipped"]')).toHaveCount(100 - f - 1);
    await expect(page.getByTestId(`case-${f}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('detail')).toContainText('FAILED');
    await page.getByTestId('case-0').click();
    await expect(page.getByTestId('case-0')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('case-1')).toBeFocused();
    await expect(page.getByTestId('detail')).toContainText('case 2 ·');
    await page.keyboard.press('End');
    await expect(page.getByTestId('case-99')).toBeFocused();
    await expect(page.getByTestId('detail')).toContainText('was not run');
  });

  test('the page explains the code and the generator for each choice', async ({ page }) => {
    await page.goto(URL);
    await pick(page, 'overlap', 'buggy', 'oracle');
    await expect(page.getByTestId('code')).toContainText('a.start < b.end');
    await page.getByTestId('impl-fixed').check({ force: true });
    await expect(page.getByTestId('code')).toContainText('a.start <= b.end');
    await expect(page.getByTestId('prop-code')).toContainText('// oracle');
    await expect(page.getByTestId('gen')).toContainText('{ a: { start: int 0…364');
    await page.getByTestId('fn').selectOption('rle');
    await expect(page.getByTestId('prop').locator('option')).toHaveCount(3);
    await expect(page.getByTestId('prop-code')).toContainText('// round-trip');
    await page.getByTestId('fn').selectOption('sort');
    await page.getByTestId('prop').selectOption('idem');
    await expect(page.getByTestId('prop-code')).toContainText('// idempotence');
  });
});
