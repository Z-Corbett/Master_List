import { test, expect, Page } from '@playwright/test';

const URL = '/lab/119-constrained-decoding.html?seed=7';
const cd = (page: Page) => page.evaluate(() => (window as any).__cd.state);

/** The schema, checked independently of the page: name string, age integer ≥ 0, tags ≤ 3 strings, nothing else. */
function matchesSchema(v: any): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (!keys.every((k) => ['name', 'age', 'tags'].includes(k))) return false;
  if (typeof v.name !== 'string') return false;
  if (!Number.isInteger(v.age) || v.age < 0) return false;
  if ('tags' in v && !(Array.isArray(v.tags) && v.tags.length <= 3 && v.tags.every((t: unknown) => typeof t === 'string'))) return false;
  return true;
}

test.describe('119 Constrained Decoding', () => {
  test('constrained output always parses and matches the schema, across 300 seeds and three decoders', async ({ page }) => {
    await page.goto(URL);
    const texts: string[] = await page.evaluate(() => {
      const C = (window as any).__cd, out: string[] = [];
      for (const o of [{ temp: 1 }, { temp: 2 }, { greedy: true }]) for (let s = 0; s < 300; s++) {
        const g = C.generate(s, { ...o, constrained: true });
        out.push(g.eos ? g.text : `NO EOS: ${g.text}`);
      }
      return out;
    });
    expect(texts).toHaveLength(900);
    const bad = texts.filter((t) => { try { return !matchesSchema(JSON.parse(t)); } catch { return true; } });
    expect(bad).toEqual([]);
    // and the outputs aren't all the same: the seed matters
    expect(new Set(texts.slice(0, 300)).size).toBeGreaterThan(30);
  });

  test('masked tokens get exactly zero probability, and p and q each sum to 1', async ({ page }) => {
    await page.goto(URL);
    const steps = await page.evaluate(() => {
      const C = (window as any).__cd, out: any[] = [];
      for (let s = 0; s < 40; s++) for (const st of C.generate(s, { constrained: true, temp: 1.3 }).steps) out.push({ p: st.p, q: st.q, mask: st.mask, chosen: st.chosen });
      return out;
    });
    expect(steps.length).toBeGreaterThan(300);
    for (const st of steps) {
      const sp = st.p.reduce((a: number, b: number) => a + b, 0);
      const sq = st.q.reduce((a: number, b: number) => a + b, 0);
      expect(Math.abs(sp - 1)).toBeLessThan(1e-12);
      expect(Math.abs(sq - 1)).toBeLessThan(1e-12);
      const allowed = st.p.reduce((a: number, x: number, i: number) => a + (st.mask[i] ? x : 0), 0);
      expect(allowed).toBeGreaterThan(0);
      st.q.forEach((q: number, i: number) => {
        if (!st.mask[i]) expect(q).toBe(0);
        else expect(Math.abs(q - st.p[i] / allowed)).toBeLessThan(1e-12);     // renormalised: q = p / Σ allowed p
      });
      expect(st.mask[st.chosen]).toBe(true);                                   // the sampler never picks a masked token
    }
  });

  test('p is the softmax of the logits at the chosen temperature', async ({ page }) => {
    await page.goto(URL);
    const r = await page.evaluate(() => {
      const C = (window as any).__cd;
      const logits = C.logitsAt([], 11);
      return { logits, g: [0.5, 1, 2].map((temp) => C.generate(11, { temp, constrained: false }).steps[0].p) };
    });
    const soft = (T: number) => { const e = r.logits.map((l: number) => Math.exp(l / T)); const S = e.reduce((a: number, b: number) => a + b, 0); return e.map((x: number) => x / S); };
    const H = (p: number[]) => -p.reduce((a, x) => a + (x > 0 ? x * Math.log(x) : 0), 0);
    [0.5, 1, 2].forEach((T, k) => r.g[k].forEach((p: number, i: number) => expect(Math.abs(p - soft(T)[i])).toBeLessThan(1e-12)));
    expect(H(r.g[0])).toBeLessThan(H(r.g[1]));                                    // lower temperature is sharper
    expect(H(r.g[1])).toBeLessThan(H(r.g[2]));
  });

  test('the grammar mask at known positions', async ({ page }) => {
    await page.goto(URL);
    const A = (toks: string[]) => page.evaluate((t) => (window as any).__cd.allowed(t), toks);
    expect(await A([])).toEqual(['{']);
    expect(await A(['{'])).toEqual(['"name"', '"age"', '"tags"']);                         // not "email", not } yet
    expect(await A(['{', '"name"'])).toEqual([':']);
    expect(await A(['{', '"name"', ':'])).toEqual(['"Ada"', '"Grace"', '"Alan"', '"qa"', '"ml"', '"ops"']);
    expect(await A(['{', '"age"', ':'])).toEqual(['0', '7', '36', '42']);                   // no -1, no 3.5, no strings
    expect(await A(['{', '"name"', ':', '"Ada"'])).toEqual([',']);                           // age is required, so no }
    expect(await A(['{', '"name"', ':', '"Ada"', ',', '"age"', ':', '42'])).toEqual(['}', ',']);     // vocabulary order
    expect(await A(['{', '"name"', ':', '"Ada"', ','])).toEqual(['"age"', '"tags"']);        // no repeated key
    const tags3 = ['{', '"tags"', ':', '[', '"qa"', ',', '"ml"', ',', '"ops"'];
    expect(await A(tags3)).toEqual([']']);                                                     // maxItems 3
    expect(await A(['{', '"tags"', ':', '['])).toEqual([']', '"Ada"', '"Grace"', '"Alan"', '"qa"', '"ml"', '"ops"']);
    const full = ['{', '"name"', ':', '"Ada"', ',', '"age"', ':', '42', ',', '"tags"', ':', '[', ']', '}'];
    expect(await A(full)).toEqual(['<eos>']);
    expect(await A(['{', '}'])).toEqual([]);                                                   // off the grammar: nothing can fix it
  });

  test('unconstrained output is often invalid, constrained never; the 200-seed batch agrees', async ({ page }) => {
    await page.goto(URL);
    const r = await page.evaluate(() => {
      const C = (window as any).__cd;
      let bad = 0; const kinds = new Set<string>();
      for (let s = 0; s < 200; s++) {
        const g = C.generate(s, { constrained: false, temp: 1 });
        let ok = false;
        try { const v = JSON.parse(g.text); ok = g.schemaOk; if (!ok) kinds.add('schema'); void v; } catch { kinds.add('parse'); }
        if (!ok) bad++;
      }
      return { bad, kinds: [...kinds] };
    });
    expect(r.bad).toBeGreaterThanOrEqual(60);             // well over a quarter of runs break
    expect(r.kinds.sort()).toEqual(['parse', 'schema']);  // both kinds of failure happen
    await page.getByTestId('batch').click();
    await expect(page.getByTestId('batch-con')).toHaveText('200/200');
    await expect(page.getByTestId('batch-free')).toHaveText(`${200 - r.bad}/200`);
  });

  test('stepping through: the chosen token is highlighted, masked rows are greyed, and the sums read 1', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('reset').click();
    await expect(page.getByTestId('tok')).toHaveCount(0);
    await expect(page.getByTestId('view-label')).toHaveText('Upcoming: token 1');
    // before the first token only { is allowed: 25 rows are masked
    await expect(page.getByTestId('n-masked')).toHaveText('25');
    await expect(page.locator('[data-masked="false"]')).toHaveCount(1);
    await expect(page.getByTestId('row-0')).toHaveAttribute('data-masked', 'false');
    await expect(page.getByTestId('q-0')).toContainText('→ 1.000');
    await page.getByTestId('step').click();
    await expect(page.getByTestId('tok')).toHaveText(['{']);
    await expect(page.getByTestId('view-label')).toHaveText('Step 1: chose {');
    await expect(page.locator('tr.chosen')).toHaveAttribute('data-testid', 'row-0');
    await page.getByTestId('step').click();
    const s = await cd(page);
    expect(s.tokens).toHaveLength(2);
    expect(['"name"', '"age"', '"tags"']).toContain(s.tokens[1]);
    await expect(page.getByTestId('n-masked')).toHaveText('23');
    await expect(page.getByTestId('sum-p')).toHaveText('1.000');
    await expect(page.getByTestId('sum-q')).toHaveText('1.000');
    const allowed = s.view.p.reduce((a: number, x: number, i: number) => a + (s.view.mask[i] ? x : 0), 0);
    await expect(page.getByTestId('sum-allowed')).toHaveText(allowed.toFixed(3));
    await expect(page.getByTestId('stage')).toContainText('Expecting a colon');
    // masked rows show q = 0
    const masked = await page.locator('[data-masked="true"] [data-testid^="q-"]').allTextContents();
    expect(masked.length).toBe(23);
    for (const t of masked) expect(t).toMatch(/→ 0$/);
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-ok', 'true');
    await expect(page.getByTestId('verdict')).toContainText('✓ JSON.parse succeeds · ✓ matches the schema');
    await expect(page.getByTestId('tok-eos')).toBeVisible();
    await expect(page.getByTestId('step')).toBeDisabled();
    await expect(page.getByTestId('reset')).toBeFocused();
    expect(matchesSchema(JSON.parse((await cd(page)).text))).toBe(true);
  });

  test('unconstrained in the UI: nothing is masked, and a broken run is marked where it went wrong', async ({ page }) => {
    await page.goto(URL);
    // find a seed whose unconstrained sample fails to parse, then replay it through the buttons
    const seed = await page.evaluate(() => { const C = (window as any).__cd; let s = 0; const broken = (g: any) => !g.parses && g.steps.some((st: any) => st.stage === 'error'); while (!broken(C.generate(s, { constrained: false }))) s++; return s; });
    await page.getByTestId('seed').fill(String(seed));
    await page.getByTestId('seed').press('Enter');
    await page.getByTestId('mode-free').click();
    await expect(page.getByTestId('mode-free')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n-masked')).toHaveText('0');
    await page.getByTestId('step').click();
    const v = (await cd(page)).view;
    expect(v.q).toEqual(v.p);
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-ok', 'false');
    await expect(page.getByTestId('verdict')).toContainText('✗ JSON.parse fails');
    await expect(page.getByTestId('tok-bad')).toHaveCount(1);
    await expect(page.getByTestId('stage')).toContainText('Off the grammar');
    const text = (await cd(page)).text;
    const expected = await page.evaluate((s) => (window as any).__cd.generate(s, { constrained: false }).text, seed);
    expect(text).toBe(expected);                            // stepping by hand = generate() in one go
    await expect(page.getByTestId('cmp-free')).toHaveText(expected);
    await expect(page.getByTestId('cmp-con-verdict')).toHaveAttribute('data-ok', 'true');
  });

  test('seeded and deterministic; both modes see the same first distribution; argmax takes the top q', async ({ page }) => {
    await page.goto(URL);
    expect((await cd(page)).seed).toBe(7);
    const r = await page.evaluate(() => {
      const C = (window as any).__cd;
      const a = C.generate(5, { temp: 1.2 }), b = C.generate(5, { temp: 1.2 });
      const f = C.generate(5, { temp: 1.2, constrained: false });
      const texts = [1, 2, 3, 4, 5, 6].map((s) => C.generate(s, { temp: 1.2 }).text);
      const greedy = C.generate(9, { greedy: true });
      return { same: JSON.stringify(a) === JSON.stringify(b), p0: [a.steps[0].p, f.steps[0].p], texts, greedy: greedy.steps.map((s: any) => [s.chosen, s.q]) };
    });
    expect(r.same).toBe(true);
    expect(r.p0[0]).toEqual(r.p0[1]);
    expect(new Set(r.texts).size).toBeGreaterThan(3);
    for (const [chosen, q] of r.greedy) expect(q[chosen]).toBe(Math.max(...q));
    // the page's own run for seed 7 matches generate(7) once finished
    await page.getByTestId('finish').click();
    const want = await page.evaluate(() => (window as any).__cd.generate(7, {}).text);
    expect((await cd(page)).text).toBe(want);
  });

  test('controls: temperature and argmax are labelled and reset the run', async ({ page }) => {
    await page.goto(URL);
    await page.getByLabel(/Temperature/).fill('0.5');
    await expect(page.getByTestId('temp-out')).toHaveText('0.5');
    let s = await cd(page);
    expect(s.temp).toBe(0.5);
    expect(s.tokens).toEqual([]);
    await page.getByTestId('dec-greedy').click();
    await expect(page.getByTestId('dec-greedy')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('finish').click();
    s = await cd(page);
    expect(s.greedy).toBe(true);
    const want = await page.evaluate(() => (window as any).__cd.generate(7, { greedy: true, temp: 0.5 }).text);
    expect(s.text).toBe(want);
    await expect(page.getByTestId('cmp-con')).toHaveText(want);
  });
});
