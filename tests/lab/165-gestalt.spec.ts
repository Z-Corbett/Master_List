import { test, expect, Page } from '@playwright/test';

const URL = '/lab/165-gestalt.html';

/** Independent union-find, used by every oracle below. */
function groups(n: number, linked: (i: number, j: number) => boolean) {
  const p = Array.from({ length: n }, (_, i) => i);
  const f = (i: number): number => (p[i] === i ? i : (p[i] = f(p[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (linked(i, j)) p[f(i)] = f(j);
  return new Set(Array.from({ length: n }, (_, i) => f(i))).size;
}

type Oracle = (page: Page) => Promise<number>;

/** Sweep a slider over its whole range; at each value the page's count must equal the oracle's. Returns the values where the count changes. */
async function sweep(page: Page, id: string, oracle: Oracle) {
  const slider = page.getByTestId('slider-' + id);
  const [min, max] = [Number(await slider.getAttribute('min')), Number(await slider.getAttribute('max'))];
  const seq: number[] = [];
  for (let v = min; v <= max; v++) {
    await slider.fill(String(v));
    const pageCount = Number(await page.getByTestId('svg-' + id).getAttribute('data-groups'));
    const mine = await oracle(page);
    expect(pageCount, `${id} at ${v}`).toBe(mine);
    seq.push(mine);
  }
  const changes: number[] = [];
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) changes.push(min + i);
  return { changes, seq, min };
}

const proximityOracle: Oracle = async (page) => {
  const pts = await page.getByTestId('svg-proximity').locator('circle').evaluateAll((els) => els.map((e) => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]));
  expect(pts).toHaveLength(24);
  const T = 1.5 * 24;                                      // the stated linking distance
  return groups(pts.length, (i, j) => Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) <= T + 1e-6);
};

test.describe('165 Gestalt', () => {
  test('proximity: single-linkage count matches an independent clustering at every slider value; splits at 13 and 25 px', async ({ page }) => {
    await page.goto(URL);
    const { changes, seq } = await sweep(page, 'proximity', proximityOracle);
    // By hand: pair gaps are 24 + v and 24 + v/2; a gap breaks the field once it exceeds 36, i.e. v > 12 and v > 24.
    expect(changes).toEqual([13, 25]);
    expect([seq[0], seq[13], seq[25]]).toEqual([1, 2, 3]);
    // the dots only move sideways: every row keeps the same y and the dot spacing inside a pair stays 24
    await page.getByTestId('slider-proximity').fill('30');
    const xs = await page.getByTestId('svg-proximity').locator('circle').evaluateAll((els) => els.slice(0, 6).map((e) => Number(e.getAttribute('cx'))));
    expect(xs.slice(1).map((x, i) => +(x - xs[i]).toFixed(3))).toEqual([24, 54, 24, 39, 24]);
  });

  test('similarity: grouping by lightness matches an independent attribute clustering; changes at 7 and 11', async ({ page }) => {
    await page.goto(URL);
    const oracle: Oracle = async (p) => {
      const ls = await p.getByTestId('svg-similarity').locator('circle[data-l]').evaluateAll((els) => els.map((e) => {
        const L = Number(e.getAttribute('data-l'));
        const [r, g, b] = getComputedStyle(e).fill.match(/\d+(\.\d+)?/g)!.map(Number);
        return { L, r, g, b };
      }));
      expect(ls).toHaveLength(24);
      // the drawn colour really is that lightness of grey (hsl with 0 saturation → r = g = b = L% of 255)
      for (const d of ls) { expect(d.r).toBe(d.g); expect(d.g).toBe(d.b); expect(Math.abs(d.r - (d.L / 100) * 255)).toBeLessThanOrEqual(1); }
      return groups(ls.length, (i, j) => Math.abs(ls[i].L - ls[j].L) <= 10 + 1e-9);
    };
    const { changes } = await sweep(page, 'similarity', oracle);
    // Tones are 15, 15 + v, 15 + 2.5v. Neighbouring tones differ by v and 1.5v: 1.5v > 10 from v = 7, v > 10 from v = 11.
    expect(changes).toEqual([7, 11]);
    // the dots never move while the tones change
    const pos = () => page.getByTestId('svg-similarity').locator('circle[data-l]').evaluateAll((els) => els.map((e) => e.getAttribute('cx') + ',' + e.getAttribute('cy')));
    const a = await pos();
    await page.getByTestId('slider-similarity').fill('20');
    expect(await pos()).toEqual(a);
  });

  test('closure: arcs join across breaks up to 30°; the ring becomes 2 pieces at 16° and 4 at 31°', async ({ page }) => {
    await page.goto(URL);
    const oracle: Oracle = async (p) => {
      const arcs = await p.getByTestId('svg-closure').locator('path[data-arc]').evaluateAll((els) => els.map((e) => [Number(e.getAttribute('data-a0')), Number(e.getAttribute('data-a1')), e.getAttribute('d')!]));
      expect(arcs).toHaveLength(4);
      // the drawn path really starts at a0 on the r = 70 circle around (180, 100)
      for (const [a0, , d] of arcs) {
        const [x, y] = (d as string).slice(1).split(/[ A]/).slice(0, 2).map(Number);
        expect(x).toBeCloseTo(180 + 70 * Math.cos((a0 as number) * Math.PI / 180), 2);
        expect(y).toBeCloseTo(100 + 70 * Math.sin((a0 as number) * Math.PI / 180), 2);
      }
      const gaps = arcs.map((a, k) => ((((arcs[(k + 1) % 4][0] as number) - (a[1] as number)) % 360) + 360) % 360);
      const wide = gaps.filter((g) => g > 30 + 1e-6).length;
      return wide <= 1 ? 1 : wide;                            // one break in a loop still leaves one piece
    };
    const { changes, seq } = await sweep(page, 'closure', oracle);
    // Breaks are v, 2v, v, 2v: the 2v breaks exceed 30° from v = 16, the v breaks from v = 31.
    expect(changes).toEqual([16, 31]);
    expect([seq[0], seq[16], seq[31]]).toEqual([1, 2, 4]);
  });

  test('continuity: pieces pair up when they run within 20° of straight through; counts 2 → 3 at 21° and → 4 at 41°', async ({ page }) => {
    await page.goto(URL);
    const oracle: Oracle = async (p) => {
      const segs = await p.getByTestId('svg-continuity').locator('line[data-piece]').evaluateAll((els) => els.map((e) => ['x1', 'y1', 'x2', 'y2'].map((a) => Number(e.getAttribute(a)))));
      expect(segs).toHaveLength(4);
      for (const s of segs) expect([s[0], s[1]]).toEqual([180, 100]);         // all four meet at one crossing
      const ang = segs.map(([x1, y1, x2, y2]) => Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
      const offStraight = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.abs(180 - (d > 180 ? 360 - d : d)); };
      const pairs = [];
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs.push({ i, j, d: offStraight(ang[i], ang[j]) });
      pairs.sort((a, b) => a.d - b.d);
      const used = new Set<number>(); let links = 0;
      // endpoints are drawn to 0.001 px, so the angles carry about 0.001° of rounding: allow that much at the boundary
      for (const q of pairs) if (q.d <= 20 + 0.01 &&!used.has(q.i) && !used.has(q.j)) { used.add(q.i); used.add(q.j); links++; }
      return 4 - links;
    };
    const { changes, seq } = await sweep(page, 'continuity', oracle);
    expect(changes).toEqual([21, 41]);
    expect([seq[0], seq[21], seq[41]]).toEqual([2, 3, 4]);
  });

  test('figure and ground: the narrower stripes are the figure; 4 dark figures turn into 3 light ones at 49 px', async ({ page }) => {
    await page.goto(URL);
    const oracle: Oracle = async (p) => {
      const st = await p.getByTestId('svg-figure').locator('rect[data-stripe]').evaluateAll((els) => els.map((e) => ({ w: Number(e.getAttribute('width')), x: Number(e.getAttribute('x')), dark: getComputedStyle(e).fill === 'rgb(26, 26, 32)' })));
      expect(st).toHaveLength(7);
      expect(st.reduce((a, s) => a + s.w, 0)).toBeCloseTo(336, 2);          // the stripes fill the frame exactly
      st.slice(1).forEach((s, i) => expect(s.x).toBeCloseTo(st[i].x + st[i].w, 2));
      const dark = st.filter((s) => s.dark), light = st.filter((s) => !s.dark);
      expect(dark).toHaveLength(4);
      return dark[0].w <= light[0].w + 1e-3 ? dark.length : light.length;
    };
    const { changes, seq } = await sweep(page, 'figure', oracle);
    // dark width a vs light width (336 − 4a)/3: equal at a = 48 (tie → dark); light is narrower from 49.
    expect(changes).toEqual([49]);
    expect([seq[0], seq[seq.length - 1]]).toEqual([4, 3]);
    await page.getByTestId('reveal-figure').click();
    await expect(page.getByTestId('svg-figure').locator('[data-mark]')).toHaveCount(3);
  });

  test('common region: a panel counts from 20% strength; one visible panel makes 2 groups (at 20%), both make 3 (at 40%)', async ({ page }) => {
    await page.goto(URL);
    const oracle: Oracle = async (p) => {
      const svg = p.getByTestId('svg-region');
      const regs = await svg.locator('rect[data-region]').evaluateAll((els) => els.map((e) => ({ x: Number(e.getAttribute('x')), w: Number(e.getAttribute('width')), op: Number(e.getAttribute('stroke-opacity')) })));
      const xs = await svg.locator('circle[data-dot]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('cx'))));
      expect(xs).toHaveLength(9);
      const sig = (x: number) => regs.map((r) => (r.op >= 0.2 - 1e-9 && x > r.x && x < r.x + r.w ? 1 : 0)).join('');
      return groups(9, (i, j) => j === i + 1 && sig(xs[i]) === sig(xs[j]));
    };
    const { changes, seq } = await sweep(page, 'region', oracle);
    expect(changes).toEqual([20, 40]);
    expect([seq[0], seq[20], seq[40]]).toEqual([1, 2, 3]);
  });

  test('common fate under page.clock: dots move by amp · sin(2πt / 2 s), and sampled paths reproduce the model count', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-27T12:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-27T12:00:02Z'));
    const slider = page.getByTestId('slider-fate');
    const read = () => page.getByTestId('svg-fate').evaluate((svg) => ({
      t: Number(svg.getAttribute('data-t')),
      ys: [...svg.querySelectorAll('circle[data-dot]')].map((c) => Number(c.getAttribute('cy'))),
    }));
    await slider.fill('10');
    await page.clock.runFor(100);
    // positions follow the formula exactly for the page's frame time: A = +10, B = −5, C = 0 times sin(2πt/2000)
    let r = await read();
    const s = Math.sin(2 * Math.PI * r.t / 2000);
    r.ys.forEach((y, i) => expect(y).toBeCloseTo(100 + [10, -5, 0][i % 3] * s, 2));
    // the frame time follows the fake clock (frames land on a ~16 ms grid)
    const t1 = r.t;
    await page.clock.runFor(500);
    r = await read();
    expect(r.t - t1).toBeGreaterThanOrEqual(500 - 17);
    expect(r.t - t1).toBeLessThanOrEqual(500 + 17);

    /** Sample one full cycle, 40 steps of 50 ms, and cluster the paths: linked when they never differ by more than 4 px. */
    const sampled = async () => {
      const paths: number[][] = Array.from({ length: 12 }, () => []);
      for (let k = 0; k < 40; k++) { await page.clock.runFor(50); (await read()).ys.forEach((y, i) => paths[i].push(y)); }
      const moved = paths.map((p) => Math.max(...p) - Math.min(...p));
      const count = groups(12, (i, j) => Math.max(...paths[i].map((y, k) => Math.abs(y - paths[j][k]))) <= 4 + 1e-6);
      return { count, moved };
    };
    let out = await sampled();
    expect(out.count).toBe(3);
    expect(Number(await page.getByTestId('svg-fate').getAttribute('data-groups'))).toBe(3);
    expect(out.moved[0]).toBeGreaterThan(19);                 // A travels about 2 × 10 px
    expect(out.moved[2]).toBe(0);                             // C never moves
    for (const [v, want] of [['6', 2], ['2', 1]] as const) {
      await slider.fill(v);
      out = await sampled();
      expect(out.count, `amplitude ${v}`).toBe(want);
      expect(Number(await page.getByTestId('svg-fate').getAttribute('data-groups'))).toBe(want);
    }
    // the exact change points of the model: 1.5v, v and v/2 against 4 px → changes at 5 and 9
    await page.clock.pauseAt(new Date('2026-09-27T12:00:30Z'));
    const seq: number[] = [];
    for (let v = 0; v <= 30; v++) { await slider.fill(String(v)); seq.push(await page.evaluate(() => (window as any).__gestalt.count('fate'))); }
    const changes = seq.flatMap((c, i) => (i && c !== seq[i - 1] ? [i] : []));
    expect(changes).toEqual([5, 9]);

    // Pause freezes the dots however far the clock runs
    await page.getByTestId('fate-play').click();
    await expect(page.getByTestId('fate-play')).toHaveText('Play motion');
    const frozen = await read();
    await page.clock.runFor(700);
    expect(await read()).toEqual(frozen);
    await page.getByTestId('fate-play').click();
    await page.clock.runFor(300);
    expect((await read()).t).toBeGreaterThan(frozen.t + 250);
  });

  test('the "how many groups?" prompt answers against the model and keeps score', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('slider-proximity').fill('30');
    await page.getByTestId('answer-proximity').fill('3');
    await page.getByTestId('answer-proximity').press('Enter');
    await expect(page.getByTestId('verdict-proximity')).toHaveText('You said 3. The model also sees 3 groups. Agreed.');
    await page.getByTestId('answer-similarity').fill('2');
    await page.getByTestId('ask-similarity').getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('verdict-similarity')).toContainText('You said 2; the model sees 1 group, because the three tones are 15%, 15% and 15% lightness');
    await expect(page.getByTestId('answered')).toHaveText('2');
    await expect(page.getByTestId('agreed')).toHaveText('1');
    // an empty answer is refused politely, and focus goes back to the field
    await page.getByTestId('ask-closure').getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('answer-closure')).toBeFocused();
    await expect(page.getByTestId('answered')).toHaveText('2');
    // moving the slider clears a stale verdict
    await page.getByTestId('slider-proximity').fill('10');
    await expect(page.getByTestId('verdict-proximity')).toHaveText('');
    expect(await page.evaluate(() => (window as any).__gestalt.answers())).toMatchObject({ proximity: { said: 3, model: 3, agree: true, value: 30 }, similarity: { said: 2, model: 1, agree: false } });
  });

  test('Show model colours each model group in its own colour and states the count; the slider works from the keyboard', async ({ page }) => {
    await page.goto(URL);
    const slider = page.getByTestId('slider-proximity');
    await slider.focus();
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('out-proximity')).toHaveText('25 px');
    await expect(page.getByTestId('svg-proximity')).toHaveAttribute('data-groups', '3');
    await expect(page.getByTestId('modelline-proximity')).toBeHidden();
    await page.getByTestId('reveal-proximity').click();
    await expect(page.getByTestId('reveal-proximity')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('modelline-proximity')).toHaveText('The model sees 3 groups: the gaps between pairs are 49 px and 36.5 px against a linking distance of 36 px.');
    const fills = await page.getByTestId('svg-proximity').locator('circle').evaluateAll((els) => els.map((e) => [Math.round((Number(e.getAttribute('cx')) - 0) / 1), e.getAttribute('fill')!] as const));
    // dots in the same column pair share a colour; the three pairs get three different colours
    const byPair = new Map<string, Set<string>>();
    const xs = [...new Set(fills.map((f) => f[0]))].sort((a, b) => a - b);
    fills.forEach(([x, f]) => { const pair = String(Math.floor(xs.indexOf(x) / 2)); if (!byPair.has(pair)) byPair.set(pair, new Set()); byPair.get(pair)!.add(f); });
    expect([...byPair.values()].map((s) => s.size)).toEqual([1, 1, 1]);
    expect(new Set([...byPair.values()].map((s) => [...s][0])).size).toBe(3);
    await expect(page.getByTestId('svg-proximity')).toHaveAttribute('aria-label', /The model sees 3 groups/);
    await page.keyboard.press('Home');
    await expect(page.getByTestId('svg-proximity')).toHaveAttribute('data-groups', '3');   // focus moved to the button, the slider is unchanged
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('svg-proximity')).toHaveAttribute('data-groups', '1');
    await expect(page.getByTestId('modelline-proximity')).toContainText('sees 1 group:');
  });

  test('all seven principles are present in order, each with its own explanation, a slider, a model and a question', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('section.toy h2')).toHaveText(['Proximity', 'Similarity', 'Closure', 'Continuity', 'Figure and ground', 'Common region', 'Common fate']);
    const ids = ['proximity', 'similarity', 'closure', 'continuity', 'figure', 'region', 'fate'];
    for (const id of ids) {
      const sec = page.getByTestId('toy-' + id);
      expect(await sec.locator('p').count()).toBeGreaterThanOrEqual(3);
      await expect(page.getByTestId('model-' + id)).toContainText('Model:');
      await expect(sec.getByRole('slider')).toHaveCount(1);
      await expect(sec.getByRole('spinbutton')).toHaveCount(1);
      await expect(page.getByTestId('svg-' + id)).toHaveAttribute('aria-label', /demo at/);
    }
    await expect(page.getByTestId('toy-figure').getByRole('spinbutton')).toHaveAccessibleName('How many figures (shapes in front) do you see?');
    await expect(page.getByTestId('toy-fate').getByRole('slider')).toHaveAccessibleName(/Distance travelled/);
    await expect(page.locator('footer')).toContainText('Palmer');
    await expect(page.getByRole('link', { name: 'Services' })).toHaveAttribute('href', '../index.html#services');
  });
});
