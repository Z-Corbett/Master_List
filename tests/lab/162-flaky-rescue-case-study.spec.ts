import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PAGE = '/lab/162-flaky-rescue-case-study.html';
const CASES = ['pinball', 'candles', 'pixel'] as const;
type Case = (typeof CASES)[number];

async function open(page: Page, query = '') {
  await page.clock.install({ time: new Date('2026-09-27T09:00:00') });
  await page.goto(PAGE + query);
}

/** Sets the toggles, runs the reproduction and lets the page clock play the whole animation. Returns the verdict text. */
async function reproduce(page: Page, id: Case, slow: boolean, mode: 'before' | 'after') {
  await page.getByTestId(`slow-${id}`).setChecked(slow);
  await page.getByTestId(`${mode}-${id}`).check();
  await page.getByTestId(`run-${id}`).click();
  const steps = await page.evaluate((i) => (window as any).__rescue.state.last[i].log.length, id);
  const stepMs = await page.evaluate(() => (window as any).__rescue.stepMs);
  await page.clock.runFor(stepMs * (steps + 1));
  await expect(page.getByTestId(`verdict-${id}`)).not.toHaveText('Running…');
  return (await page.getByTestId(`verdict-${id}`).textContent())!;
}

// What each reproduction's log must show when the race is lost (before the fix, slow browser).
const LOST: Record<Case, RegExp> = {
  pinball: /keydown: e\.target is a BUTTON → ignored/,
  candles: /'close' event: light\(\) → litAt = 2 h/,
  pixel: /sees 'Saved locally' \(stale!\)[^]*reload: the pending write is thrown away/,
};

/** Before the fix fails and after it passes on a slow browser, three rounds running; on a fast browser both pass. */
async function beforeFailsAfterPasses(page: Page, id: Case) {
  await open(page);
  for (let round = 0; round < 3; round++) {
    expect(await reproduce(page, id, true, 'before')).toMatch(/^FAIL · before the fix, slow browser\./);
    await expect(page.getByTestId(`log-${id}`)).toContainText(LOST[id]);
    await expect(page.getByTestId(`log-${id}`).locator('li.bad').first()).toBeVisible();
    expect(await reproduce(page, id, true, 'after')).toMatch(/^PASS · after the fix, slow browser\./);
    await expect(page.getByTestId(`log-${id}`).locator('li.bad')).toHaveCount(0);
  }
  // it is a race, not a constant failure: on a fast browser the old code wins it
  expect(await reproduce(page, id, false, 'before')).toMatch(/^PASS · before the fix, fast browser\./);
  expect(await reproduce(page, id, false, 'after')).toMatch(/^PASS · after the fix, fast browser\./);
}

test.describe('162 Flaky Test Rescue case study', () => {
  test('Prairie Pinball: the focus race fails before the fix and passes after it, every time, under page.clock', async ({ page }) => {
    await beforeFailsAfterPasses(page, 'pinball');
  });

  test('Chapel Candles: the close-event race fails before the fix and passes after it, every time, under page.clock', async ({ page }) => {
    await beforeFailsAfterPasses(page, 'candles');
  });

  test('Pixel Press: the stale "Saved locally" race fails before the fix and passes after it, every time, under page.clock', async ({ page }) => {
    await beforeFailsAfterPasses(page, 'pixel');
  });

  test('the models agree with the page: the fix passes at every load, the old code fails once the browser is slow enough', async ({ page }) => {
    await page.goto(PAGE);
    for (const id of CASES) {
      const res = await page.evaluate((i) => {
        const r = (window as any).__rescue;
        const out: { load: number; before: boolean; after: boolean }[] = [];
        for (let k = 0; k <= 20; k++) out.push({ load: k / 20, before: r.run(i, k / 20, false).pass, after: r.run(i, k / 20, true).pass });
        return out;
      }, id);
      expect(res.every((x) => x.after), `${id}: after passes at every load`).toBe(true);
      expect(res[0].before, `${id}: before passes when fast`).toBe(true);
      expect(res[20].before, `${id}: before fails when slow`).toBe(false);
      // monotonic: once slow enough to fail, slower still fails
      const firstFail = res.findIndex((x) => !x.before);
      expect(res.slice(firstFail).every((x) => !x.before), `${id}: failures are monotonic in load`).toBe(true);
    }
  });

  test('"Run 20× with random load" is seeded: the old code fails some runs, the fix none, and the same seed repeats exactly', async ({ page }) => {
    await open(page, '?seed=7');
    const counts: Record<string, string> = {};
    for (const id of CASES) {
      await page.getByTestId(`before-${id}`).check();
      await page.getByTestId(`batch-${id}`).click();
      const txt = (await page.getByTestId(`batchout-${id}`).textContent())!;
      const m = txt.match(/^20 runs with random load, before the fix: (\d+) failed, (\d+) passed\.$/)!;
      expect(m, txt).not.toBeNull();
      expect(Number(m[1]) + Number(m[2])).toBe(20);
      expect(Number(m[1]), `${id} has some failures`).toBeGreaterThan(0);
      expect(Number(m[1]), `${id} is flaky, not broken`).toBeLessThan(20);
      counts[id] = txt;
      await page.getByTestId(`after-${id}`).check();
      await page.getByTestId(`batch-${id}`).click();
      await expect(page.getByTestId(`batchout-${id}`)).toHaveText('20 runs with random load, after the fix: 0 failed, 20 passed.');
    }
    await page.reload();
    for (const id of CASES) {
      await page.getByTestId(`before-${id}`).check();
      await page.getByTestId(`batch-${id}`).click();
      await expect(page.getByTestId(`batchout-${id}`)).toHaveText(counts[id]);
    }
  });

  test('every code excerpt matches the repo: added and context lines are in the current files, removed lines are gone', async ({ page }) => {
    await page.goto(PAGE);
    const lines = await page.locator('.ln[data-file]').evaluateAll((els) => els.map((e) => ({ file: (e as HTMLElement).dataset.file!, kind: e.classList.contains('del') ? 'del' : e.classList.contains('add') ? 'add' : 'ctx', text: e.textContent! })));
    expect(lines.length).toBeGreaterThan(40);
    const files = new Set(lines.map((l) => l.file));
    expect([...files].sort()).toEqual(['lab/032-pixel-press.html', 'lab/061-chapel-candles.html', 'lab/079-prairie-pinball.html', 'playwright.config.ts', 'tests/lab/032-pixel-press.spec.ts', 'tests/lab/061-chapel-candles.spec.ts', 'tests/lab/079-prairie-pinball.spec.ts']);
    const src: Record<string, string[]> = {};
    for (const f of files) src[f] = readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim());
    for (const l of lines) {
      const present = src[l.file].includes(l.text.trim());
      expect(present, `${l.kind} line in ${l.file}: ${l.text.trim()}`).toBe(l.kind !== 'del');
    }
    // the key lines of each fix, spelled out
    const has = (f: string, s: string) => expect(readFileSync(f, 'utf8'), `${f} contains ${s}`).toContain(s);
    has('playwright.config.ts', 'failOnFlakyTests: !!process.env.CI');
    has('lab/079-prairie-pinball.html', "if (document.activeElement && document.activeElement.closest('.overlay')) cv.focus({ preventScroll: true });");
    has('lab/061-chapel-candles.html', "if (e.submitter && e.submitter.value === 'light' && pending != null) light(pending, $('intent').value.trim());");
    has('lab/032-pixel-press.html', "addEventListener('pagehide', () => { if (saveT) writeNow(); });");
  });

  test('each case names its commit, links its page, and describes the symptom, root cause and guard', async ({ page }) => {
    await page.goto(PAGE);
    const expectCase = async (id: string, commit: string, href: string, words: RegExp[]) => {
      const c = page.getByTestId(id);
      await expect(c.locator('.meta')).toContainText(`commit ${commit}`);
      await expect(c.locator(`a[href="${href}"]`)).toBeVisible();
      for (const h of ['What CI showed', 'Reproduce it', 'The root cause', 'Before and after', 'The regression test that guards it']) await expect(c.getByRole('heading', { name: h })).toBeVisible();
      for (const w of words) await expect(c).toContainText(w);
    };
    await expectCase('case-pinball', '12b4f6b', '079-prairie-pinball.html', [/hidden button/, /fixes it up a little later/]);
    await expectCase('case-candles', '12b4f6b', '061-chapel-candles.html', [/queued to fire as a later task/, /submit/]);
    await expectCase('case-pixel', '3ebfb98', '032-pixel-press.html', [/Saving…/, /pagehide/, /stale/]);
    await expect(page.getByTestId('gate')).toContainText('commit 12b4f6b');
    await expect(page.locator('header')).toContainText('five runs in a row');
    // the regression tests the page cites exist under those names
    expect(readFileSync('tests/lab/079-prairie-pinball.spec.ts', 'utf8')).toContain("test('the plunger: a longer pull launches harder, and ball save starts'");
    expect(readFileSync('tests/lab/061-chapel-candles.spec.ts', 'utf8')).toContain("test('extinguishing freezes the wax; relighting carries on from where it stopped'");

    // "What CI showed" quotes the real GitHub Actions output, and every test it names exists in the repo
    const specs: Record<string, string> = { pinball: '079-prairie-pinball', candles: '061-chapel-candles', pixel: '032-pixel-press' };
    for (const [id, file] of Object.entries(specs)) {
      const src = readFileSync(`tests/lab/${file}.spec.ts`, 'utf8');
      const named = await page.getByTestId(`ci-${id}`).locator('p b').allTextContents();
      expect(named.length, id).toBeGreaterThan(0);
      for (const n of named) expect(src, `${file} has a test named ${n}`).toContain(`test('${n.replace(/^"|"$/g, '').replace(/…$/, '')}`);
      await expect(page.getByTestId(`ci-${id}`).locator('.src')).toContainText('GitHub Actions logs, quoted verbatim');
    }
    await expect(page.getByTestId('ci-candles').locator('pre.ci')).toHaveText('Error: expect(locator).toContainText(expected) failed\nLocator: getByTestId(\'d-meta\')\nExpected substring: "75% of the wax remains"\nReceived string:    "Lit just now · about 8 h 00 min left · 100% of the wax remains"');
    await expect(page.getByTestId('ci-pinball').locator('pre.ci').first()).toHaveText('Error: expect(received).toBeLessThan(expected)\nExpected: < -800\nReceived:   0');
    await expect(page.getByTestId('ci-pixel').locator('pre.ci')).toHaveText('Error: expect(received).toBe(expected) // Object.is equality\nExpected: "#c2185b"\nReceived: null');
    await expect(page.getByTestId('ci-summary')).toHaveText('3 flaky / 521 passed\n2 flaky / 4 skipped / 518 passed');
    // the quoted pinball failure matches the spec's own check: toBeLessThan(soft - 800)
    expect(readFileSync('tests/lab/079-prairie-pinball.spec.ts', 'utf8')).toContain('expect(hard).toBeLessThan(soft - 800);');
  });

  test('the process section and the CTA point to the Flaky Test Rescue package', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.getByTestId('process').getByRole('heading', { name: 'How I run a Flaky Test Rescue' })).toBeVisible();
    await expect(page.getByTestId('process').locator('ol.steps > li')).toHaveCount(5);
    const cta = page.getByTestId('cta');
    await expect(cta).toContainText('Flaky Test Rescue ($750)');
    await expect(cta.locator('li')).toHaveText(['Up to 10 flaky tests root-caused and fixed', 'CI set to fail on flakes, not hide them', 'A written report of every cause found']);
    await expect(page.getByTestId('cta-link')).toHaveAttribute('href', '../index.html#services');
    await page.getByTestId('cta-link').click();
    await expect(page).toHaveURL(/\/index\.html#services$/);
  });

  test('the reproductions work from the keyboard, and the verdict is announced', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard operation is checked on desktop');
    await open(page);
    await page.getByTestId('slow-candles').focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('slow-candles')).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('before-candles')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('after-candles')).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('run-candles')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.clock.runFor(5000);
    await expect(page.getByTestId('verdict-candles')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('verdict-candles')).toHaveText(/^PASS · after the fix, slow browser\./);
  });
});
