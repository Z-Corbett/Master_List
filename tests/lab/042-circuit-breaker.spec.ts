import { test, expect, Page } from '@playwright/test';

const URL = '/lab/042-circuit-breaker.html';

type Sol = { g: Array<[string, number, number]>; w: Array<[string, string]> };
// A par solution for every level. Gate ids are slot based: c<col>r<row>.
const SOLUTIONS: Sol[] = [
  { g: [['NOT', 0, 0]], w: [['A', 'c0r0.in0'], ['c0r0.out', 'Y']] },
  { g: [['AND', 0, 0]], w: [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['c0r0.out', 'Y']] },
  { g: [['OR', 0, 0]], w: [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['c0r0.out', 'Y']] },
  { g: [['XOR', 0, 0]], w: [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['c0r0.out', 'Y']] },
  { g: [['OR', 0, 0], ['NOT', 1, 0]], w: [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['c0r0.out', 'c1r0.in0'], ['c1r0.out', 'Y']] },
  { g: [['NAND', 0, 0]], w: [['A', 'c0r0.in0'], ['A', 'c0r0.in1'], ['c0r0.out', 'Y']] },
  { g: [['NAND', 0, 0], ['NAND', 1, 0]], w: [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['c0r0.out', 'c1r0.in0'], ['c0r0.out', 'c1r0.in1'], ['c1r0.out', 'Y']] },
  { g: [['NAND', 0, 0], ['NAND', 0, 1], ['NAND', 1, 0]], w: [['A', 'c0r0.in0'], ['A', 'c0r0.in1'], ['B', 'c0r1.in0'], ['B', 'c0r1.in1'], ['c0r0.out', 'c1r0.in0'], ['c0r1.out', 'c1r0.in1'], ['c1r0.out', 'Y']] },
  { g: [['XOR', 0, 0], ['AND', 0, 1]], w: [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['A', 'c0r1.in0'], ['B', 'c0r1.in1'], ['c0r0.out', 'S'], ['c0r1.out', 'C']] },
  { g: [['XOR', 0, 0], ['XOR', 1, 0]], w: [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['c0r0.out', 'c1r0.in0'], ['C', 'c1r0.in1'], ['c1r0.out', 'Y']] },
  { g: [['XOR', 0, 0], ['AND', 0, 1], ['AND', 1, 0], ['OR', 2, 0]], w: [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['A', 'c0r1.in0'], ['B', 'c0r1.in1'], ['c0r0.out', 'c1r0.in0'], ['C', 'c1r0.in1'], ['c1r0.out', 'c2r0.in0'], ['c0r1.out', 'c2r0.in1'], ['c2r0.out', 'Y']] },
  { g: [['NOT', 0, 0], ['AND', 0, 1], ['AND', 1, 0], ['OR', 2, 0]], w: [['S', 'c0r0.in0'], ['B', 'c0r1.in0'], ['S', 'c0r1.in1'], ['A', 'c1r0.in0'], ['c0r0.out', 'c1r0.in1'], ['c1r0.out', 'c2r0.in0'], ['c0r1.out', 'c2r0.in1'], ['c2r0.out', 'Y']] },
  { g: [['NAND', 0, 0], ['NAND', 1, 0], ['NAND', 1, 1], ['NAND', 2, 0]], w: [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['A', 'c1r0.in0'], ['c0r0.out', 'c1r0.in1'], ['B', 'c1r1.in0'], ['c0r0.out', 'c1r1.in1'], ['c1r0.out', 'c2r0.in0'], ['c1r1.out', 'c2r0.in1'], ['c2r0.out', 'Y']] },
  { g: [['XOR', 0, 0], ['AND', 0, 1], ['XOR', 1, 0], ['AND', 1, 1], ['OR', 2, 0]], w: [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['A', 'c0r1.in0'], ['B', 'c0r1.in1'], ['c0r0.out', 'c1r0.in0'], ['Cin', 'c1r0.in1'], ['c0r0.out', 'c1r1.in0'], ['Cin', 'c1r1.in1'], ['c1r1.out', 'c2r0.in0'], ['c0r1.out', 'c2r0.in1'], ['c1r0.out', 'S'], ['c2r0.out', 'Cout']] },
];

async function fresh(page: Page) {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
}

test.describe('042 Circuit Breaker', () => {
  test('level 1 solved entirely through the UI: place, wire, toggle, three stars', async ({ page }) => {
    await fresh(page);
    await expect(page.getByTestId('level-name')).toHaveText('Inverter');
    await expect(page.getByTestId('status')).toHaveText('0 of 2 rows correct.');
    await page.getByTestId('tool-NOT').click();
    await expect(page.getByTestId('tool-NOT')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('slot-0-0').click();
    await expect(page.getByTestId('gate-c0r0')).toBeVisible();
    await expect(page.getByTestId('left-NOT')).toHaveText('×0');
    // wire A → NOT, using the keyboard for this hop
    await page.getByTestId('port-A').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('port-A')).toHaveClass(/armed/);
    await page.getByTestId('port-c0r0.in0').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wire-c0r0.in0')).toBeAttached();
    await expect(page.getByTestId('status')).toHaveText('0 of 2 rows correct.');
    // NOT → Y by tapping
    await page.getByTestId('port-c0r0.out').click();
    await page.getByTestId('port-Y').click();
    await expect(page.getByTestId('status')).toHaveText('All 2 rows light up.');
    await expect(page.getByTestId('win')).toBeVisible();
    await expect(page.getByTestId('stars')).toHaveAttribute('data-stars', '3');
    await expect(page.getByTestId('level-1')).toHaveAccessibleName('Level 1: Inverter, 3 of 3 stars');
    await expect(page.getByTestId('total-stars')).toHaveText('3 / 42');
    // live signal: A=0 lights Y; flipping the switch turns it off
    await expect(page.getByTestId('lamp-Y')).toHaveAttribute('data-value', '1');
    await page.getByTestId('toggle-A').click();
    await expect(page.getByTestId('toggle-A')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('lamp-Y')).toHaveAttribute('data-value', '0');
    await expect(page.getByTestId('wire-c0r0.in0')).toHaveClass(/hi/);
    await page.getByTestId('next').click();
    await expect(page.getByTestId('level-name')).toHaveText('Both');
  });

  test('truth-table checker counts matching rows; wrong gates, undo and removal', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('level-4').click();
    await expect(page.getByTestId('level-name')).toHaveText('One or the other');
    await page.getByTestId('tool-AND').click();
    await page.getByTestId('slot-0-0').click();
    await page.getByTestId('port-A').click(); await page.getByTestId('port-c0r0.in0').click();
    await page.getByTestId('port-B').click(); await page.getByTestId('port-c0r0.in1').click();
    await page.getByTestId('port-c0r0.out').click(); await page.getByTestId('port-Y').click();
    // AND vs XOR: only 00 matches
    await expect(page.getByTestId('status')).toHaveText('1 of 4 rows correct.');
    for (const [k, pass] of [[0, 'true'], [1, 'false'], [2, 'false'], [3, 'false']] as const) {
      await expect(page.getByTestId(`row-${k}`)).toHaveAttribute('data-pass', pass);
    }
    // clicking a table row drives the input switches
    await page.getByTestId('row-3').getByRole('button').click();
    await expect(page.getByTestId('toggle-A')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('toggle-B')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('lamp-Y')).toHaveAttribute('data-value', '1');

    // unplugging an input: tap the connected port
    await page.getByTestId('port-Y').click();
    await expect(page.getByTestId('wire-Y')).toHaveCount(0);
    await expect(page.getByTestId('status')).toHaveText('0 of 4 rows correct.');
    await page.getByTestId('tool-undo').click();
    await expect(page.getByTestId('wire-Y')).toHaveCount(1);

    // swap the AND for an XOR: remove, place, rewire
    await page.getByTestId('tool-remove').click();
    await page.getByTestId('gate-c0r0').click();
    await expect(page.getByTestId('gate-c0r0')).toHaveCount(0);
    await expect(page.locator('[data-testid^="wire-"]')).toHaveCount(0);
    await page.getByTestId('tool-XOR').click();
    await page.getByTestId('slot-0-0').click();
    await page.getByTestId('port-A').click(); await page.getByTestId('port-c0r0.in0').click();
    await page.getByTestId('port-B').click(); await page.getByTestId('port-c0r0.in1').click();
    await page.getByTestId('port-c0r0.out').click(); await page.getByTestId('port-Y').click();
    await expect(page.getByTestId('status')).toHaveText('All 4 rows light up.');
    // Ctrl+Z steps back out of the solution
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('win')).toBeHidden();
    await expect(page.getByTestId('status')).toHaveText('0 of 4 rows correct.');
  });

  test('signals only flow left to right and gate supplies are limited', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('level-5').click();
    await page.getByTestId('tool-NOT').click();
    await page.getByTestId('slot-0-0').click();
    await page.getByTestId('slot-1-0').click();
    await expect(page.getByTestId('left-NOT')).toHaveText('×0');
    await expect(page.getByTestId('tool-NOT')).toBeEnabled(); // still selected
    await page.getByTestId('tool-NOT').click();
    await expect(page.getByTestId('tool-NOT')).toBeDisabled();
    // backwards wire from column 2 into column 1 is refused
    await page.getByTestId('port-c1r0.out').click();
    await page.getByTestId('port-c0r0.in0').click();
    await expect(page.getByTestId('hint')).toContainText('Signals flow left to right');
    await expect(page.getByTestId('wire-c0r0.in0')).toHaveCount(0);
    // a gate may not feed itself either
    await page.getByTestId('port-c0r0.out').click();
    await page.getByTestId('port-c0r0.in0').click();
    await expect(page.getByTestId('wire-c0r0.in0')).toHaveCount(0);
    // Escape cancels an armed wire
    await page.getByTestId('port-A').click();
    await expect(page.getByTestId('port-A')).toHaveClass(/armed/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('port-A')).not.toHaveClass(/armed/);
  });

  test('every level has a par solution that earns three stars', async ({ page }) => {
    await fresh(page);
    const levels = await page.evaluate(() => (window as any).__cb.levels.length);
    expect(levels).toBeGreaterThanOrEqual(10);
    expect(SOLUTIONS).toHaveLength(levels);
    const results = await page.evaluate((sols) => {
      const cb = (window as any).__cb;
      return sols.map((s: any, i: number) => {
        cb.load(i);
        const placed = s.g.every(([t, c, r]: [string, number, number]) => cb.place(t, c, r));
        const wired = s.w.every(([a, b]: [string, string]) => cb.connect(a, b));
        const chk = cb.check();
        return { i, placed, wired, solved: chk.solved, gates: cb.gateCount, par: cb.levels[i].par, stars: cb.saved.stars[i] };
      });
    }, SOLUTIONS);
    for (const r of results) {
      expect(r, `level ${r.i + 1}`).toMatchObject({ placed: true, wired: true, solved: true, stars: 3 });
      expect(r.gates).toBe(r.par);
    }
    await expect(page.getByTestId('total-stars')).toHaveText(`${levels * 3} / ${levels * 3}`);
  });

  test('a bigger-than-par solution earns fewer stars, and stars persist across reloads', async ({ page }) => {
    await fresh(page);
    // majority vote the long way: (A·B) + (B·C) + (A·C) uses 5 gates against a par of 4
    await page.evaluate(() => {
      const cb = (window as any).__cb;
      cb.load(10);
      cb.place('AND', 0, 0); cb.place('AND', 0, 1); cb.place('AND', 1, 1); cb.place('OR', 1, 0); cb.place('OR', 2, 0);
      [['A', 'c0r0.in0'], ['B', 'c0r0.in1'], ['B', 'c0r1.in0'], ['C', 'c0r1.in1'], ['A', 'c1r1.in0'], ['C', 'c1r1.in1'],
       ['c0r0.out', 'c1r0.in0'], ['c0r1.out', 'c1r0.in1'], ['c1r0.out', 'c2r0.in0'], ['c1r1.out', 'c2r0.in1'], ['c2r0.out', 'Y']]
        .forEach(([a, b]) => cb.connect(a, b));
    });
    await expect(page.getByTestId('status')).toHaveText('All 8 rows light up.');
    await expect(page.getByTestId('stars')).toHaveAttribute('data-stars', '2');
    await expect(page.getByTestId('win-text')).toHaveText('Solved with 5 gates (par 4). Try it in 4 for three stars.');
    await expect(page.getByTestId('level-11')).toHaveAccessibleName('Level 11: Majority vote, 2 of 3 stars');
    await page.reload();
    await expect(page.getByTestId('level-name')).toHaveText('Majority vote');
    await expect(page.getByTestId('level-11')).toHaveAccessibleName('Level 11: Majority vote, 2 of 3 stars');
    await expect(page.getByTestId('total-stars')).toHaveText('2 / 42');
    await expect(page.getByTestId('gate-c0r0')).toHaveCount(0);
  });
});
