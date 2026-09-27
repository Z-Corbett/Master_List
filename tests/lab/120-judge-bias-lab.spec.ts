import { test, expect, Page } from '@playwright/test';

const URL = '/lab/120-judge-bias-lab.html?seed=7';
const J = <T>(page: Page, fn: (arg: any) => T, arg?: any) => page.evaluate(fn as any, arg) as Promise<T>;
const base = { seed: 7, bias: 0, verb: 0, noise: 0, swap: false, lc: false, judges: 1 };

/** Cohen's kappa for two label arrays, written out independently of the page. */
function kappa(a: string[], b: string[]) {
  const n = a.length, cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce((s, c) => s + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  return (po - pe) / (1 - pe);
}
/** Standard normal CDF via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
function Phi(x: number) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
const ols = (x: number[], y: number[]) => {
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
  let sxy = 0, sxx = 0; x.forEach((xi, i) => { sxy += (xi - mx) * (y[i] - my); sxx += (xi - mx) ** 2; });
  return sxy / sxx;
};

test.describe('120 Judge Bias Lab', () => {
  test("Cohen's kappa matches worked textbook examples", async ({ page }) => {
    await page.goto(URL);
    const K = (t: number[]) => J(page, (t: number[]) => (window as any).__judge.kappaTable(...t).kappa, t);
    // Wikipedia's grant-proposal example: 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no → po 0.7, pe 0.5, κ 0.4
    expect(await K([20, 5, 10, 15])).toBeCloseTo(0.4, 12);
    // hand-worked: po 0.60, pe 0.54 → κ = 0.06/0.46; and po 0.60, pe 0.46 → κ = 0.14/0.54
    expect(await K([45, 15, 25, 15])).toBeCloseTo(0.06 / 0.46, 12);
    expect(await K([25, 35, 5, 35])).toBeCloseTo(0.14 / 0.54, 12);
    expect(await K([30, 0, 0, 20])).toBe(1);                       // perfect agreement
    expect(await K([25, 25, 25, 25])).toBe(0);                     // exactly chance
    expect(await K([0, 10, 10, 0])).toBe(-1);                      // always disagree
    // three categories: po 4/6, pe 1/3 → κ 0.5
    expect(await J(page, () => (window as any).__judge.kappa(['x', 'x', 'y', 'y', 'z', 'z'], ['x', 'y', 'y', 'y', 'z', 'x']).kappa)).toBeCloseTo(0.5, 12);
    // and the calculator on the page, which opens on the Wikipedia table
    await expect(page.getByTestId('k-out')).toHaveText('n = 50 · pₒ = 0.7000 · pₑ = 0.5000 · κ = 0.400 (fair)');
    await page.getByTestId('k-yy').fill('45'); await page.getByTestId('k-yn').fill('15'); await page.getByTestId('k-ny').fill('25'); await page.getByTestId('k-nn').fill('15');
    await expect(page.getByTestId('k-out')).toHaveText('n = 100 · pₒ = 0.6000 · pₑ = 0.5400 · κ = 0.130 (slight)');
    await page.getByTestId('k-yy').fill('0'); await page.getByTestId('k-nn').fill('0');
    await expect(page.getByTestId('k-out')).toContainText('(poor (worse than chance))');
  });

  test('swap-and-average removes pure position bias: the win rate returns exactly to the truth', async ({ page }) => {
    await page.goto(URL);
    for (const seed of [1, 7, 42, 99]) for (const bias of [0.3, 0.8, 1.5]) {
      const r = await J(page, (c: any) => {
        const Jg = (window as any).__judge;
        return { naive: Jg.evaluate(c), swap: Jg.evaluate({ ...c, swap: true }), pairs: Jg.makePairs(c.seed) };
      }, { ...base, seed, bias });
      const deltas = r.pairs.map((p: any) => p.delta);
      const truth = deltas.filter((d: number) => d > 0).length / 120;
      // naive judge picks Alder whenever Δ + b > 0, so it over-counts Alder
      expect(r.naive.winRate).toBeCloseTo(deltas.filter((d: number) => d + bias > 0).length / 120, 12);
      expect(r.naive.winRate).toBeGreaterThan(truth);
      expect(r.swap.truthRate).toBeCloseTo(truth, 12);
      expect(r.swap.winRate, `seed ${seed}, b ${bias}`).toBeCloseTo(truth, 12);
      expect(r.swap.agreement).toBe(1);
    }
  });

  test('with noise, swapping makes the verdicts independent of the bias, and expected win rates match the normal model', async ({ page }) => {
    await page.goto(URL);
    const c = { ...base, noise: 0.8, bias: 0.9 };
    const same = await J(page, (c: any) => {
      const Jg = (window as any).__judge;
      return JSON.stringify(Jg.runVerdicts({ ...c, swap: true }, 1)) === JSON.stringify(Jg.runVerdicts({ ...c, bias: 0, swap: true }, 1));
    }, c);
    expect(same).toBe(true);
    // Monte Carlo over 60 judge runs vs the closed form: P(Alder) = Φ((Δ + b)/σ) naive, Φ(√2·Δ/σ) swapped
    const r = await J(page, (c: any) => {
      const Jg = (window as any).__judge, runs = 60;
      let naive = 0, swap = 0;
      for (let run = 1; run <= runs; run++) {
        naive += Jg.runVerdicts(c, run).filter((v: string) => v === 'A').length;
        swap += Jg.runVerdicts({ ...c, swap: true }, run).filter((v: string) => v === 'A').length;
      }
      return { naive: naive / runs / 120, swap: swap / runs / 120, deltas: Jg.makePairs(c.seed).map((p: any) => p.delta) };
    }, c);
    const expNaive = r.deltas.reduce((a: number, d: number) => a + Phi((d + c.bias) / c.noise), 0) / 120;
    const expSwap = r.deltas.reduce((a: number, d: number) => a + Phi((Math.SQRT2 * d) / c.noise), 0) / 120;
    const expUnbiased = r.deltas.reduce((a: number, d: number) => a + Phi(d / c.noise), 0) / 120;
    expect(Math.abs(r.naive - expNaive)).toBeLessThan(0.02);
    expect(Math.abs(r.swap - expSwap)).toBeLessThan(0.02);
    expect(expNaive - expUnbiased).toBeGreaterThan(0.1);          // the bias is large
    expect(Math.abs(expSwap - expUnbiased)).toBeLessThan(0.03);   // swapped is back where an unbiased judge would be
  });

  test('length control removes the verbosity slope that favours wordy Birch', async ({ page }) => {
    await page.goto(URL);
    const c = { ...base, verb: 1.2 };
    const r = await J(page, (c: any) => {
      const Jg = (window as any).__judge;
      return { naive: Jg.evaluate(c), lc: Jg.evaluate({ ...c, lc: true }), pairs: Jg.makePairs(c.seed) };
    }, c);
    const L = r.pairs.map((p: any) => p.L), D = r.pairs.map((p: any) => p.delta);
    expect(L.filter((x: number) => x < 0).length).toBeGreaterThan(90);           // Birch is usually longer
    expect(r.naive.winRate).toBeLessThan(r.naive.truthRate);                      // so a verbose judge undercounts Alder
    // the fitted slope of (Δ + v·L) on L is v plus the sample slope of Δ on L
    expect(r.lc.slopes[0]).toBeCloseTo(1.2 + ols(L, D), 10);
    expect(Math.abs(r.lc.slopes[0] - 1.2)).toBeLessThan(0.35);
    expect(r.lc.agreement).toBeGreaterThan(r.naive.agreement + 0.05);
    expect(Math.abs(r.lc.winRate - r.lc.truthRate)).toBeLessThan(Math.abs(r.naive.winRate - r.naive.truthRate));
  });

  test('majority vote cuts noise but cannot remove a bias every judge shares', async ({ page }) => {
    await page.goto(URL);
    const r = await J(page, () => {
      const Jg = (window as any).__judge;
      let a1 = 0, a5 = 0;
      for (let seed = 0; seed < 20; seed++) {
        const c = { seed, bias: 0, verb: 0, noise: 1, swap: false, lc: false, judges: 1 };
        a1 += Jg.evaluate(c).agreement; a5 += Jg.evaluate({ ...c, judges: 5 }).agreement;
      }
      const shared = Jg.evaluate({ seed: 7, bias: 1, verb: 0, noise: 0.3, swap: false, lc: false, judges: 5 });
      return { a1: a1 / 20, a5: a5 / 20, shared };
    });
    expect(r.a5).toBeGreaterThan(r.a1 + 0.03);
    expect(r.shared.winRate - r.shared.truthRate).toBeGreaterThan(0.1);
  });

  test("kappa between judge runs: 1 with no noise, lower with more, and equal to an independent calculation", async ({ page }) => {
    await page.goto(URL);
    const r = await J(page, () => {
      const Jg = (window as any).__judge;
      const at = (noise: number) => { let s = 0; for (let seed = 0; seed < 10; seed++) s += Jg.evaluate({ seed, bias: 0.5, verb: 0.5, noise, swap: false, lc: false, judges: 1 }).kappaRuns; return s / 10; };
      const one = Jg.evaluate({ seed: 3, bias: 0.4, verb: 0.6, noise: 0.9, swap: false, lc: false, judges: 1 });
      return { k0: Jg.evaluate({ seed: 3, bias: 0.5, verb: 0.5, noise: 0, swap: false, lc: false, judges: 1 }).kappaRuns, low: at(0.3), high: at(1.5), one };
    });
    expect(r.k0).toBe(1);
    expect(r.low).toBeGreaterThan(r.high + 0.2);
    expect(r.one.kappaRuns).toBeCloseTo(kappa(r.one.verdicts, r.one.verdicts2), 12);
    expect(r.one.kappaTruth).toBeCloseTo(kappa(r.one.verdicts, r.one.truth), 12);
    expect(r.one.agreement).toBeCloseTo(r.one.verdicts.filter((v: string, i: number) => v === r.one.truth[i]).length / 120, 12);
  });

  test('tournaments are seeded: same seed, same everything; other seeds differ; the URL seed is used', async ({ page }) => {
    await page.goto(URL);
    const r = await J(page, () => {
      const Jg = (window as any).__judge, c = { seed: 7, bias: 0.6, verb: 0.8, noise: 0.7, swap: true, lc: true, judges: 3 };
      return { a: JSON.stringify(Jg.evaluate(c)), b: JSON.stringify(Jg.evaluate(c)), others: [1, 2, 3].map((s) => JSON.stringify(Jg.makePairs(s))), p7: JSON.stringify(Jg.makePairs(7)) };
    });
    expect(r.a).toBe(r.b);
    expect(new Set([...r.others, r.p7]).size).toBe(4);
    await expect(page.getByTestId('seed')).toHaveValue('7');
    const texts = async () => Promise.all(['truth-rate', 'judge-rate', 'agreement', 'kappa-runs'].map((id) => page.getByTestId(id).textContent()));
    const before = await texts();
    await page.reload();
    expect(await texts()).toEqual(before);
    await page.getByTestId('seed').fill('8');
    await page.getByTestId('seed').press('Enter');
    await expect(page).toHaveURL(/seed=8/);
    expect(await texts()).not.toEqual(before);
  });

  test('the controls drive the numbers: set pure position bias, tick swap, and the judge matches the truth', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('verb').fill('0');
    await page.getByTestId('noise').fill('0');
    await page.getByTestId('bias').fill('1');
    await expect(page.getByTestId('bias-out')).toHaveText('1.00');
    const truth = await page.getByTestId('truth-rate').textContent();
    await expect(page.getByTestId('judge-rate')).not.toHaveText(truth!);
    await expect(page.getByTestId('kappa-runs')).toHaveText('1.000');          // no noise: two runs agree completely
    await page.getByTestId('swap').check();
    await expect(page.getByTestId('judge-rate')).toHaveText(truth!);
    await expect(page.getByTestId('agreement')).toHaveText('100.0%');
    await expect(page.getByTestId('strip').locator('.wrong')).toHaveCount(0);
    await expect(page.getByTestId('abl-1')).toHaveClass(/cur/);
    await expect(page.getByTestId('abl-1')).toContainText(truth!);
    // with noise, the strip's wrong cells are exactly the disagreements
    await page.getByTestId('noise').fill('1.2');
    await page.getByTestId('judges').selectOption('3');
    const L = await J(page, () => (window as any).__judge.last.R);
    const wrong = L.verdicts.filter((v: string, i: number) => v !== L.truth[i]).length;
    expect(wrong).toBeGreaterThan(0);
    await expect(page.getByTestId('strip').locator('.wrong')).toHaveCount(wrong);
    await expect(page.getByTestId('strip').locator('span')).toHaveCount(120);
    await expect(page.getByTestId('agreement')).toHaveText(`${((100 * (120 - wrong)) / 120).toFixed(1)}%`);
    expect(L.cfg.judges).toBe(3);
  });

  test('the page says plainly that it is a simulation', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('sim-badge')).toHaveText('Simulation');
    await expect(page.getByTestId('sim-note')).toContainText('This is a simulation. No language model is called.');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /simulation, with no real model/);
    await expect(page.getByTestId('bars')).toHaveAttribute('aria-label', /ground truth \d+\.\d%, naive judge \d+\.\d%/);
  });
});
