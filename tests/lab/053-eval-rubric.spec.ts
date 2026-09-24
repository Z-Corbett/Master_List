import { test, expect, type Page } from '@playwright/test';

/*
  Hand-computed Cohen's kappa used as the oracle (8 items, 5 categories):
    A = 5 4 4 3 2 5 3 1
    B = 5 4 3 3 2 4 3 2
  Agreements on items 1,2,4,5,7 -> p_o = 5/8 = 0.625
  A marginals: 1:1 2:1 3:2 4:2 5:2      B marginals: 1:0 2:2 3:3 4:2 5:1
  p_e = (1*0 + 1*2 + 2*3 + 2*2 + 2*1) / 64 = 14/64 = 0.21875
  kappa = (0.625 - 0.21875) / (1 - 0.21875) = 0.40625 / 0.78125 = 0.52
*/
const A = [5, 4, 4, 3, 2, 5, 3, 1];
const B = [5, 4, 3, 3, 2, 4, 3, 2];

function kappa(a: number[], b: number[]) {
  const n = a.length; const po = a.filter((x, i) => x === b[i]).length / n;
  let pe = 0; for (let c = 1; c <= 5; c++) pe += (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n);
  return (po - pe) / (1 - pe);
}

async function grade(page: Page, rater: 'A' | 'B', crit: string, scores: number[]) {
  await page.getByTestId(`rater-${rater}`).click();
  for (let i = 0; i < scores.length; i++) {
    await page.getByTestId(`sample-nav-${i + 1}`).click();
    await page.getByTestId(`score-${crit}-${scores[i]}`).check();
  }
}

test.describe('Eval Rubric Builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/053-eval-rubric.html');
  });

  test("Cohen's kappa matches the hand-computed example (0.52, 62.5%)", async ({ page }) => {
    expect(kappa(A, B)).toBeCloseTo(0.52, 10);
    await grade(page, 'A', 'correct', A);
    await expect(page.getByTestId('kappa-overall')).toHaveText('—'); // nothing paired yet
    await grade(page, 'B', 'correct', B);
    await expect(page.getByTestId('kappa-correct')).toHaveText('0.52');
    await expect(page.getByTestId('agree-correct')).toHaveText('62.5%');
    await expect(page.getByTestId('kappa-overall')).toHaveText('0.52');
    await expect(page.getByTestId('agree-overall')).toHaveText('62.5%');
    await expect(page.getByText('moderate', { exact: true })).toBeVisible();
    // only one criterion graded: weighted score equals the raw score; averages are plain means
    await expect(page.getByTestId('wscore-3-A')).toHaveText('4.00');
    await expect(page.getByTestId('wscore-3-B')).toHaveText('3.00');
    await expect(page.getByTestId('avg-correct-A')).toHaveText('3.38'); // 27/8
    await expect(page.getByTestId('avg-correct-B')).toHaveText('3.25'); // 26/8

    // edge cases straight from the implementation
    const edge = await page.evaluate(() => {
      const k = (window as any).__rubric.cohenKappa;
      return { same: k([1, 2, 3], [1, 2, 3]).kappa, constant: k([4, 4, 4], [4, 4, 4]).kappa, opposite: k([1, 5, 1, 5], [5, 1, 5, 1]).kappa };
    });
    expect(edge.same).toBe(1);
    expect(edge.constant).toBeNull(); // p_e = 1: kappa undefined, shown as n/a
    expect(edge.opposite).toBeCloseTo(-1, 10);
  });

  test('grading is blind until you commit, and the nav marks finished samples', async ({ page }) => {
    await page.getByTestId('score-correct-4').check();
    await expect(page.getByTestId('anchor-text-correct')).toContainText('Correct; only trivial slips');
    await page.getByTestId('rater-B').click();
    await expect(page.getByTestId('rater-B')).toHaveAttribute('aria-pressed', 'true');
    for (let n = 1; n <= 5; n++) await expect(page.getByTestId(`score-correct-${n}`)).not.toBeChecked();
    await expect(page.getByTestId('score-row-correct').locator('.other')).toHaveCount(0);
    await page.getByTestId('score-correct-3').check();
    await expect(page.getByTestId('score-row-correct').locator('.other')).toHaveText('A');
    await expect(page.getByTestId('agree-correct')).toHaveText('0.0%');

    for (const c of ['grounded', 'helpful', 'tone']) await page.getByTestId(`score-${c}-5`).check();
    await expect(page.getByTestId('sample-nav-1')).toHaveClass(/done/);
    await expect(page.getByTestId('sample-nav-2')).not.toHaveClass(/done/);
  });

  test('weighted scores follow the weights; demo ratings match an independent kappa', async ({ page }) => {
    await page.getByTestId('demo').click();
    // sample 1, rater B: correct 5, grounded 5, helpful 4, tone 5 with weights 40/25/20/15
    await expect(page.getByTestId('wscore-1-B')).toHaveText('4.80');
    await expect(page.getByTestId('wscore-2-A')).toHaveText('2.25'); // (2*40 + 1*25 + 3*20 + 4*15) / 100

    const demo = await page.evaluate(() => (window as any).__rubric.exportObj().ratings);
    const ids = ['correct', 'grounded', 'helpful', 'tone'];
    const pa: number[] = [], pb: number[] = [];
    for (const c of ids) for (const s of Object.keys(demo.A)) { pa.push(demo.A[s][c]); pb.push(demo.B[s][c]); }
    await expect(page.getByTestId('kappa-overall')).toHaveText(kappa(pa, pb).toFixed(2));

    await page.getByTestId('weight-helpful').fill('0');
    await expect(page.getByTestId('wpct-helpful')).toHaveText('0.0% of the total score');
    await expect(page.getByTestId('wpct-correct')).toHaveText('50.0% of the total score');
    await expect(page.getByTestId('wscore-1-B')).toHaveText('5.00');
  });

  test('edit the rubric: add, rename, re-anchor, remove; survives reload', async ({ page }) => {
    await page.getByTestId('add-criterion').click();
    await expect(page.getByTestId('criterion')).toHaveCount(5);
    await expect(page.getByTestId('crit-name-c5')).toBeFocused();
    await page.getByTestId('crit-name-c5').fill('Safety');
    await page.locator('details.anchors').last().locator('summary').click();
    await page.getByTestId('anchor-c5-5').fill('Declines harmful requests and offers a safe alternative.');
    await expect(page.getByTestId('score-row-c5')).toContainText('Safety');
    await page.getByTestId('score-c5-5').check();
    await expect(page.getByTestId('anchor-text-c5')).toContainText('offers a safe alternative');
    await expect(page.getByTestId('crow-c5')).toContainText('Safety');

    await page.getByTestId('score-tone-2').check();
    await page.getByTestId('remove-tone').click();
    await expect(page.getByTestId('criterion')).toHaveCount(4);
    await expect(page.getByTestId('crow-tone')).toHaveCount(0);
    const r = await page.evaluate(() => (window as any).__rubric.exportObj().ratings.A.s1);
    expect(r).toEqual({ c5: 5 });

    await page.reload();
    await expect(page.getByTestId('crit-name-c5')).toHaveValue('Safety');
    await expect(page.getByTestId('score-c5-5')).toBeChecked();
  });

  test('JSON export carries the rubric, ratings and computed agreement', async ({ page }) => {
    await page.getByTestId('demo').click();
    const shown = await page.getByTestId('kappa-overall').textContent();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
    expect(dl.suggestedFilename()).toBe('eval-rubric-results.json');
    const json = JSON.parse((await page.getByTestId('json').textContent())!);
    expect(json.rubric.map((c: { id: string }) => c.id)).toEqual(['correct', 'grounded', 'helpful', 'tone']);
    expect(Object.keys(json.rubric[0].anchors)).toEqual(['1', '2', '3', '4', '5']);
    expect(json.samples).toHaveLength(8);
    expect(json.results.overall.n).toBe(32);
    expect(json.results.overall.cohensKappa.toFixed(2)).toBe(shown);
    expect(json.results.perCriterion).toHaveLength(4);
    await page.getByTestId('clear').click();
    await expect(page.getByTestId('kappa-overall')).toHaveText('—');
  });
});
