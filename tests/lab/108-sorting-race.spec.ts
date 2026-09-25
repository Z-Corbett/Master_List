import { test, expect, Page } from '@playwright/test';

const URL = '/lab/108-sorting-race.html';
type Counts = { cmp: number; swaps: number; writes: number };

// Instrumented reference implementations, written independently of the page (plain loops, no generators).
// Same variants as the page states: early-exit bubble, shifting insertion, selection without self-swaps,
// top-down merge (writes back counted), Lomuto quick with last-element pivot (no self-swaps), sift-down heap.
function ref(input: number[]) {
  const out: Record<string, Counts & { arr: number[] }> = {};
  const run = (name: string, f: (a: number[], c: Counts) => void) => { const a = input.slice(), c = { cmp: 0, swaps: 0, writes: 0 }; f(a, c); out[name] = { ...c, arr: a }; };
  const swap = (a: number[], c: Counts, i: number, j: number) => { const t = a[i]; a[i] = a[j]; a[j] = t; c.swaps++; c.writes += 2; };
  run('bubble', (a, c) => {
    for (let end = a.length - 1; end > 0; end--) {
      let any = false;
      for (let i = 0; i < end; i++) { c.cmp++; if (a[i] > a[i + 1]) { swap(a, c, i, i + 1); any = true; } }
      if (!any) break;
    }
  });
  run('insertion', (a, c) => {
    for (let i = 1; i < a.length; i++) {
      const key = a[i]; let j = i - 1;
      while (j >= 0) { c.cmp++; if (a[j] > key) { a[j + 1] = a[j]; c.writes++; j--; } else break; }
      if (j + 1 !== i) { a[j + 1] = key; c.writes++; }
    }
  });
  run('selection', (a, c) => {
    for (let i = 0; i < a.length - 1; i++) {
      let m = i;
      for (let j = i + 1; j < a.length; j++) { c.cmp++; if (a[j] < a[m]) m = j; }
      if (m !== i) swap(a, c, i, m);
    }
  });
  run('merge', (a, c) => {
    const aux = a.slice();
    const sort = (lo: number, hi: number) => {
      if (hi <= lo) return;
      const mid = Math.floor((lo + hi) / 2);
      sort(lo, mid); sort(mid + 1, hi);
      for (let k = lo; k <= hi; k++) aux[k] = a[k];
      let i = lo, j = mid + 1;
      for (let k = lo; k <= hi; k++) {
        if (i > mid) a[k] = aux[j++];
        else if (j > hi) a[k] = aux[i++];
        else { c.cmp++; a[k] = aux[j] < aux[i] ? aux[j++] : aux[i++]; }
        c.writes++;
      }
    };
    sort(0, a.length - 1);
  });
  run('quick', (a, c) => {
    const qs = (lo: number, hi: number) => {
      if (lo >= hi) return;
      const p = a[hi]; let i = lo;
      for (let j = lo; j < hi; j++) { c.cmp++; if (a[j] < p) { if (i !== j) swap(a, c, i, j); i++; } }
      if (i !== hi) swap(a, c, i, hi);
      qs(lo, i - 1); qs(i + 1, hi);
    };
    qs(0, a.length - 1);
  });
  run('heap', (a, c) => {
    const n = a.length;
    const sift = (r: number, size: number) => {
      for (;;) {
        let ch = 2 * r + 1;
        if (ch >= size) return;
        if (ch + 1 < size) { c.cmp++; if (a[ch] < a[ch + 1]) ch++; }
        c.cmp++;
        if (a[r] < a[ch]) { swap(a, c, r, ch); r = ch; } else return;
      }
    };
    for (let s = Math.floor(n / 2) - 1; s >= 0; s--) sift(s, n);
    for (let end = n - 1; end > 0; end--) { swap(a, c, 0, end); sift(0, end); }
  });
  return out;
}
const lanes = (page: Page) => page.evaluate(() => (window as any).__sort.lanes as any[]);
const initial = (page: Page) => page.evaluate(() => (window as any).__sort.state.initial as number[]);
const sorted = (a: number[]) => a.slice().sort((x, y) => x - y);

async function race(page: Page, qs: string) {
  await page.clock.install({ time: new Date('2026-09-01T12:00:00Z') });
  await page.goto(URL + qs);
  // stop fake time from flowing on its own, so only runFor() moves the scheduler
  await page.clock.pauseAt(new Date('2026-09-01T12:01:00Z'));
}

test.describe('108 Sorting Race', () => {
  test('driven by page.clock, every lane ends sorted', async ({ page }) => {
    await race(page, '?seed=7');
    await expect(page.getByTestId('status')).toContainText('Ready: 40 bars, random, seed 7');
    await page.getByTestId('start').click();
    await expect(page.getByTestId('start')).toHaveText('Pause');
    await page.clock.runFor(60_000);
    await expect(page.getByTestId('status')).toContainText('Race over');
    const init = await initial(page);
    for (const l of await lanes(page)) { expect(l.done, l.key).toBe(true); expect(l.arr, l.key).toEqual(sorted(init)); }
    await expect(page.getByTestId('start')).toHaveText('Start');
    for (const k of ['bubble', 'insertion', 'selection', 'merge', 'quick', 'heap']) await expect(page.getByTestId(`place-${k}`)).toHaveText(/^[1-6](st|nd|rd|th)$/);
  });

  test('the scheduler gives every running lane the same number of operations per tick', async ({ page }) => {
    await race(page, '?seed=11&n=60');
    await page.getByTestId('speed').selectOption('4');
    await page.getByTestId('start').click();
    const tick = await page.evaluate(() => (window as any).__sort.TICK_MS);
    await page.clock.runFor(tick * 10);                       // 10 ticks × 4 ops
    let ls = await lanes(page);
    for (const l of ls) if (!l.done) expect(l.steps, l.key).toBe(40);
    await page.getByTestId('start').click();                  // pause
    await expect(page.getByTestId('start')).toHaveText('Start');
    await page.clock.runFor(tick * 20);
    ls = await lanes(page);
    for (const l of ls) if (!l.done) expect(l.steps, l.key).toBe(40);
    await page.getByTestId('step').click();                   // one op each
    ls = await lanes(page);
    for (const l of ls) if (!l.done) expect(l.steps, l.key).toBe(41);
    for (const l of ls) expect(l.steps).toBe(l.cmp + l.swaps + (l.writes - 2 * l.swaps));
  });

  test('counts match the reference implementations on every input shape', async ({ page }) => {
    await race(page, '?seed=3&n=50');
    for (const shape of ['random', 'nearly', 'reversed', 'few', 'sorted']) {
      await page.getByTestId('shape').selectOption(shape);
      await page.getByTestId('finish').click();
      await expect(page.getByTestId('status')).toContainText('Race over');
      const init = await initial(page);
      const want = ref(init);
      for (const l of await lanes(page)) {
        expect({ cmp: l.cmp, swaps: l.swaps, writes: l.writes }, `${shape}/${l.key}`).toEqual({ cmp: want[l.key].cmp, swaps: want[l.key].swaps, writes: want[l.key].writes });
        expect(l.arr, `${shape}/${l.key}`).toEqual(want[l.key].arr);
        expect(l.arr).toEqual(sorted(init));
      }
    }
  });

  test('known facts on sorted and reversed input', async ({ page }) => {
    const n = 30;
    await race(page, `?shape=sorted&n=${n}`);
    await page.getByTestId('finish').click();
    let by = Object.fromEntries((await lanes(page)).map((l) => [l.key, l]));
    expect(by.bubble.cmp).toBe(n - 1);                         // early exit after one clean pass
    expect(by.bubble.swaps).toBe(0);
    expect(by.insertion.cmp).toBe(n - 1);
    expect(by.insertion.writes).toBe(0);
    expect(by.selection.cmp).toBe((n * (n - 1)) / 2);          // selection never adapts
    expect(by.selection.swaps).toBe(0);
    expect(by.quick.cmp).toBe((n * (n - 1)) / 2);              // Lomuto's worst case
    expect(by.bubble.place).toBe(1);                           // n − 1 steps: tied with insertion
    expect(by.insertion.place).toBe(1);
    await expect(page.getByTestId('status')).toContainText('Bubble and Insertion won');
    await page.getByTestId('shape').selectOption('reversed');
    await page.getByTestId('finish').click();
    by = Object.fromEntries((await lanes(page)).map((l) => [l.key, l]));
    expect(by.bubble.cmp).toBe((n * (n - 1)) / 2);
    expect(by.bubble.swaps).toBe((n * (n - 1)) / 2);           // every pair is an inversion
    expect(by.insertion.writes).toBe((n * (n - 1)) / 2 + (n - 1));
    expect(by.selection.swaps).toBe(n / 2);                    // reversed: swaps pair up the ends
  });

  test('merge sort on a power of two: n·log2(n) writes, and between n/2·log2 n and n·log2 n − n + 1 comparisons', async ({ page }) => {
    await race(page, '?seed=5&n=64');
    await page.getByTestId('finish').click();
    const m = (await lanes(page)).find((l) => l.key === 'merge');
    expect(m.writes).toBe(64 * 6);
    expect(m.cmp).toBeGreaterThanOrEqual(32 * 6);
    expect(m.cmp).toBeLessThanOrEqual(64 * 6 - 64 + 1);
    expect(m.swaps).toBe(0);
  });

  test('seeded input shapes: the same seed repeats, different seeds differ', async ({ page }) => {
    await race(page, '?seed=7');
    const a = await initial(page);
    expect(sorted(a)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));   // a permutation of 1..n
    await page.reload();
    expect(await initial(page)).toEqual(a);
    await page.getByTestId('seed').fill('8');
    await page.getByTestId('seed').press('Enter');
    await expect(page.getByTestId('status')).toContainText('seed 8');
    expect(await initial(page)).not.toEqual(a);
    await page.getByTestId('shape').selectOption('reversed');
    expect(await initial(page)).toEqual(Array.from({ length: 40 }, (_, i) => 40 - i));
    await page.getByTestId('shape').selectOption('few');
    const few = await initial(page);
    expect(new Set(few).size).toBeLessThanOrEqual(4);
    await page.getByTestId('shape').selectOption('nearly');
    const near = await initial(page);
    let inv = 0; for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) if (near[i] > near[j]) inv++;
    expect(inv).toBeGreaterThan(0);
    expect(inv).toBeLessThanOrEqual(4);                         // round(40/10) adjacent swaps
  });

  test('places follow step counts, and the results table agrees with the lanes', async ({ page }) => {
    await race(page, '?seed=21&n=45');
    await page.getByTestId('speed').selectOption('64');
    await page.getByTestId('start').click();
    await page.clock.runFor(30_000);
    const ls = await lanes(page);
    for (const l of ls) {
      expect(l.place).toBe(1 + ls.filter((o) => o.steps < l.steps).length);
      const row = page.getByTestId(`res-${l.key}`);
      await expect(row.locator('td').nth(2)).toHaveText(String(l.steps));
      await expect(row.locator('td').nth(3)).toHaveText(String(l.cmp));
    }
    const first = ls.filter((l) => l.place === 1).map((l) => l.key);
    await expect(page.locator('#res-body tr').first()).toHaveAttribute('data-testid', `res-${first[0]}`);
    await expect(page.getByTestId('canvas-heap')).toHaveAttribute('aria-label', /finished \d(st|nd|rd|th) after \d+ steps/);
  });

  test('changing the bar count or resetting starts a fresh race; bad values are refused', async ({ page }) => {
    await race(page, '?seed=9');
    await page.getByTestId('step').click();
    expect((await lanes(page))[0].steps).toBe(1);
    await page.getByTestId('reset').click();
    expect((await lanes(page)).every((l) => l.steps === 0)).toBe(true);
    await page.getByTestId('n').fill('12');
    await page.getByTestId('n').press('Enter');
    expect(await initial(page)).toHaveLength(12);
    await page.getByTestId('n').fill('500');
    await page.getByTestId('n').press('Enter');
    await expect(page.getByTestId('n')).toHaveValue('12');
    await page.getByTestId('finish').click();
    const want = ref(await initial(page));
    for (const l of await lanes(page)) expect(l.cmp, l.key).toBe(want[l.key].cmp);
  });

  test('controls are labelled, keyboard operable, and the status is a live region', async ({ page }) => {
    await race(page, '?seed=7');
    await expect(page.getByTestId('status')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByLabel('Input')).toBeVisible();
    await expect(page.getByLabel('Bars')).toHaveValue('40');
    await page.getByTestId('step').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    for (const l of await lanes(page)) expect(l.steps).toBe(2);
    await page.getByTestId('finish').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status')).toContainText('Race over');
    await expect(page.getByTestId('lane-quick')).toContainText('Lomuto');
  });
});
