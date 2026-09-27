import { test, expect, Page } from '@playwright/test';

const URL = '/lab/139-tie-dye.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__tiedye.state);
const R0 = Math.SQRT1_2;   // centre to corner of the unit fabric square: where a polar fold reaches s = 1

/** Colour of the unfolded fabric at polar coordinates around the centre (r in fabric units, θ in radians). */
const polar = (page: Page, pts: [number, number][]) => page.evaluate((pts) =>
  pts.map(([r, th]) => (window as any).__tiedye.colourAt(0.5 + r * Math.cos(th), 0.5 + r * Math.sin(th))), pts);
const same = (a: number[], b: number[], tol = 1) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const d2 = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
async function setRange(page: Page, id: string, v: number) {
  await page.getByTestId(id).evaluate((el: HTMLInputElement, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
}
const fold = (page: Page, f: string) => page.locator(`input[name=fold][value="${f}"]`).check();
/** Find the angular shift δ that best maps the ring at r1 onto the ring at r2: ring2(θ) ≈ ring1(θ + δ). */
async function ringShift(page: Page, r1: number, r2: number) {
  const K = 720, th = Array.from({ length: K }, (_, i) => (i / K) * 2 * Math.PI);
  const a = await polar(page, th.map((t) => [r1, t]));
  const b = await polar(page, th.map((t) => [r2, t]));
  let best = 0, bestErr = Infinity;
  for (let k = 0; k < K; k++) {
    let e = 0;
    for (let i = 0; i < K; i++) e += d2(b[i], a[(i + k) % K]);
    if (e < bestErr) { bestErr = e; best = k; }
  }
  return (best / K) * 360;
}
const angDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

test.describe('139 Tie-Dye Studio', () => {
  test('spiral: colours are constant along spiral arms, rotated by the twist between radii', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('twist-out')).toHaveText('1.25 turns');
    const turns = 1.25, perRadius = (turns * 2 * Math.PI) / R0;   // radians of twist per unit of radius
    const pairs: [number, number][] = [], plain: [number, number][] = [];
    for (const r1 of [0.08, 0.15, 0.22]) for (const r2 of [0.3, 0.42]) for (let k = 0; k < 8; k++) {
      const th1 = k * 0.77 + 0.1;
      pairs.push([r1, th1], [r2, th1 - perRadius * (r2 - r1)]);
      plain.push([r1, th1], [r2, th1]);
    }
    const c = await polar(page, pairs), p = await polar(page, plain);
    let matched = 0, differs = 0;
    for (let i = 0; i < c.length; i += 2) {
      if (same(c[i], c[i + 1])) matched++;
      if (!same(p[i], p[i + 1], 20)) differs++;
    }
    expect(matched).toBe(c.length / 2);              // every twisted pair lands on the same arm
    expect(differs).toBeGreaterThan(p.length / 4);   // …which the untwisted comparison doesn't
  });

  test('spiral: the ring-to-ring rotation measured by cross-correlation equals twist × Δr, at two twist settings', async ({ page }) => {
    await page.goto(URL);
    for (const turns of [1.25, 2]) {
      if (turns !== 1.25) { await setRange(page, 'twist', turns); await expect(page.getByTestId('twist-out')).toHaveText(`${turns} turns`); }
      expect((await S(page)).twist).toBe(turns);
      for (const [r1, r2] of [[0.1, 0.25], [0.12, 0.45]]) {
        const want = ((turns * 360 * (r2 - r1)) / R0) % 360;
        const got = await ringShift(page, r1, r2);
        expect(angDiff(got, want), `${turns} turns, r ${r1}→${r2}: ${got.toFixed(1)}° vs ${want.toFixed(1)}°`).toBeLessThanOrEqual(1.5);
      }
    }
  });

  test('bullseye: radially symmetric within tolerance, with distinct rings', async ({ page }) => {
    await page.goto(URL);
    await fold(page, 'bullseye');
    await expect(page.getByTestId('status')).toContainText('Bullseye fold');
    const ringColours: number[][] = [];
    for (const r of [0.04, 0.1, 0.17, 0.24, 0.31, 0.38, 0.46]) {
      const c = await polar(page, Array.from({ length: 36 }, (_, i) => [r, (i / 36) * 2 * Math.PI] as [number, number]));
      const mean = [0, 1, 2].map((ch) => c.reduce((s, x) => s + x[ch], 0) / c.length);
      const worst = Math.max(...c.map((x) => Math.max(...x.map((v, ch) => Math.abs(v - mean[ch])))));
      expect(worst, `ring at r = ${r}`).toBeLessThanOrEqual(2);
      ringColours.push(mean);
    }
    let changes = 0;
    for (let i = 1; i < ringColours.length; i++) if (d2(ringColours[i], ringColours[i - 1]) > 400) changes++;
    expect(changes).toBeGreaterThanOrEqual(3);
    // the spiral, by contrast, is not radially symmetric
    await fold(page, 'spiral');
    const c = await polar(page, Array.from({ length: 36 }, (_, i) => [0.3, (i / 36) * 2 * Math.PI] as [number, number]));
    expect(new Set(c.map((x) => x.join())).size).toBeGreaterThan(5);
  });

  test('diffusion conserves dye: totals before and after soaking match for every fold, mode and absorbency', async ({ page }) => {
    await page.goto(URL);
    await page.locator('input[name=mode][value=spots]').check();
    await page.getByTestId('add-dye').click();
    for (const f of ['spiral', 'bullseye', 'crumple', 'accordion', 'shibori']) {
      await fold(page, f);
      for (const a of [0, 0.5, 1]) {
        await setRange(page, 'absorb', a);
        const s = await S(page);
        expect(s.fold).toBe(f);
        expect(s.absorb).toBe(a);
        const { before, after } = s.totals;
        expect(before.reduce((x: number, y: number) => x + y, 0)).toBeGreaterThan(100);
        before.forEach((b: number, k: number) => expect(Math.abs(after[k] - b), `${f}, soak ${a}, dye ${k}`).toBeLessThanOrEqual(1e-9 * Math.max(1, b)));
        expect(s.alpha * 4).toBeLessThanOrEqual(1);       // explicit diffusion is only stable for α ≤ ¼
      }
    }
    // straight through the diffusion routine with an arbitrary field: the sum holds and the peaks spread out
    const res = await page.evaluate(() => {
      let x = 12345; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      const f = Array.from({ length: 30 * 20 }, () => (rnd() < 0.1 ? 5 : 0));
      const t = (window as any).__tiedye;
      const a = t.diffuse(f, 30, 20, 0.2, 6, true), b = t.diffuse(f, 30, 20, 0.2, 6, false);
      const sum = (v: number[]) => v.reduce((p, q) => p + q, 0);
      return { s0: sum(f), sa: sum(a), sb: sum(b), max0: Math.max(...f), maxA: Math.max(...a) };
    });
    expect(res.sa).toBeCloseTo(res.s0, 9);
    expect(res.sb).toBeCloseTo(res.s0, 9);
    expect(res.maxA).toBeLessThan(res.max0);
    // more absorbent fabric soaks for more steps
    await setRange(page, 'absorb', 0);
    const lo = await S(page);
    await setRange(page, 'absorb', 1);
    const hi = await S(page);
    expect(hi.steps).toBeGreaterThan(lo.steps);
    expect(hi.alpha).toBeGreaterThan(lo.alpha);
  });

  test('deterministic per seed: the same actions on the same seed give the same pixels; seeds differ', async ({ page, context }) => {
    const run = async (p: Page, url: string) => {
      await p.goto(url);
      await p.locator('input[name=fold][value=crumple]').check();
      await p.locator('input[name=mode][value=spots]').check();
      await p.getByTestId('add-dye').click();
      return p.getByTestId('shirt').evaluate((c: HTMLCanvasElement) => c.toDataURL());
    };
    const a = await run(page, URL);
    const p2 = await context.newPage();
    expect(await run(p2, URL)).toBe(a);
    expect(await run(p2, '/lab/139-tie-dye.html?seed=8')).not.toBe(a);
    await p2.close();
    expect((await S(page)).seed).toBe(7);
    await expect(page.getByTestId('seed')).toHaveText('7');
    await page.getByTestId('reseed').click();
    const n = (await S(page)).seed;
    expect(page.url()).toContain(`seed=${n}`);
    await expect(page.getByTestId('status')).toContainText(`New seed ${n}`);
  });

  test('undo steps back through dye, fold and settings; Start over gives a clean shirt', async ({ page }) => {
    await page.goto(URL);
    const shot = () => page.getByTestId('shirt').evaluate((c: HTMLCanvasElement) => c.toDataURL());
    await expect(page.getByTestId('undo')).toBeDisabled();
    const s0 = await shot();
    expect((await S(page)).layers).toHaveLength(1);
    await page.locator('input[name=mode][value=spots]').check();
    await page.getByTestId('add-dye').click();
    await fold(page, 'accordion');
    let s = await S(page);
    expect(s.layers.map((l: any) => l.mode)).toEqual(['wedges', 'spots']);
    expect(s.undoDepth).toBe(2);
    await page.getByTestId('undo').click();
    expect((await S(page)).fold).toBe('spiral');
    await page.getByTestId('undo').click();
    s = await S(page);
    expect(s.layers).toHaveLength(1);
    expect(await shot()).toBe(s0);
    await expect(page.getByTestId('undo')).toBeDisabled();
    await expect(page.getByTestId('add-dye')).toBeFocused();   // focus doesn't stay on a disabled button
    // start over: no dye at all, so every point is the bare fabric colour (0.93 linear reflectance → sRGB)
    await page.getByTestId('reset').click();
    const lin = (v: number) => Math.round(255 * (1.055 * v ** (1 / 2.4) - 0.055));
    const bare = [lin(0.93), lin(0.93), lin(0.9)];
    const pts = await page.evaluate(() => [[0.1, 0.1], [0.5, 0.5], [0.9, 0.3]].map(([u, v]) => (window as any).__tiedye.colourAt(u, v)));
    for (const c of pts) expect(c).toEqual(bare);
    await page.getByTestId('undo').click();
    expect(await shot()).toBe(s0);
  });

  test('export: Download PNG saves a real 480×520 PNG named after the seed', async ({ page }) => {
    await page.goto(URL);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    expect(dl.suggestedFilename()).toBe('tie-dye-seed-7.png');
    const stream = await dl.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([480, 520]);
    await expect(page.getByTestId('status')).toContainText('Saved tie-dye-seed-7.png');
  });

  test('subtractive-looking mix: a per-channel filter product in linear light; dye only ever darkens', async ({ page }) => {
    await page.goto(URL);
    const { FABRIC, STRENGTH, palettes } = await page.evaluate(() => { const t = (window as any).__tiedye; return { FABRIC: t.FABRIC, STRENGTH: t.STRENGTH, palettes: t.palettes }; });
    const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const srgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const model = (amounts: number[], pal: string[]) => [0, 1, 2].map((ch) => srgb(amounts.reduce((acc, c, k) => (c > 0 ? acc * Math.max(0.02, lin(rgb(pal[k])[ch])) ** (Math.min(1.6, c) * STRENGTH) : acc), FABRIC[ch])));
    const pal = palettes.rainbow;
    const cases = [[0, 0, 0, 0, 0], [1, 0, 0, 0, 0], [0, 0, 1, 1, 0], [0.3, 0.7, 0, 0, 1.2], [2, 2, 2, 2, 2], [0, 0, 0.5, 0, 0]];
    for (const a of cases) expect(await page.evaluate(([a, p]) => (window as any).__tiedye.mix(a, p), [a, pal] as const)).toEqual(model(a, pal));
    // yellow over turquoise reads green
    const g = model([0, 0, 1, 1, 0], pal);
    expect(g[1]).toBeGreaterThan(g[0]);
    expect(g[1]).toBeGreaterThan(g[2]);
    // adding any dye never raises a channel
    const base = model([0.4, 0, 0.6, 0, 0], pal);
    for (let k = 0; k < 5; k++) {
      const more = [0.4, 0, 0.6, 0, 0]; more[k] += 0.5;
      model(more, pal).forEach((v, ch) => expect(v).toBeLessThanOrEqual(base[ch]));
    }
  });

  test('accordion: each pleat mirrors its neighbour, and the pattern repeats every two pleats', async ({ page }) => {
    await page.goto(URL);
    await fold(page, 'accordion');
    await expect(page.getByTestId('pleat-out')).toBeVisible();
    await expect(page.getByTestId('twist-out')).toBeHidden();
    for (const P of [8, 12]) {
      if (P !== 8) await setRange(page, 'pleats', P);
      expect((await S(page)).pleats).toBe(P);
      const pairs = await page.evaluate((P) => {
        const t = (window as any).__tiedye, out: number[][][] = [];
        for (const u of [0.013, 0.05, 0.071, 0.1]) for (const v of [0.2, 0.55, 0.81]) for (let k = 1; k <= 3; k++) {
          out.push([t.colourAt(u, v), t.colourAt((2 * k) / P - u, v)]);        // mirror across a fold line
          out.push([t.colourAt(u, v), t.colourAt(u + (2 * k) / P, v)]);        // one full back-and-forth later
        }
        return out;
      }, P);
      for (const [a, b] of pairs) expect(same(a, b)).toBe(true);
    }
  });

  test('the drawn shirt shows the computed fabric, and the controls are labelled and keyboard operable', async ({ page }) => {
    await page.goto(URL);
    const res = await page.evaluate(() => {
      const t = (window as any).__tiedye, st = t.state, box = st.shirtBox, N = st.N;
      const g = (document.querySelector('[data-testid=shirt]') as HTMLCanvasElement).getContext('2d')!;
      let ok = 0, n = 0;
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
        const u = 0.3 + i * 0.035, v = 0.35 + j * 0.05;                     // the shirt body
        const fx = (Math.floor(u * N) + 0.5) / N, fy = (Math.floor(v * N) + 0.5) / N;
        const want = t.colourAt(fx, fy);
        const d = g.getImageData(Math.floor(box.x + fx * box.w), Math.floor(box.y + fy * box.h), 1, 1).data;
        n++; if ([0, 1, 2].every((k) => Math.abs(d[k] - want[k]) <= 14)) ok++;
      }
      return { ok, n };
    });
    expect(res.ok / res.n).toBeGreaterThan(0.9);
    for (const l of ['Dye kit', 'Soak (absorbency)', 'Spiral twist']) await expect(page.getByLabel(l, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Shibori stripes' })).toBeVisible();
    await page.getByRole('radio', { name: 'Spiral' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Bullseye' })).toBeChecked();
    await expect(page.getByTestId('status')).toContainText('Bullseye fold');
    await expect(page.getByTestId('fold-note')).toContainText('rings');
    await expect(page.getByTestId('shirt')).toHaveAttribute('aria-label', /bullseye fold, 1 dye application \(wedges\) in the rainbow kit, seed 7/);
  });
});
