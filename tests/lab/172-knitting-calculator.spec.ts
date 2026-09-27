import { test, expect, Page } from '@playwright/test';

const URL = '/lab/172-knitting-calculator.html';
const last = (page: Page) => page.evaluate(() => (window as any).__knit.last);
const set = async (page: Page, id: string, v: string | number) => { await page.getByTestId(id).fill(String(v)); };

// ---- a tiny knitter: parse the written instruction and work it, stitch by stitch ----
type Op = 'k' | 'M1' | 'k2tog';
function expand(text: string): Op[] {
  const out: Op[] = [];
  const items: string[] = [];
  // split on top-level ", "
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  for (const it of items) {
    const rep = it.match(/^\[(.+)\] (\d+) times$/);
    if (rep) { for (let n = 0; n < +rep[2]; n++) out.push(...expand(rep[1])); continue; }
    const k = it.match(/^k(\d+)$/);
    if (k) { for (let n = 0; n < +k[1]; n++) out.push('k'); continue; }
    if (it === 'M1' || it === 'k2tog') { out.push(it); continue; }
    throw new Error(`cannot knit "${it}" in "${text}"`);
  }
  return out;
}
/** work the row on K live stitches: returns what it consumed and produced, and the plain runs between shaping */
function knit(text: string) {
  let used = 0, made = 0, run = 0; const runs: number[] = []; const ops = expand(text);
  for (const op of ops) {
    if (op === 'k') { used += 1; made += 1; run++; }
    else { runs.push(run); run = 0; if (op === 'M1') made += 1; else { used += 2; made += 1; } }
  }
  runs.push(run);
  return { used, made, shaping: ops.filter((o) => o !== 'k').length, runs, first: ops[0], last: ops[ops.length - 1] };
}
/** nearest n = m·k + e to raw; ties go up */
function nearestRepeat(raw: number, m: number, e: number) {
  let best = e || m;
  for (let n = e; n <= raw * 2 + m + e; n += m) if (n > 0 && (Math.abs(n - raw) < Math.abs(best - raw) || (Math.abs(n - raw) === Math.abs(best - raw) && n > best))) best = n;
  return best;
}

test.describe('172 Knitting Calculator', () => {
  test('gauge: per 4 in to per inch, stitch width, and per 10 cm', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('gauge-sts')).toHaveValue('20');
    await expect(page.getByTestId('per-unit')).toHaveText('5 sts and 7 rows per inch');
    await expect(page.getByTestId('st-mm')).toHaveText(`${(25.4 / 5).toFixed(2)} mm`);                  // 5.08 mm
    await expect(page.getByTestId('gauge-out')).toContainText(`${(Math.round((20 / 4) * (10 / 2.54) * 10) / 10)} sts per 10 cm`);  // 19.7
    await set(page, 'gauge-sts', 18);
    await set(page, 'gauge-rows', 24);
    await expect(page.getByTestId('per-unit')).toHaveText('4.5 sts and 6 rows per inch');
    const s = await page.evaluate(() => (window as any).__knit.state);
    expect(s.stsIn).toBeCloseTo(4.5, 12);
    expect(s.rowsIn).toBeCloseTo(6, 12);
  });

  test('swatch: counted stitches over a measured width give the gauge, in inches and in cm', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('use-swatch').click();                                                   // 17 sts over 3.5 in, 22 rows over 3 in
    await expect(page.getByTestId('gauge-sts')).toHaveValue(String(Math.round((17 / 3.5) * 4 * 10) / 10));   // 19.4
    await expect(page.getByTestId('gauge-rows')).toHaveValue(String(Math.round((22 / 3) * 4 * 10) / 10));    // 29.3
    await expect(page.getByTestId('gauge-sts')).toBeFocused();
    let s = await page.evaluate(() => (window as any).__knit.state);
    expect(s.stsIn).toBeCloseTo(17 / 3.5, 12);
    await page.getByTestId('unit-metric').click();
    await set(page, 'sw-sts', 18); await set(page, 'sw-w', 9);
    await set(page, 'sw-rows', 26); await set(page, 'sw-h', 10);
    await page.getByTestId('use-swatch').click();
    await expect(page.getByTestId('gauge-sts')).toHaveValue('20');                                   // 18 over 9 cm = 20 per 10 cm
    await expect(page.getByTestId('gauge-rows')).toHaveValue('26');
    s = await page.evaluate(() => (window as any).__knit.state);
    expect(s.stsIn).toBeCloseTo((18 / 9) * 2.54, 12);                                               // 2 per cm = 5.08 per inch
    await expect(page.getByTestId('per-unit')).toHaveText('2 sts and 2.6 rows per cm');
  });

  test('cast-on rounds to the nearest pattern repeat (ties go up)', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('co-n')).toHaveText('90');                                        // 18 in × 5 = 90 = 4·22 + 2
    for (const [w, m, e] of [[19.3, 6, 1], [18.8, 4, 0], [10, 7, 3], [25, 12, 5], [7.25, 2, 1]] as const) {
      await set(page, 'co-width', w); await set(page, 'co-mult', m); await set(page, 'co-plus', e);
      const raw = w * 5, want = nearestRepeat(raw, m, e);
      await expect(page.getByTestId('co-n')).toHaveText(String(want));
      expect((want - e) % m).toBe(0);
      const { co } = await last(page);
      expect(co.raw).toBeCloseTo(raw, 10);
      expect(Math.abs(want - raw)).toBeLessThanOrEqual(m / 2);
      await expect(page.getByTestId('co-detail')).toContainText(`${want} sts = ${Math.round((want / 5) * 10) / 10} in`);
    }
    // 18.8 in → 94 sts, halfway between 92 and 96 → 96
    await set(page, 'co-width', 18.8); await set(page, 'co-mult', 4); await set(page, 'co-plus', 0);
    await expect(page.getByTestId('co-n')).toHaveText('96');
  });

  test('"increase 8 evenly" across 80: the classic instruction, knitted by the test', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('ev-instr')).toHaveText('[k9, M1] 8 times, k8');
    let k = knit((await page.getByTestId('ev-instr').textContent())!);
    expect([k.used, k.made, k.shaping]).toEqual([80, 88, 8]);
    await expect(page.getByTestId('ev-result')).toHaveText('88');
    // the row picture has one mark per stitch on the needle afterwards
    await expect(page.getByTestId('ev-vis').locator('span')).toHaveCount(88);
    await expect(page.getByTestId('ev-vis').locator('span.inc')).toHaveCount(8);
    await page.getByTestId('ev-mode').selectOption('round');
    await expect(page.getByTestId('ev-instr')).toHaveText('[k10, M1] 8 times');
    // decrease 10 across 100: 80 plain stitches in 11 gaps
    await set(page, 'ev-k', 100); await set(page, 'ev-n', 10);
    await page.getByTestId('ev-type').selectOption('dec');
    await page.getByTestId('ev-mode').selectOption('flat');
    await expect(page.getByTestId('ev-instr')).toHaveText('[k8, k2tog] 3 times, [k7, k2tog] 7 times, k7');
    k = knit((await page.getByTestId('ev-instr').textContent())!);
    expect([k.used, k.made, k.shaping]).toEqual([100, 90, 10]);
    await expect(page.getByTestId('ev-vis').locator('span')).toHaveCount(90);
    await expect(page.getByTestId('ev-vis').locator('span.dec')).toHaveCount(10);
  });

  test('every evenly-distributed row knits to exactly the target count (400 cases)', async ({ page }) => {
    await page.goto(URL);
    const cases: [number, number, string, string][] = [];
    for (const K of [7, 24, 61, 80, 97, 150, 233, 400]) for (const N of [1, 2, 3, 5, 6, 11, 13, 29, 40, 64, 99, 150, 199]) for (const t of ['inc', 'dec']) for (const m of ['flat', 'round']) cases.push([K, N, t, m]);
    const res: any[] = await page.evaluate((cs) => cs.map(([K, N, t, m]) => (window as any).__knit.distribute(K, N, t, m)), cases);
    let worked = 0;
    cases.forEach(([K, N, t, m], i) => {
      const r = res[i], label = `${t} ${N} on ${K} ${m}`;
      const possible = t === 'inc' ? N <= (m === 'flat' ? K - 1 : K) : 2 * N <= K;
      expect(!!r.error, label).toBe(!possible);
      if (!possible) return;
      worked++;
      const k = knit(r.text);
      expect(k.used, label).toBe(K);                                     // every stitch on the needle is worked once
      expect(k.made, label).toBe(t === 'inc' ? K + N : K - N);           // and the row ends on the target count
      expect(k.shaping, label).toBe(N);
      expect(r.result, label).toBe(k.made);
      // evenly: the plain runs between shaping differ by at most one stitch
      const runs = m === 'round' ? k.runs.slice(0, -1).map((x, j) => (j === 0 ? x + k.runs[k.runs.length - 1] : x)) : k.runs;
      expect(Math.max(...runs) - Math.min(...runs), label).toBeLessThanOrEqual(1);
      // flat increases never sit on the edge stitch
      if (t === 'inc' && m === 'flat') { expect(k.first, label).toBe('k'); expect(k.last, label).toBe('k'); }
    });
    expect(worked).toBeGreaterThan(250);
  });

  test('impossible shaping is explained instead of written wrong', async ({ page }) => {
    await page.goto(URL);
    await set(page, 'ev-k', 20); await set(page, 'ev-n', 20);
    await expect(page.getByTestId('ev-instr')).toContainText('At most 19 increases');
    await page.getByTestId('ev-mode').selectOption('round');
    await expect(page.getByTestId('ev-instr')).toHaveText('[k1, M1] 20 times');
    await page.getByTestId('ev-type').selectOption('dec');
    await set(page, 'ev-n', 11);
    await expect(page.getByTestId('ev-instr')).toContainText('The most is 10');
    await set(page, 'ev-n', 10);
    await expect(page.getByTestId('ev-instr')).toHaveText('[k2tog] 10 times');
    await set(page, 'ev-n', 0);
    await expect(page.getByTestId('ev-instr')).toHaveText('k20');
  });

  test('Craft Yarn Council weights 0–7 match the published gauge and needle ranges', async ({ page }) => {
    await page.goto(URL);
    const published = [
      ['0', 'Lace', '33–40', '1.5–2.25 mm'], ['1', 'Super Fine', '27–32', '2.25–3.25 mm'], ['2', 'Fine', '23–26', '3.25–3.75 mm'],
      ['3', 'Light', '21–24', '3.75–4.5 mm'], ['4', 'Medium', '16–20', '4.5–5.5 mm'], ['5', 'Bulky', '12–15', '5.5–8 mm'],
      ['6', 'Super Bulky', '7–11', '8–12.75 mm'], ['7', 'Jumbo', '6 and fewer', '12.75 mm and larger'],
    ];
    for (const [n, name, g, nd] of published) {
      const cells = await page.getByTestId(`cyc-${n}`).locator('td').allTextContents();
      expect(cells[0]).toBe(n); expect(cells[1]).toBe(name); expect(cells[2]).toBe(g);
      expect(cells[3].startsWith(nd)).toBe(true);
    }
    await expect(page.getByTestId('yd-weight').locator('option')).toHaveCount(8);
  });

  test('yardage: the stated model, shown as a rough range, in yards or metres', async ({ page }) => {
    await page.goto(URL);
    const model = (area: number, rowsIn: number) => (area * rowsIn * 5.5) / 36;
    const r10 = (x: number) => Math.max(10, Math.round(x / 10) * 10);
    const typRows: Record<number, number> = { 0: 36.5, 1: 29.5, 2: 24.5, 3: 22.5, 4: 18, 5: 13.5, 6: 9, 7: 5 };
    await expect(page.getByTestId('yd-model')).toContainText('rough');
    // worsted (4) hat, 21 × 9 in: 18 sts → 25.2 rows per 4 in
    let yd = model(21 * 9, (18 * 1.4) / 4);
    await expect(page.getByTestId('yd-range')).toHaveText(`${r10(yd * 0.8)}–${r10(yd * 1.25)} yd`);
    expect(r10(yd * 0.8)).toBeGreaterThanOrEqual(100);                   // sanity: common worsted-hat guidance is ~150–200 yd
    expect(r10(yd * 1.25)).toBeLessThanOrEqual(250);
    for (const [proj, area] of [['sweater', 40 * 24 + 2 * 13 * 19], ['scarf', 420], ['socks', 272]] as const) {
      await page.getByTestId('yd-project').selectOption(proj);
      for (const w of [1, 4, 6]) {
        await page.getByTestId('yd-weight').selectOption(String(w));
        yd = model(area, (typRows[w] * 1.4) / 4);
        await expect(page.getByTestId('yd-range')).toHaveText(`${r10(yd * 0.8)}–${r10(yd * 1.25)} yd`);
        await expect(page.locator(`[data-testid=cyc-${w}]`)).toHaveClass(/on/);
      }
    }
    // my own gauge: 28 rows per 4 in (default)
    await page.getByTestId('yd-gauge').selectOption('mine');
    yd = model(272, 7);
    await expect(page.getByTestId('yd-range')).toHaveText(`${r10(yd * 0.8)}–${r10(yd * 1.25)} yd`);
    await page.getByTestId('unit-metric').click();
    await expect(page.getByTestId('yd-range')).toHaveText(`${r10(yd * 0.8 * 0.9144)}–${r10(yd * 1.25 * 0.9144)} m`);
  });

  test('pattern conversion to my gauge keeps the size and fits the repeat', async ({ page }) => {
    await page.goto(URL);
    // pattern 22 sts / 30 rows per 4 in, 110 sts and 60 rows; mine 20 / 28
    const sts = (110 * 20) / 22, rows = (60 * 28) / 30;
    expect([sts, rows]).toEqual([100, 56]);
    await expect(page.getByTestId('conv-rows')).toHaveText('56');
    await expect(page.getByTestId('conv-n')).toHaveText(String(nearestRepeat(sts, 4, 2)));       // 98 or 102: tie → 102
    await expect(page.getByTestId('conv-detail')).toContainText(`${Math.round((110 / 5.5) * 10) / 10} in width`);  // 20 in
    await set(page, 'co-mult', 1); await set(page, 'co-plus', 0);
    await expect(page.getByTestId('conv-n')).toHaveText('100');
    await set(page, 'gauge-sts', 17);
    await set(page, 'pat-n', 123);
    const want = Math.round((123 * 17) / 22);
    await expect(page.getByTestId('conv-n')).toHaveText(String(want));
    // same width: my count / my gauge ≈ pattern count / pattern gauge
    expect(Math.abs(want / (17 / 4) - 123 / (22 / 4))).toBeLessThan(0.5 / (17 / 4) + 1e-9);
  });

  test('metric and imperial: exact conversions, and a round trip returns the same numbers', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('unit-metric').click();
    await expect(page.getByTestId('unit-metric')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('gauge-sts')).toHaveValue(String(Math.round(((20 / 4) * 10 / 2.54) * 10) / 10));   // 19.7 per 10 cm
    await expect(page.getByTestId('gauge-rows')).toHaveValue(String(Math.round(((28 / 4) * 10 / 2.54) * 10) / 10));  // 27.6
    await expect(page.getByTestId('co-width')).toHaveValue(String(Math.round(18 * 2.54 * 10) / 10));                // 45.7 cm
    await expect(page.locator('label[for=g-sts]')).toContainText('10 cm');
    await expect(page.getByTestId('co-n')).toHaveText('90');                                    // same fabric, same count
    await expect(page.getByTestId('co-detail')).toContainText(`= ${Math.round(18 * 2.54 * 10) / 10} cm`);
    // typing in cm converts: 50 cm at 5 sts/in = 98.4 sts → 98 (4·24 + 2)
    await set(page, 'co-width', 50);
    const s = await page.evaluate(() => (window as any).__knit.state);
    expect(s.widthIn).toBeCloseTo(50 / 2.54, 12);
    await expect(page.getByTestId('co-n')).toHaveText(String(nearestRepeat((50 / 2.54) * 5, 4, 2)));
    await set(page, 'co-width', 45.72);
    await page.getByTestId('unit-imperial').click();
    await expect(page.getByTestId('gauge-sts')).toHaveValue('20');
    await expect(page.getByTestId('co-width')).toHaveValue('18');
    await expect(page.locator('label[for=g-sts]')).toContainText('4 in');
  });
});
