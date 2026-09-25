import { test, expect, Page } from '@playwright/test';

const URL = '/lab/114-diff-tool.html';
const last = (page: Page) => page.evaluate(() => (window as any).__diff.last);

async function set(page: Page, a: string, b: string) {
  await page.getByTestId('a').fill(a);
  await page.getByTestId('b').fill(b);
}
const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';
const slide = (page: Page, v: number) => page.getByTestId('dmax').evaluate((el: HTMLInputElement, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
const headers = (page: Page) => page.getByTestId('hunk-header').allTextContents();

/** Independent oracle: longest common subsequence by the textbook O(NM) dynamic program. */
function lcs(a: string[], b: string[]) {
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  return L[0][0];
}
/** Apply an edit script to A without looking at B: '=' copies, '-' skips, '+' inserts its value. */
function apply(a: string[], ops: any[]) {
  const out: string[] = [];
  let i = 0;
  for (const p of ops) {
    if (p.op === '=') { expect(p.ai).toBe(i); out.push(a[i++]); }
    else if (p.op === '-') { expect(p.ai).toBe(i); i++; }
    else out.push(p.value);
  }
  expect(i).toBe(a.length);
  return out;
}

test.describe('114 Diff Tool', () => {
  test('Myers finds a minimal script: its edit distance equals N + M − 2·LCS on 80 random pairs', async ({ page }) => {
    await page.goto(URL);
    let s = 20260925;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pairs: [string[], string[]][] = [];
    for (let t = 0; t < 80; t++) {
      const alpha = t % 2 ? 'ab' : 'abcd';
      const mk = () => Array.from({ length: Math.floor(rnd() * 16) }, () => alpha[Math.floor(rnd() * alpha.length)]);
      pairs.push([mk(), mk()]);
    }
    const results = await page.evaluate((ps) => ps.map(([a, b]) => (window as any).__diff.myers(a, b)), pairs);
    pairs.forEach(([a, b], i) => {
      const r = results[i];
      const edits = r.ops.filter((p: any) => p.op !== '=').length;
      expect(r.d, `pair ${i}: ${a.join('')} → ${b.join('')}`).toBe(a.length + b.length - 2 * lcs(a, b));
      expect(edits).toBe(r.d);
      for (const p of r.ops) if (p.op === '=') expect(a[p.ai]).toBe(b[p.bi]);
    });
  });

  test('applying the edit script to A reproduces B exactly, including through the page\'s line pipeline', async ({ page }) => {
    await page.goto(URL);
    let s = 7;
    const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
    const words = ['alpha', 'beta', 'gamma', 'delta', '', '  indented', 'Beta'];
    for (let t = 0; t < 25; t++) {
      const mk = () => Array.from({ length: Math.floor(rnd() * 12) }, () => words[Math.floor(rnd() * words.length)]);
      const a = mk(), b = mk();
      const ta = a.join('\n') + (a.length ? '\n' : ''), tb = b.join('\n') + (b.length ? '\n' : '');
      const r = await page.evaluate(([x, y]) => (window as any).__diff.diffTexts(x, y), [ta, tb]);
      const plus = r.ops.filter((p: any) => p.op === '+');
      plus.forEach((p: any) => expect(p.value).toBe(b[p.bi]));
      expect(apply(a, r.ops)).toEqual(b);
      expect(r.d).toBe(a.length + b.length - 2 * lcs(a, b));
    }
    // and through the UI
    await page.getByTestId('sample-code').click();
    const L = await last(page);
    expect(apply(L.aLines, L.ops)).toEqual(L.bLines);
    expect(L.d).toBe(L.nDel + L.nIns);
    expect(L.d).toBe(L.aLines.length + L.bLines.length - 2 * lcs(L.aLines, L.bLines));
    await expect(page.getByTestId('n-del')).toHaveText(`−${L.nDel}`);
    await expect(page.getByTestId('n-ins')).toHaveText(`+${L.nIns}`);
  });

  test("Myers' own example: ABCABBA → CBABAC has D = 5, and the D-paths match the paper", async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('sample-myers').click();
    await expect(page.getByTestId('d')).toHaveText('5');
    expect(7 + 6 - 2 * lcs([...'ABCABBA'], [...'CBABAC'])).toBe(5);
    await expect(page.getByTestId('graph-path')).toHaveAttribute('data-steps', '9');   // 4 shared + 5 edits
    await expect(page.getByTestId('diag')).toHaveCount([...'ABCABBA'].reduce((n, x) => n + [...'CBABAC'].filter((y) => y === x).length, 0));
    // Figure 1 of the paper: the furthest-reaching 2-paths end at (3,1), (2,2) and (2,4)
    const at = async (d: number) => page.locator(`[data-testid="dpoint"][data-d="${d}"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-k')));
    expect((await at(2)).sort()).toEqual(['-2', '0', '2']);
    const L = await page.evaluate(() => (window as any).__diff.myers([...'ABCABBA'], [...'CBABAC']));
    expect(L.d).toBe(5);
    // drag the D slider back: no 2-path reaches the corner, and the final path is hidden
    await slide(page, 2);
    await expect(page.getByTestId('dmax-out')).toHaveText('2');
    await expect(page.getByTestId('graph-path')).toHaveCount(0);
    await expect(page.getByTestId('graph-note')).toContainText('no 2-path reaches the corner');
    await expect(page.getByTestId('graph')).toHaveAttribute('aria-label', /k=2 reaches \(3,1\); k=0 reaches \(2,2\); k=-2 reaches \(2,4\)|k=-2 reaches \(2,4\); k=0 reaches \(2,2\); k=2 reaches \(3,1\)/);
    await slide(page, 5);
    await expect(page.getByTestId('graph-path')).toHaveCount(1);
  });

  test('unified hunk headers: context, merging within 2n lines, zero context and pure insertions', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('view-unified').check();
    // one change at line 5 of 10, 3 lines of context: lines 2–8 on both sides
    await set(page, lines(10), lines(10, (i) => (i === 5 ? 'LINE FIVE' : `line ${i}`)));
    expect(await headers(page)).toEqual(['@@ -2,7 +2,7 @@']);
    await page.getByTestId('ctx').fill('0');
    expect(await headers(page)).toEqual(['@@ -5 +5 @@']);
    // changes at lines 2 and 18 of 20: 15 lines apart, so separate hunks at n = 3 and one hunk at n = 8
    await set(page, lines(20), lines(20, (i) => (i === 2 || i === 18 ? `changed ${i}` : `line ${i}`)));
    await page.getByTestId('ctx').fill('3');
    expect(await headers(page)).toEqual(['@@ -1,5 +1,5 @@', '@@ -15,6 +15,6 @@']);
    await page.getByTestId('ctx').fill('7');
    expect(await headers(page)).toEqual(['@@ -1,9 +1,9 @@', '@@ -11,10 +11,10 @@']);
    await page.getByTestId('ctx').fill('8');
    expect(await headers(page)).toEqual(['@@ -1,20 +1,20 @@']);
    // a pure insertion after line 2 with no context: the empty old side starts at the line before
    await set(page, 'a\nb\nc\nd\ne\n', 'a\nb\nX\nc\nd\ne\n');
    await page.getByTestId('ctx').fill('0');
    expect(await headers(page)).toEqual(['@@ -2,0 +3 @@']);
    await page.getByTestId('ctx').fill('1');
    expect(await headers(page)).toEqual(['@@ -2,2 +2,3 @@']);
    await expect(page.getByTestId('patch')).toHaveText('--- a/original\n+++ b/changed\n@@ -2,2 +2,3 @@\n b\n+X\n c\n');
    await expect(page.getByTestId('u-ins')).toHaveCount(1);
    await expect(page.getByTestId('u-ctx')).toHaveCount(2);
  });

  test('empty and identical inputs', async ({ page }) => {
    await page.goto(URL);
    await set(page, '', 'x\ny\n');
    expect((await last(page)).hunks).toEqual(['@@ -0,0 +1,2 @@']);
    await expect(page.getByTestId('d')).toHaveText('2');
    await expect(page.getByTestId('a-eol')).toHaveText('empty');
    await set(page, 'x\n', '');
    expect((await last(page)).hunks).toEqual(['@@ -1 +0,0 @@']);
    await set(page, '', '');
    await expect(page.getByTestId('identical')).toHaveText('Both inputs are empty: nothing to compare.');
    await expect(page.getByTestId('n-hunks')).toHaveText('0 hunks');
    const same = lines(6);
    await set(page, same, same);
    await expect(page.getByTestId('identical')).toHaveText('Identical: 6 lines, no edits.');
    await expect(page.getByTestId('d')).toHaveText('0');
    await expect(page.getByTestId('patch')).toHaveText('(no differences)');
    await expect(page.getByTestId('view')).toBeHidden();
    // the edit graph of identical input is a single snake down the diagonal
    await expect(page.getByTestId('graph-path')).toHaveAttribute('data-steps', '6');
    await expect(page.getByTestId('dpoint')).toHaveCount(1);
  });

  test('a missing trailing newline is a change, marked the way diff and git mark it', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('sample-eol').click();
    await expect(page.getByTestId('b-eol')).toHaveText('no newline at end of file');
    await expect(page.getByTestId('patch')).toHaveText('--- a/original\n+++ b/changed\n@@ -1,3 +1,3 @@\n one\n two\n-three\n+three\n\\ No newline at end of file\n');
    await page.getByTestId('view-unified').check();
    await expect(page.getByTestId('no-eol')).toHaveCount(1);
    await page.getByTestId('swap').click();
    await expect(page.getByTestId('patch')).toHaveText('--- a/original\n+++ b/changed\n@@ -1,3 +1,3 @@\n one\n two\n-three\n\\ No newline at end of file\n+three\n');
    // both sides unterminated and the last line shared: one marker on the context line
    await set(page, 'a\nb', 'x\nb');
    await expect(page.getByTestId('patch')).toHaveText('--- a/original\n+++ b/changed\n@@ -1,2 +1,2 @@\n-a\n+x\n b\n\\ No newline at end of file\n');
  });

  test('ignore whitespace and ignore case', async ({ page }) => {
    await page.goto(URL);
    await set(page, 'Hello World\nsecond line\n', 'hello   world\nsecond\tline\n');
    await expect(page.getByTestId('d')).toHaveText('4');
    await page.getByTestId('ignore-case').check();
    await expect(page.getByTestId('d')).toHaveText('4');           // spacing still differs on both lines
    await page.getByTestId('ignore-ws').check();
    await expect(page.getByTestId('d')).toHaveText('0');
    await expect(page.getByTestId('identical')).toHaveText('No differences once whitespace and case are ignored.');
    await page.getByTestId('ignore-case').uncheck();
    await expect(page.getByTestId('d')).toHaveText('2');           // only the first line's case differs
    await expect(page.getByTestId('stats')).toContainText('1 hunk');
  });

  test('word-level highlights mark exactly the inserted tokens', async ({ page }) => {
    await page.goto(URL);
    await set(page, 'function greet(name) {\n  return 1;\n}\n', 'function greet(name, punct = "!") {\n  return 1;\n}\n');
    const cell = page.getByTestId('s-ins').first();
    await expect(cell).toHaveText('function greet(name, punct = "!") {');
    expect((await cell.locator('ins.w').allTextContents()).join('')).toBe(', punct = "!"');
    await expect(page.getByTestId('s-del').first().locator('del.w')).toHaveCount(0);   // nothing of A was removed
    // a changed word, in the unified view
    await set(page, 'the quick brown fox\n', 'the quick red fox\n');
    await page.getByTestId('view-unified').check();
    await expect(page.getByTestId('u-del').locator('del.w')).toHaveText('brown');
    await expect(page.getByTestId('u-ins').locator('ins.w')).toHaveText('red');
    await page.getByTestId('words').uncheck();
    await expect(page.locator('ins.w, del.w')).toHaveCount(0);
    await expect(page.getByTestId('u-ins')).toContainText('the quick red fox');
  });

  test('side-by-side and unified views agree; the views are keyboard radios', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('sample-code').click();
    const L = await last(page);
    await expect(page.getByTestId('s-del')).toHaveCount(L.nDel);
    await expect(page.getByTestId('s-ins')).toHaveCount(L.nIns);
    await expect(page.getByTestId('hunk-header')).toHaveCount(L.hunks.length);
    await page.getByTestId('view-split').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('view-unified')).toBeChecked();
    await expect(page.getByTestId('u-del')).toHaveCount(L.nDel);
    await expect(page.getByTestId('u-ins')).toHaveCount(L.nIns);
    await expect(page.getByTestId('hunk-header')).toHaveText(L.hunks);
    await expect(page.getByTestId('view')).toHaveAttribute('aria-label', `Unified diff, ${L.hunks.length} hunks`);
  });

  test('large inputs skip the edit graph but still diff', async ({ page }) => {
    await page.goto(URL);
    await set(page, lines(200), lines(200, (i) => (i % 50 === 0 ? `edited ${i}` : `line ${i}`)));
    await expect(page.getByTestId('d')).toHaveText('8');
    await expect(page.getByTestId('graph-note')).toContainText('up to 24 lines');
    await expect(page.getByTestId('dpath')).toHaveCount(0);
    expect((await last(page)).hunks).toEqual(['@@ -47,7 +47,7 @@', '@@ -97,7 +97,7 @@', '@@ -147,7 +147,7 @@', '@@ -197,4 +197,4 @@']);
  });
});
