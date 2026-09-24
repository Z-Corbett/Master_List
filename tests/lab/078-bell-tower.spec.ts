import { test, expect, Page } from '@playwright/test';

const URL = '/lab/078-bell-tower.html';
const B = (page: Page) => page.evaluate(() => (window as any).__bells.state);

test.describe('078 Bell Tower', () => {
  test('methods generate true plain courses: Plain Bob Minor is 60 distinct rows back to rounds', async ({ page }) => {
    await page.goto(URL);
    const c = await page.evaluate(() => { const b = (window as any).__bells; const o: any = {}; for (const [k, n] of [['ph5', 5], ['ph6', 6], ['ph7', 7], ['ph8', 8], ['pbd', 5], ['pbm', 6], ['pbt', 7], ['pbj', 8], ['gd', 5], ['pbd', 6], ['pbt', 8]] as const) o[`${k}/${n}`] = b.course(k, n); return o; });
    const pbm = c['pbm/6'];
    expect(pbm).toHaveLength(61);
    expect(pbm[0]).toBe('123456');
    expect(pbm[60]).toBe('123456');
    expect(new Set(pbm.slice(0, 60)).size).toBe(60);
    // the plain course's lead heads, every 12 changes
    expect([12, 24, 36, 48, 60].map((i) => pbm[i])).toEqual(['135264', '156342', '164523', '142635', '123456']);
    const expected: Record<string, [number, string]> = {
      'ph5/5': [10, '12345'], 'ph6/6': [12, '123456'], 'ph7/7': [14, '1234567'], 'ph8/8': [16, '12345678'],
      'pbd/5': [40, '13524'], 'pbt/7': [84, '1352746'], 'pbj/8': [112, '13527486'], 'gd/5': [30, '12534'],
    };
    for (const [key, [changes, firstLeadHead]] of Object.entries(expected)) {
      const rows = c[key];
      expect(rows.length - 1, key).toBe(changes);
      expect(rows[rows.length - 1], key).toBe(rows[0]);                     // comes round
      expect(new Set(rows.slice(0, -1)).size, key).toBe(changes);            // true: no row repeats
      if (!key.startsWith('ph')) expect(rows[{ pbd: 10, pbt: 14, pbj: 16, gd: 10 }[key.split('/')[0]]!], key).toBe(firstLeadHead);
    }
    // every change is legal: each row is a permutation and no bell moves more than one place
    for (const rows of Object.values(c) as string[][]) for (let i = 1; i < rows.length; i++) {
      expect([...rows[i]].sort().join('')).toBe([...rows[0]].sort().join(''));
      for (const bell of rows[i]) expect(Math.abs(rows[i].indexOf(bell) - rows[i - 1].indexOf(bell))).toBeLessThanOrEqual(1);
    }
    // doubles on six and triples on eight: the tenor covers behind
    for (const r of c['pbd/6']) expect(r[5]).toBe('6');
    for (const r of c['pbt/8']) expect(r[7]).toBe('8');
  });

  test('the method board lays out leads with a blue line for the chosen bell', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('changes')).toHaveText('60 changes');
    await expect(page.locator('.lead')).toHaveCount(5);
    const blue = page.getByTestId('blue-line').first();
    const pts = async () => (await blue.getAttribute('points'))!.trim().split(/\s+/).map((p) => p.split(',').map(Number));
    let p = await pts();
    expect(p).toHaveLength(13); // 12 changes + the lead head
    // bell 2 starts in 2nds place, the x step between places is 18 px
    expect(p[1][0] - p[0][0]).toBe(-18); // x: 2 goes down to lead on the first cross
    await page.getByTestId('mine').selectOption('6');
    p = await pts();
    expect(p[0][0]).toBe(5 * 18 + 9 - 4);
    await page.getByTestId('bells').selectOption('8');
    await expect(page.getByTestId('method')).toHaveValue('pbj');
    await expect(page.getByTestId('changes')).toHaveText('112 changes');
    await expect(page.locator('.lead')).toHaveCount(7);
    await page.getByTestId('method').selectOption('ph8');
    await expect(page.getByTestId('changes')).toHaveText('16 changes');
    // plain hunt: the treble's path is 1,1,2,3…8,8,7…1 through the rows
    const treble = await page.evaluate(() => (window as any).__bells.course('ph8', 8).map((r: string) => r.indexOf('1') + 1));
    expect(treble).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 7, 6, 5, 4, 3, 2, 1, 1]);
  });

  test('ringing follows the rows at the set interval, with a handstroke gap', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-01T10:00:00') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-06-01T10:00:02'));
    await page.getByTestId('bells').selectOption('5');
    await page.getByTestId('method').selectOption('ph5');
    await page.getByTestId('speed').fill('300');
    await expect(page.getByTestId('speed-out')).toHaveText('300 ms');
    await page.getByTestId('play').click();
    await expect(page.getByTestId('stop')).toBeEnabled();
    const times = await page.evaluate(() => (window as any).__bells.blowTimes(1));
    // treble: leads rounds at hand and back, then after the handstroke gap the first change (21345) puts her in 2nds place
    expect(times.slice(0, 3)).toEqual([0, 5 * 300, (10 + 1 + 1) * 300]);
    await page.clock.runFor(400 + 4000);
    const s = await B(page);
    expect(s.audio).toBe(true);
    const flat = (await page.evaluate(() => (window as any).__bells.sequence())).join('').split('').map(Number);
    expect(s.struck.length).toBeGreaterThan(11);
    expect(s.struck).toEqual(flat.slice(0, s.struck.length));  // bells strike in exactly the row order
    // at 300 ms, 4 s is about 13 blows (two rounds rows plus the gap)
    expect(s.struck.length).toBeLessThanOrEqual(14);
    await expect(page.getByTestId('row-now')).toContainText('change 1 of 10');
    await page.clock.runFor(20000);
    await expect(page.getByTestId('status')).toContainText("That's all. Plain Hunt Doubles rung.");
    expect((await B(page)).struck).toEqual(flat);
  });

  test('tap-along scores your striking against your bell', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-01T10:00:00') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-06-01T10:00:02'));
    await page.getByTestId('bells').selectOption('5');
    await page.getByTestId('method').selectOption('ph5');
    await page.getByTestId('mine').selectOption('3');
    await page.getByTestId('tap-mode').check();
    await page.getByTestId('play').click();
    await expect(page.getByTestId('pull')).toBeEnabled();
    const times: number[] = await page.evaluate(() => (window as any).__bells.blowTimes(3));
    const at = async (target: number) => {
      const wait = await page.evaluate((t) => (window as any).__bells.t0 + t - performance.now(), target);
      if (wait > 0) await page.clock.runFor(wait);
    };
    // four perfect blows, by keyboard and by the sally
    for (let i = 0; i < 4; i++) { await at(times[i]); if (i % 2) await page.getByTestId('pull').dispatchEvent('pointerdown'); else await page.keyboard.press('Space'); }
    await expect(page.getByTestId('taps')).toHaveText('4');
    await expect(page.getByTestId('mean-err')).toHaveText('0 ms');
    await expect(page.getByTestId('good')).toHaveText('100%');
    await expect(page.getByTestId('status')).toHaveText('Good striking (±0 ms).');
    // one blow 120 ms late
    await at(times[4] + 120);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('status')).toHaveText('Late: +120 ms. Pull in sooner.');
    await expect(page.getByTestId('mean-err')).toHaveText('24 ms');
    await expect(page.getByTestId('good')).toHaveText('80%');
    // let the next blow go by untouched: it is counted as missed
    await at(times[5] + 500);
    const s = await B(page);
    expect(s.stats.missed).toBe(1);
    expect(s.stats.hits).toBe(5);
    // the band rang every other bell; yours was left to you
    expect(s.struck.filter((b: number) => b !== 3).length).toBeGreaterThan(20);
    await page.getByTestId('stop').click();
    await expect(page.getByTestId('status')).toContainText('Stand!');
  });
});
