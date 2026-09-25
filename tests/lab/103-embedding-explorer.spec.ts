import { test, expect, Page } from '@playwright/test';

const URL = '/lab/103-embedding-explorer.html';
type Vec = number[];
const E = (page: Page) => page.evaluate(() => {
  const e = (window as any).__emb;
  return { words: e.words as string[], vectors: e.vectors as Vec[], pca: e.pca, state: e.state, groups: e.groups };
});

// ---- the spec's own maths, independent of the page ----
const dot = (a: Vec, b: Vec) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (a: Vec) => Math.sqrt(dot(a, a));
const cos = (a: Vec, b: Vec) => dot(a, b) / (norm(a) * norm(b));
const dist = (a: Vec, b: Vec) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
const unit = (a: Vec) => a.map((x) => x / norm(a));
type Metric = 'cosine' | 'dot' | 'euclid';
function ranking(words: string[], vecs: Vec[], q: Vec, metric: Metric, skip: string[]) {
  const f = metric === 'cosine' ? cos : metric === 'dot' ? dot : dist;
  return words.map((w, i) => ({ w, s: f(q, vecs[i]) }))
    .filter((r) => !skip.includes(r.w))
    .sort((a, b) => (metric === 'euclid' ? a.s - b.s : b.s - a.s) || (a.w < b.w ? -1 : 1));
}
/** cyclic Jacobi eigenvalue algorithm for a symmetric matrix: returns eigenpairs sorted by eigenvalue, descending */
function jacobi(A0: number[][]) {
  const n = A0.length, A = A0.map((r) => r.slice());
  const V = A.map((_, i) => A.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return A.map((_, i) => ({ val: A[i][i], vec: V.map((r) => r[i]) })).sort((a, b) => b.val - a.val);
}
function covariance(vecs: Vec[]) {
  const n = vecs.length, d = vecs[0].length;
  const mean = Array.from({ length: d }, (_, j) => vecs.reduce((s, v) => s + v[j], 0) / n);
  const X = vecs.map((v) => v.map((x, j) => x - mean[j]));
  const C = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0) / (n - 1)));
  return { mean, X, C };
}
const words = async (page: Page, prefix: string, n: number) => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await page.getByTestId(`${prefix}-${i}`).getAttribute('data-word')) ?? (await page.getByTestId(`${prefix}-${i}`).textContent())!.trim());
  return out;
};

test.describe('103 Embedding Space Explorer', () => {
  test('forty labelled words with 8-dimensional vectors, all plotted', async ({ page }) => {
    await page.goto(URL);
    const s = await E(page);
    expect(s.words).toHaveLength(40);
    expect(new Set(s.words).size).toBe(40);
    for (const v of s.vectors) { expect(v).toHaveLength(8); expect(norm(v)).toBeGreaterThan(0); }
    await expect(page.locator('#plot .pt')).toHaveCount(40);
    await expect(page.getByTestId('pt-king')).toHaveAttribute('aria-label', 'king (people)');
    await expect(page.getByTestId('word-select').locator('option')).toHaveCount(40);
    // two hand-checked vectors: dog·cat = 1, ‖dog‖ = √1.01, ‖cat‖ = √1.0025 → cos ≈ 0.99380
    const raw = await page.evaluate(() => (window as any).__emb.raw);
    expect(raw.dog).toEqual([0, 0.1, 0, 1, 0, 0, 0, 0]);
    expect(raw.cat).toEqual([0, 0, 0, 1, 0, 0, 0, 0.05]);
    expect(1 / (Math.sqrt(1.01) * Math.sqrt(1.0025))).toBeCloseTo(0.99380, 5);
    expect(cos(raw.dog, raw.cat)).toBeCloseTo(0.99380, 5);
  });

  test('PCA by power iteration matches an independent Jacobi eigen-decomposition', async ({ page }) => {
    await page.goto(URL);
    const s = await E(page);
    const { C } = covariance(s.vectors);
    const eig = jacobi(C);
    const trace = C.reduce((t, r, i) => t + r[i], 0);
    for (let c = 0; c < 2; c++) {
      expect(Math.abs(s.pca.eigenvalues[c] - eig[c].val)).toBeLessThan(1e-9);
      expect(Math.abs(dot(s.pca.components[c], eig[c].vec))).toBeGreaterThan(1 - 1e-8);   // equal up to sign
      expect(norm(s.pca.components[c])).toBeCloseTo(1, 10);
    }
    expect(Math.abs(dot(s.pca.components[0], s.pca.components[1]))).toBeLessThan(1e-8);
    expect(eig[0].val).toBeGreaterThan(eig[1].val);
    const pct = (x: number) => ((x / trace) * 100).toFixed(1);
    await expect(page.getByTestId('pca-note')).toContainText(`${pct(eig[0].val)}% and ${pct(eig[1].val)}%`);
  });

  test('each point sits at its projection (x − μ) · v onto the two components', async ({ page }) => {
    await page.goto(URL);
    const s = await E(page);
    const { X } = covariance(s.vectors);
    for (const [i, w] of s.words.entries()) {
      const pt = page.getByTestId(`pt-${w}`);
      const pc1 = parseFloat((await pt.getAttribute('data-pc1'))!), pc2 = parseFloat((await pt.getAttribute('data-pc2'))!);
      expect(pc1).toBeCloseTo(dot(X[i], s.pca.components[0]), 9);
      expect(pc2).toBeCloseTo(dot(X[i], s.pca.components[1]), 9);
    }
    // projections are centred: the mean of each coordinate is 0
    const m1 = s.pca.projected.reduce((a: number, p: number[]) => a + p[0], 0) / 40;
    expect(Math.abs(m1)).toBeLessThan(1e-12);
  });

  test('clicking a point lists its k nearest neighbours by cosine, as the spec ranks them', async ({ page }) => {
    await page.goto(URL);
    const s = await E(page);
    // click whichever point has no other point within 30 px, so the tap is unambiguous
    const target = await page.evaluate(() => {
      const pts = [...document.querySelectorAll<SVGGElement>('#plot .pt')].map((g) => { const r = g.getBoundingClientRect(); return { w: g.dataset.word!, x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      return pts.filter((p) => p.w !== 'king').find((p) => pts.every((q) => q === p || Math.hypot(q.x - p.x, q.y - p.y) > 30))!.w;
    });
    await page.getByTestId(`pt-${target}`).locator('circle').first().click();
    await expect(page.getByTestId(`pt-${target}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('word-select')).toHaveValue(target);
    const i = s.words.indexOf(target);
    const want = ranking(s.words, s.vectors, s.vectors[i], 'cosine', [target]).slice(0, 5);
    for (const [r, n] of want.entries()) {
      await expect(page.getByTestId(`nn-word-${r}`)).toHaveText(n.w);
      await expect(page.getByTestId(`nn-cos-${r}`)).toHaveText(n.s.toFixed(3));
    }
    await expect(page.getByTestId('nn-lines').locator('line')).toHaveCount(5);
    await expect(page.getByTestId('nn-summary')).toContainText(want.map((n) => n.w).join(', '));
  });

  test('changing k and the word select updates the neighbour list', async ({ page }) => {
    await page.goto(URL);
    const s = await E(page);
    await page.getByTestId('word-select').selectOption('apple');
    await page.getByTestId('k').fill('8');
    await expect(page.locator('[data-testid^="nn-row-"]')).toHaveCount(8);
    await expect(page.getByTestId('nn-lines').locator('line')).toHaveCount(8);
    const a = s.vectors[s.words.indexOf('apple')];
    const want = ranking(s.words, s.vectors, a, 'cosine', ['apple']).slice(0, 8).map((n) => n.w);
    expect(await words(page, 'nn-word', 8)).toEqual(want);
    expect(want[0]).toBe('banana');                                  // hand check: sweet fruit is closest
    await page.getByTestId('k').fill('2');
    await expect(page.locator('[data-testid^="nn-row-"]')).toHaveCount(2);
    // the vector bars show the raw numbers and the norm √(1 + 0.7²)
    await expect(page.getByTestId('dim-4')).toHaveText('1.00');
    await expect(page.getByTestId('dim-7')).toHaveText('0.70');
    await expect(page.getByTestId('norm')).toHaveText(`‖apple‖ = ${Math.sqrt(1.49).toFixed(3)}`);
  });

  test('keyboard: arrow keys move the selection round the map, Enter selects', async ({ page }) => {
    await page.goto(URL);
    const s = await E(page);
    const king = page.getByTestId('pt-king');
    await expect(king).toHaveAttribute('tabindex', '0');
    await king.focus();
    await page.keyboard.press('ArrowRight');
    const next = s.words[s.words.indexOf('king') + 1];
    await expect(page.getByTestId(`pt-${next}`)).toBeFocused();
    await expect(page.getByTestId(`pt-${next}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pt-king')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId(`pt-${s.words[39]}`)).toBeFocused();     // wraps round to the last word
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('nn-summary')).toContainText(`${s.words[39]}:`);
    await expect(page.getByTestId('nn-summary')).toHaveAttribute('aria-live', 'polite');
  });

  test('king − man + woman ≈ queen, and puppy − dog + cat ≈ kitten, ranked by the spec', async ({ page }) => {
    await page.goto(URL);
    const s = await E(page);
    const V = (w: string) => s.vectors[s.words.indexOf(w)];
    const check = async (a: string, b: string, c: string, expected: string) => {
      const r = V(a).map((x, i) => x - V(b)[i] + V(c)[i]);
      const want = ranking(s.words, s.vectors, r, 'cosine', [a, b, c]).slice(0, 5);
      expect(want[0].w).toBe(expected);
      for (const [i, n] of want.entries()) {
        await expect(page.getByTestId(`ana-word-${i}`)).toHaveText(n.w);
        await expect(page.getByTestId(`ana-cos-${i}`)).toHaveText(n.s.toFixed(3));
      }
      await expect(page.getByTestId('ana-result')).toHaveText(`${a} − ${b} + ${c} ≈ ${expected} (cosine ${want[0].s.toFixed(3)})`);
    };
    await check('king', 'man', 'woman', 'queen');                    // the default
    await page.getByTestId('ex-puppy').click();
    await check('puppy', 'dog', 'cat', 'kitten');
    // pick an equation by hand with the selects
    await page.getByTestId('ana-a').selectOption('prince');
    await page.getByTestId('ana-b').selectOption('boy');
    await page.getByTestId('ana-c').selectOption('girl');
    await check('prince', 'boy', 'girl', 'princess');
    await expect(page.getByTestId('analogy-mark')).toHaveCount(1);
  });

  test('including the input words changes the ranking, and inputs are tagged', async ({ page }) => {
    await page.goto(URL);
    const s = await E(page);
    const V = (w: string) => s.vectors[s.words.indexOf(w)];
    await page.getByTestId('ex-puppy').click();
    await page.getByTestId('exclude').uncheck();
    const r = V('puppy').map((x, i) => x - V('dog')[i] + V('cat')[i]);
    const all = ranking(s.words, s.vectors, r, 'cosine', []).slice(0, 5);
    for (const [i, n] of all.entries()) await expect(page.getByTestId(`ana-word-${i}`)).toHaveText(n.w);
    // puppy, an input, now appears in the top five and is labelled as one
    const puppyRank = all.findIndex((n) => n.w === 'puppy');
    expect(puppyRank).toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId(`ana-row-${puppyRank}`).locator('.tag')).toHaveText('input');
    await page.getByTestId('exclude').check();
    await expect(page.locator('[data-testid^="ana-row-"] .tag')).toHaveCount(0);
  });

  test('cosine, dot product and Euclidean distance disagree for raw vectors', async ({ page }) => {
    await page.goto(URL);
    const s = await E(page);
    await page.getByTestId('word-select').selectOption('apple');
    const a = s.vectors[s.words.indexOf('apple')];
    for (const m of ['cosine', 'dot', 'euclid'] as Metric[]) {
      const want = ranking(s.words, s.vectors, a, m, ['apple']).slice(0, 5).map((n) => n.w);
      expect(await words(page, `cmp-${m}`, 5)).toEqual(want);
    }
    // dot product is won by the long vector: cake · apple = 1.6 + 0.7 × 1.6 = 2.72
    await expect(page.getByTestId('cmp-dot-0')).toHaveAttribute('data-word', 'cake');
    await expect(page.getByTestId('cmp-dot-0')).toContainText('2.720');
    await expect(page.getByTestId('cmp-cosine-0')).toHaveAttribute('data-word', 'banana');
    await expect(page.getByTestId('cmp-dot-0')).toHaveClass(/diff/);
  });

  test('unit-normalised vectors make all three measures agree (‖a − b‖² = 2 − 2 cos θ)', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('normalise').check();
    const s = await E(page);
    for (const v of s.vectors) expect(norm(v)).toBeCloseTo(1, 12);
    const raw = await page.evaluate(() => (window as any).__emb.raw);
    expect(s.vectors[s.words.indexOf('cake')]).toEqual(unit(raw.cake).map((x) => expect.closeTo(x, 12)));
    for (const w of ['apple', 'king', 'lion']) {
      await page.getByTestId('word-select').selectOption(w);
      const [c, d, e] = [await words(page, 'cmp-cosine', 5), await words(page, 'cmp-dot', 5), await words(page, 'cmp-euclid', 5)];
      expect(d).toEqual(c);
      expect(e).toEqual(c);
      await expect(page.locator('.cmp li.diff')).toHaveCount(0);
      const q = s.vectors[s.words.indexOf(w)];
      for (const n of ranking(s.words, s.vectors, q, 'cosine', [w]).slice(0, 5)) {
        const b = s.vectors[s.words.indexOf(n.w)];
        expect(dist(q, b) ** 2).toBeCloseTo(2 - 2 * n.s, 12);
        expect(dot(q, b)).toBeCloseTo(n.s, 12);
      }
    }
    await expect(page.getByTestId('norm')).toContainText('1.000 (normalised)');
    // PCA was recomputed on the normalised vectors
    const eig = jacobi(covariance(s.vectors).C);
    expect(Math.abs(s.pca.eigenvalues[0] - eig[0].val)).toBeLessThan(1e-9);
  });
});
