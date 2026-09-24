import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/084-pairwise-lab.html';

// Independent oracle: read the parameters from the form, the constraints from the chips and the rows from the table,
// then check the all-pairs property without using any of the page's own coverage code.
async function readPage(page: Page) {
  const names = await page.getByTestId('param-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value.trim()));
  const values = await page.getByTestId('param-values').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value.split(',').map((s) => s.trim()).filter(Boolean)));
  const header = await page.getByTestId('rows').locator('thead th').allTextContents();
  const rows = await page.getByTestId('row').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].slice(1, -1).map((td) => td.textContent!.trim())));
  const cons = await page.locator('[data-testid="constraint"][data-active="true"]').allTextContents();
  const forbidden = cons.map((c) => c.replace('✕', '').split(' ⊗ ').map((s) => s.trim()));
  return { names, values, header: header.slice(1, -1), rows, forbidden };
}
function checkAllPairs(d: Awaited<ReturnType<typeof readPage>>) {
  const n = d.names.length;
  const tag = (p: number, v: string) => `${d.names[p]}=${v}`;
  const isForbidden = (a: string, b: string) => d.forbidden.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const seen = new Set<string>();
  let violations = 0;
  for (const r of d.rows) {
    expect(r).toHaveLength(n);
    r.forEach((v, p) => expect(d.values[p]).toContain(v));
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      if (isForbidden(tag(a, r[a]), tag(b, r[b]))) violations++;
      seen.add(tag(a, r[a]) + '|' + tag(b, r[b]));
    }
  }
  const missing: string[] = [];
  let allowed = 0;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (const va of d.values[a]) for (const vb of d.values[b]) {
    if (isForbidden(tag(a, va), tag(b, vb))) continue;
    allowed++;
    if (!seen.has(tag(a, va) + '|' + tag(b, vb))) missing.push(tag(a, va) + ' × ' + tag(b, vb));
  }
  return { missing, violations, allowed };
}

test.describe('Pairwise Lab', () => {
  test('checkout preset: far fewer rows than exhaustive, and every allowed pair is really covered', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('exhaustive')).toHaveText('192'); // 4 × 4 × 3 × 4
    const d = await readPage(page);
    expect(d.header).toEqual(['Browser', 'OS', 'Locale', 'Payment']);
    const res = checkAllPairs(d);
    expect(res.missing).toEqual([]);
    expect(res.violations).toBe(0);
    await expect(page.getByTestId('stat-allowed')).toHaveText(String(res.allowed));
    await expect(page.getByTestId('stat-forbidden')).toHaveText('3');
    const rows = d.rows.length;
    expect(rows).toBeGreaterThanOrEqual(16); // can't beat 4 × 4
    expect(rows).toBeLessThanOrEqual(24);
    await expect(page.getByTestId('pairwise')).toHaveText(String(rows));
    await expect(page.getByTestId('verify')).toHaveAttribute('data-pass', 'true');
    // 192 minus combos that contain a forbidden pair: Safari on Windows/Android (2×3×4 = 24), ja-JP + Gift card (4×4 = 16, 2 already counted)
    await expect(page.getByTestId('stat-valid')).toHaveText(String(192 - 24 - 16 + 2));
  });

  test('adding a constraint regenerates rows that respect it; the heatmap marks it forbidden', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('c-a').selectOption({ label: 'Browser = Edge' });
    await page.getByTestId('c-b').selectOption({ label: 'Payment = Bank transfer' });
    await page.getByTestId('add-constraint').click();
    await expect(page.getByTestId('constraint')).toHaveCount(4);
    await expect(page.getByTestId('stat-forbidden')).toHaveText('4');
    const d = await readPage(page);
    expect(d.forbidden).toContainEqual(['Browser=Edge', 'Payment=Bank transfer']);
    const res = checkAllPairs(d);
    expect(res.missing).toEqual([]);
    expect(res.violations).toBe(0);
    await expect(page.locator('[data-testid="cell"][data-kind="forbidden"]')).toHaveCount(4);
    // same-parameter constraints are refused
    await page.getByTestId('c-a').selectOption({ label: 'OS = iOS' });
    await page.getByTestId('c-b').selectOption({ label: 'OS = macOS' });
    await page.getByTestId('add-constraint').click();
    await expect(page.getByTestId('cons-warn')).toContainText('two different parameters');
    await expect(page.getByTestId('constraint')).toHaveCount(4);
    await page.getByTestId('del-constraint').first().click();
    await expect(page.getByTestId('stat-forbidden')).toHaveText('3');
  });

  test('editing parameters and switching presets keeps the property', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('add-param').click();
    await page.getByTestId('param-name').last().fill('Theme');
    await page.getByTestId('param-values').last().fill('Light, Dark, Light, , High contrast');
    await expect(page.getByTestId('exhaustive')).toHaveText('576');
    let res = checkAllPairs(await readPage(page));
    expect(res.missing).toEqual([]);
    expect(res.violations).toBe(0);

    await page.getByTestId('preset-service').click();
    await expect(page.getByTestId('exhaustive')).toHaveText('2,187');
    const d = await readPage(page);
    res = checkAllPairs(d);
    expect(res.missing).toEqual([]);
    expect(res.allowed).toBe(21 * 9);
    expect(d.rows.length).toBeLessThanOrEqual(20);
    await expect(page.getByTestId('stat-bound')).toHaveText('9');

    await page.getByTestId('preset-settings').click();
    res = checkAllPairs(await readPage(page));
    expect(res.missing).toEqual([]);
    expect(res.violations).toBe(0);
  });

  test('clicking a heatmap cell highlights exactly the rows that cover that pair', async ({ page }) => {
    await page.goto(URL);
    const cell = page.locator('[data-testid="cell"][data-kind="allowed"]').nth(7);
    const count = Number(await cell.getAttribute('data-count'));
    expect(count).toBeGreaterThan(0);
    await cell.click();
    await expect(page.locator('[data-testid="row"][data-hl="true"]')).toHaveCount(count);
    await expect(page.getByTestId('sel-info')).toContainText(`covered by ${count} row`);
    await page.locator('[data-testid="cell"][data-kind="forbidden"]').first().click();
    await expect(page.locator('[data-testid="row"][data-hl="true"]')).toHaveCount(0);
    await expect(page.getByTestId('sel-info')).toContainText('forbidden');
  });

  test('CSV matches the table, and the seed is reproducible', async ({ page }) => {
    await page.goto(URL + '?seed=9');
    const d = await readPage(page);
    await page.getByTestId('show-csv').click();
    const csv = (await page.getByTestId('csv').textContent())!.trim().split('\n');
    expect(csv[0]).toBe('Browser,OS,Locale,Payment');
    expect(csv.slice(1)).toEqual(d.rows.map((r) => r.join(',')));
    const download = page.waitForEvent('download');
    await page.getByTestId('download').click();
    expect((await download).suggestedFilename()).toBe('pairwise-rows.csv');

    await page.getByTestId('seed').fill('10');
    await page.getByTestId('generate').click();
    expect(checkAllPairs(await readPage(page)).missing).toEqual([]);
    await page.getByTestId('seed').fill('9');
    await page.getByTestId('generate').click();
    expect((await readPage(page)).rows).toEqual(d.rows);
  });
});
