import { test, expect, Page } from '@playwright/test';

const URL = '/lab/102-auto-wait-lab.html';
const hook = <T = any>(page: Page, key: string) => page.evaluate((k) => (window as any).__autowait[k], key) as Promise<T>;

// ---- independent oracle: the seeded generator and the three strategies, re-derived from the page's stated rules ----
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Run = { attached: number; visible: number; stable: number; enabled: number; receives: number; response: number; actionable: number; slow: boolean };
function runs(seed: number, n: number, slowPct: number): Run[] {
  const r = mulberry32(seed >>> 0), out: Run[] = [];
  for (let i = 0; i < n; i++) {
    const slow = r() < slowPct / 100, f = slow ? 3 : 1;
    const attached = Math.round((100 + 500 * r()) * f);
    const visible = attached + Math.round(300 * r() * f);
    const stable = visible + Math.round((150 + 350 * r()) * f);
    const enabled = attached + Math.round((200 + 1200 * r()) * f);
    const ovOn = r() < 0.5, ov = Math.round(1200 * r() * f);
    const receives = ovOn ? Math.max(attached, ov) : attached;
    const cached = r() < 0.3, rr = Math.round((100 + 800 * r()) * f);
    const response = cached ? 0 : rr;
    out.push({ attached, visible, stable, enabled, receives, response, slow, actionable: Math.max(attached, visible, stable, enabled, receives) });
  }
  return out;
}
type Cfg = { sleep: number; poll: number; timeout: number };
function oracle(rs: Run[], c: Cfg) {
  const t = { sleep: { passed: 0, wait: 0 }, poll: { passed: 0, wait: 0 }, web: { passed: 0, wait: 0 } };
  for (const r of rs) {
    // A: blind click after S, one read after another S
    t.sleep.wait += 2 * c.sleep;
    if (r.actionable <= c.sleep && r.response <= c.sleep) t.sleep.passed++;
    // polls happen at 0, P, 2P, ... and the last one allowed is at or before the timeout
    const click = Math.ceil(r.actionable / c.poll) * c.poll;
    if (click > c.timeout) { t.poll.wait += c.timeout; t.web.wait += c.timeout; continue; }
    t.poll.wait += click;
    if (r.response === 0) t.poll.passed++;
    const k = Math.ceil(r.response / c.poll) * c.poll;
    if (k <= c.timeout) { t.web.passed++; t.web.wait += click + k; } else t.web.wait += click + c.timeout;
  }
  return t;
}
const fmtS = (ms: number) => (ms / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s';
const pct = (p: number, n: number) => ((p / n) * 100).toFixed(1) + '%';

test.describe('102 Auto-Wait Lab', () => {
  test('seeded timings: the page draws exactly the runs the spec regenerates, and ?seed changes them', async ({ page }) => {
    await page.goto(`${URL}?seed=7`);
    await expect(page.getByTestId('seed')).toHaveValue('7');
    const got = await hook<any[]>(page, 'runs');
    const want = runs(7, 200, 15);
    expect(got.length).toBe(200);
    got.forEach((g, i) => {
      for (const k of ['attached', 'visible', 'stable', 'enabled', 'receives', 'response', 'actionable', 'slow'] as const) expect(g[k], `run ${i + 1} ${k}`).toBe(want[i][k]);
      // ordering the model promises: shown after attached, settled after shown
      expect(g.visible).toBeGreaterThanOrEqual(g.attached);
      expect(g.stable).toBeGreaterThanOrEqual(g.visible);
    });
    // roughly 15% slow runs and 30% cached responses (binomial, generous bounds)
    const slow = got.filter((r) => r.slow).length, cached = got.filter((r) => r.response === 0).length;
    expect(slow).toBeGreaterThan(12); expect(slow).toBeLessThan(50);
    expect(cached).toBeGreaterThan(35); expect(cached).toBeLessThan(90);
    await page.goto(`${URL}?seed=8`);
    expect(JSON.stringify(await hook(page, 'runs'))).not.toBe(JSON.stringify(got));
  });

  test('results table matches the oracle for all three strategies (default settings)', async ({ page }) => {
    await page.goto(`${URL}?seed=1`);
    const want = oracle(runs(1, 200, 15), { sleep: 1000, poll: 100, timeout: 5000 });
    for (const id of ['sleep', 'poll', 'web'] as const) {
      await expect(page.getByTestId(`passed-${id}`)).toHaveText(String(want[id].passed));
      await expect(page.getByTestId(`rate-${id}`)).toHaveText(pct(want[id].passed, 200));
      await expect(page.getByTestId(`wait-${id}`)).toHaveText(fmtS(want[id].wait));
      await expect(page.getByTestId(`bar-rate-${id}`)).toHaveText(pct(want[id].passed, 200));
    }
    // the lesson of the page holds for this seed: sleep is flaky, web-first is not, one-shot is the worst
    expect(want.sleep.passed).toBeLessThan(200);
    expect(want.web.passed).toBeGreaterThan(want.sleep.passed);
    expect(want.poll.passed).toBeLessThan(want.sleep.passed);
    await expect(page.getByTestId('summary')).toContainText(`sleep(1000) passed ${want.sleep.passed}`);
  });

  test('sleep always costs exactly 2·S per run, and a longer sleep never passes fewer runs', async ({ page }) => {
    await page.goto(`${URL}?seed=3`);
    await page.getByTestId('runs').fill('150');
    const rs = runs(3, 150, 15);
    let prev = -1;
    for (const S of [0, 250, 800, 1600, 3000, 6000]) {
      await page.getByTestId('sleep').fill(String(S));
      await expect(page.getByTestId('wait-sleep')).toHaveText(fmtS(2 * S * 150));
      const passed = Number(await page.getByTestId('passed-sleep').textContent());
      expect(passed).toBe(oracle(rs, { sleep: S, poll: 100, timeout: 5000 }).sleep.passed);
      expect(passed).toBeGreaterThanOrEqual(prev);
      prev = passed;
    }
    expect(prev).toBe(150);                                 // 6 s beats even the slowest simulated run
    // S = 0 passes nothing: every button takes at least 100 ms to attach
    await page.getByTestId('sleep').fill('0');
    await expect(page.getByTestId('passed-sleep')).toHaveText('0');
  });

  test('auto-wait clicks on the first poll after the element becomes actionable (never early, never a full interval late)', async ({ page }) => {
    await page.goto(`${URL}?seed=11`);
    for (const P of [100, 37, 250]) {
      await page.getByTestId('poll').fill(String(P));
      await expect.poll(() => hook<any>(page, 'cfg').then((c) => c.poll)).toBe(P);
      const [rs, per] = await Promise.all([hook<any[]>(page, 'runs'), hook<any[]>(page, 'per')]);
      rs.forEach((r, i) => {
        const b = per[i].B;
        if (b.clickAt === null) return;
        expect(b.clickAt % P).toBe(0);
        expect(b.clickAt).toBeGreaterThanOrEqual(r.actionable);
        expect(b.clickAt - r.actionable).toBeLessThan(P);
        // B passes exactly when the receipt was already there
        expect(b.pass).toBe(r.response === 0);
      });
    }
  });

  test('a short timeout turns slow runs into failures, and each failure names the check it was stuck on', async ({ page }) => {
    await page.goto(`${URL}?seed=5`);
    await page.getByTestId('timeout').fill('800');
    const rs = runs(5, 200, 15);
    const want = oracle(rs, { sleep: 1000, poll: 100, timeout: 800 });
    await expect(page.getByTestId('passed-web')).toHaveText(String(want.web.passed));
    await expect(page.getByTestId('wait-web')).toHaveText(fmtS(want.web.wait));
    expect(want.web.passed).toBeLessThan(200);
    const per = await hook<any[]>(page, 'per');
    const checks = ['attached', 'visible', 'stable', 'enabled', 'receives'] as const;
    const label: Record<string, string> = { attached: 'attached', visible: 'visible', stable: 'stable', enabled: 'enabled', receives: 'receives events' };
    let timeouts = 0;
    rs.forEach((r, i) => {
      if (Math.ceil(r.actionable / 100) * 100 <= 800) return;
      timeouts++;
      const stuck = checks.find((c) => r[c] > 800)!;           // last poll at 800 ms
      expect(per[i].C.reason).toBe(`timed out after 800 ms waiting for ${label[stuck]}`);
      expect(per[i].C.wait).toBe(800);
    });
    expect(timeouts).toBeGreaterThan(0);
  });

  test('changing N keeps earlier runs identical (each run consumes a fixed number of draws)', async ({ page }) => {
    await page.goto(`${URL}?seed=21`);
    const before = await hook<any[]>(page, 'runs');
    await page.getByTestId('runs').fill('500');
    await expect(page.getByTestId('res-meta')).toContainText('500 runs');
    const after = await hook<any[]>(page, 'runs');
    expect(after.slice(0, 200)).toEqual(before);
    // out-of-range input is clamped
    await page.getByTestId('runs').fill('99999');
    await expect(page.getByTestId('res-meta')).toContainText('2000 runs');
    // New seed steps the seed and redraws
    await page.getByTestId('reseed').click();
    await expect(page.getByTestId('seed')).toHaveValue('22');
    expect((await hook<any[]>(page, 'runs'))[0].attached).toBe(runs(22, 1, 15)[0].attached);
  });

  test('the sweep chart agrees with the table and with 2·S·N', async ({ page }) => {
    await page.goto(`${URL}?seed=7`);
    const sw = await hook<any[]>(page, 'sweep');
    expect(sw.length).toBe(41);
    const rs = runs(7, 200, 15);
    for (const p of sw) {
      expect(p.wait).toBe(2 * p.S * 200);
      expect(p.rate).toBeCloseTo(oracle(rs, { sleep: p.S, poll: 100, timeout: 5000 }).sleep.passed / 200, 10);
    }
    const at1000 = sw.find((p) => p.S === 1000);
    await expect(page.getByTestId('rate-sleep')).toHaveText((at1000.rate * 100).toFixed(1) + '%');
    await expect(page.getByTestId('sweep')).toHaveAttribute('aria-label', new RegExp(`${(at1000.rate * 100).toFixed(1)}% at 1000 ms`));
    await expect(page.getByTestId('sweep-now')).toHaveCount(1);
  });

  test('replay under page.clock: each actionability check flips exactly at its time', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-01T12:00:00Z') });
    await page.goto(`${URL}?seed=7`);
    await page.clock.pauseAt(new Date("2026-09-01T12:00:05Z"));
    // pick a run that has an overlay and a real response, so every check has a distinct moment
    const rs = runs(7, 200, 15);
    const idx = rs.findIndex((r) => r.receives > r.attached + 100 && r.response > 0 && r.actionable < 2500);
    expect(idx).toBeGreaterThanOrEqual(0);
    const run = rs[idx];
    await page.getByTestId('pick').fill(String(idx + 1));
    await expect(page.getByTestId('t-attached')).toHaveText(`${run.attached} ms`);
    await page.getByTestId('replay').click();
    await expect(page.getByTestId('pay')).toHaveCount(0);           // t = 0: not attached yet
    const checks = ['attached', 'visible', 'stable', 'enabled', 'receives'] as const;
    for (const at of [run.attached - 30, run.receives + 30, run.actionable + 30]) {
      const now = (await hook<any>(page, 'replay')).elapsed;
      await page.clock.runFor(at - now);
      const t = (await hook<any>(page, 'replay')).elapsed;
      for (const c of checks) await expect(page.getByTestId(`chk-${c}`)).toHaveAttribute('data-ok', String(t >= run[c]));
      await expect(page.getByTestId('pay')).toHaveCount(t >= run.attached ? 1 : 0);
      await expect(page.getByTestId('overlay')).toBeVisible({ visible: t < run.receives });
      if (t >= run.attached) {
        if (t >= run.enabled) await expect(page.getByTestId('pay')).toBeEnabled(); else await expect(page.getByTestId('pay')).toBeDisabled();
      }
    }
  });

  test('replay runs to the end and the lanes report the same verdicts as the table', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-01T12:00:00Z') });
    await page.goto(`${URL}?seed=7`);
    await page.clock.pauseAt(new Date("2026-09-01T12:00:05Z"));
    await page.getByTestId('pick').fill('4');
    const per = (await hook<any[]>(page, 'per'))[3];
    await page.getByTestId('replay').click();
    await expect(page.getByTestId('stop')).toBeEnabled();
    const end = (await hook<any>(page, 'replay')).end;
    await page.clock.runFor(end + 100);
    expect((await hook<any>(page, 'replay')).running).toBe(false);
    await expect(page.getByTestId('replay-status')).toContainText('finished');
    await expect(page.getByTestId('stop')).toBeDisabled();
    for (const [k, id] of [['A', 'sleep'], ['B', 'poll'], ['C', 'web']] as const) {
      await expect(page.getByTestId(`lane-${id}`)).toHaveAttribute('data-verdict', per[k].pass ? 'pass' : 'fail');
      await expect(page.getByTestId(`verdict-${id}`)).toHaveText(`${per[k].pass ? 'PASS' : 'FAIL'}: ${per[k].reason}`);
    }
    // the receipt toast is shown once C has clicked and the response arrived
    await expect(page.getByTestId('toast')).toBeVisible({ visible: per.C.clickAt !== null });
  });

  test('stop halts the replay mid-way; controls are labelled and the explainer covers all five checks', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-01T12:00:00Z') });
    await page.goto(`${URL}?seed=7`);
    await page.clock.pauseAt(new Date("2026-09-01T12:00:05Z"));
    await page.getByTestId('replay').click();
    await page.clock.runFor(200);
    await page.getByTestId('stop').click();
    const r1 = await hook<any>(page, 'replay');
    expect(r1.running).toBe(false);
    await page.clock.runFor(1000);
    expect((await hook<any>(page, 'replay')).elapsed).toBe(r1.elapsed);
    await expect(page.getByTestId('replay-status')).toHaveText(`Stopped at ${Math.round(r1.elapsed)} ms.`);
    await expect(page.getByTestId('replay')).toBeFocused();
    for (const name of ['Seed', 'Runs (N)', 'Slow runs (%)', 'sleep (ms)', 'Poll interval (ms)', 'Timeout (ms)', 'Run #']) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    await expect(page.getByTestId('summary')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('explain').locator('[data-check]')).toHaveCount(5);
    await expect(page.getByTestId('explain')).toContainText('opacity:0');
  });
});
