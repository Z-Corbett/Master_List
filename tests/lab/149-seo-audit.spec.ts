import { test, expect, Page, BrowserContext } from '@playwright/test';

const URL = '/lab/149-seo-audit.html';

// Severities as the page documents them, written out here so the tally below is the test's own.
const SEV: Record<string, 'error' | 'warning' | 'notice'> = {
  'title-present': 'error', 'title-single': 'warning', 'title-length': 'warning', 'desc-present': 'warning', 'desc-single': 'warning', 'desc-length': 'notice',
  'h1-one': 'notice', 'heading-order': 'notice', 'canonical-present': 'warning', 'canonical-absolute': 'warning', 'canonical-self': 'warning',
  'robots-noindex': 'error', 'robots-nofollow': 'warning', 'meta-refresh': 'warning', 'meta-keywords': 'notice', lang: 'warning', viewport: 'warning',
  'img-alt': 'warning', 'link-text': 'notice', 'link-empty': 'warning', 'hreflang-valid': 'error', 'hreflang-self': 'warning', 'hreflang-consistent': 'warning',
  'jsonld-parse': 'error', 'jsonld-type': 'warning', 'og-basics': 'notice', 'twitter-card': 'notice', 'mixed-content': 'error', 'render-blocking': 'warning', 'data-uri': 'notice',
};
const ALL = Object.keys(SEV);

// What was planted in each sample, and which checks can't apply to it.
const PLANTED: Record<string, { fail: string[]; na: string[] }> = {
  clean: { fail: [], na: [] },
  leftovers: {
    fail: ['title-length', 'h1-one', 'heading-order', 'canonical-absolute', 'canonical-self', 'robots-noindex', 'robots-nofollow', 'meta-refresh', 'meta-keywords', 'lang', 'viewport'],
    na: ['hreflang-valid', 'hreflang-self', 'hreflang-consistent'],
  },
  content: {
    fail: ['title-length', 'desc-present', 'img-alt', 'link-text', 'link-empty', 'hreflang-valid', 'hreflang-self', 'hreflang-consistent'],
    na: ['desc-single', 'desc-length', 'jsonld-parse', 'jsonld-type'],
  },
  tech: {
    fail: ['title-single', 'desc-single', 'jsonld-parse', 'jsonld-type', 'og-basics', 'twitter-card', 'mixed-content', 'render-blocking', 'data-uri'],
    na: ['hreflang-valid', 'hreflang-self', 'hreflang-consistent'],
  },
};

const rows = (page: Page) => page.getByTestId('check').evaluateAll((els) => els.map((e) => ({ id: (e as HTMLElement).dataset.id!, status: (e as HTMLElement).dataset.status!, sev: (e as HTMLElement).dataset.severity! })));

async function openSample(page: Page, key: string) {
  await page.goto(URL);
  await page.getByTestId('sample').selectOption(key);
  await expect(page.getByTestId('sample')).toHaveValue(key);
}

async function exportSpec(page: Page) {
  await page.getByTestId('export').click();
  await expect(page.getByTestId('export-box')).toBeVisible();
  const spec: string = await page.evaluate(() => (window as any).__audit.state.spec);
  await expect(page.getByTestId('spec')).toHaveText(spec);
  return spec;
}

// Runs a generated seo.spec.ts for real: the file (minus its import) is compiled as JavaScript, test()/describe()/beforeEach()
// are collected by small stand-ins, and every test body runs against a Playwright page whose PAGE_URL is served `html`.
async function runGenerated(context: BrowserContext, spec: string, pageUrl: string, html: string) {
  const collected: { name: string; fn: (a: { page: Page }) => Promise<void> }[] = [];
  let before: ((a: { page: Page }) => Promise<void>) | null = null;
  const t: any = (name: string, fn: any) => collected.push({ name, fn });
  t.describe = (_: string, fn: () => void) => fn();
  t.beforeEach = (fn: any) => { before = fn; };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const body = spec.replace(/^import .*$/m, '');
  await new AsyncFunction('test', 'expect', body)(t, expect.configure({ timeout: 1500 }));
  const target = await context.newPage();
  await target.route('**/*', (route) => (route.request().url() === pageUrl ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : route.abort()));
  const failed: string[] = [];
  for (const c of collected) {
    try { if (before) await before({ page: target }); await c.fn({ page: target }); } catch { failed.push(c.name.match(/\[([\w-]+)\]$/)![1]); }
  }
  await target.close();
  return { names: collected.map((c) => c.name), failed };
}

test.describe('149 SEO Audit', () => {
  test('the clean sample passes all 30 checks, and the tally says so', async ({ page }) => {
    await page.goto(URL);
    const r = await rows(page);
    expect(r.map((x) => x.id).sort()).toEqual([...ALL].sort());
    expect(r.every((x) => x.status === 'pass')).toBe(true);
    for (const x of r) expect(x.sev, x.id).toBe(SEV[x.id]);
    for (const [k, n] of [['error', 0], ['warning', 0], ['notice', 0], ['pass', 30], ['na', 0]] as const) await expect(page.getByTestId(`count-${k}`)).toHaveText(String(n));
    await expect(page.getByTestId('summary')).toHaveText('30 checks: 0 errors, 0 warnings, 0 notices, 30 passed, 0 not applicable.');
    // the svg <title> inside the basket icon is not mistaken for a second page title
    await expect(page.locator('[data-id="title-single"] .dt')).toHaveText('One <title>.');
  });

  // One explicit test() per sample (not a loop) so scripts/build-data.mjs can count them.
  const plantedSample = (key: string) => async ({ page }: { page: Page }) => {
      await openSample(page, key);
      const r = await rows(page);
      const failed = r.filter((x) => x.status === 'fail').map((x) => x.id).sort();
      expect(failed).toEqual([...PLANTED[key].fail].sort());
      expect(r.filter((x) => x.status === 'na').map((x) => x.id).sort()).toEqual([...PLANTED[key].na].sort());
      const want = { error: 0, warning: 0, notice: 0 };
      for (const id of PLANTED[key].fail) want[SEV[id]]++;
      for (const k of ['error', 'warning', 'notice'] as const) await expect(page.getByTestId(`count-${k}`)).toHaveText(String(want[k]));
      await expect(page.getByTestId('count-pass')).toHaveText(String(30 - PLANTED[key].fail.length - PLANTED[key].na.length));
      await expect(page.getByTestId('count-na')).toHaveText(String(PLANTED[key].na.length));
      // failed rows show a fix; the "problems only" filter shows exactly the failures
      await expect(page.locator('[data-testid="check"][data-status="fail"] .fx').first()).toBeVisible();
      await page.getByTestId('only-fail').check();
      await expect(page.getByTestId('check')).toHaveCount(PLANTED[key].fail.length);
  };
  test('sample "leftovers": every planted problem is detected, nothing else fails, and the severity counts match an independent tally', plantedSample('leftovers'));
  test('sample "content": every planted problem is detected, nothing else fails, and the severity counts match an independent tally', plantedSample('content'));
  test('sample "tech": every planted problem is detected, nothing else fails, and the severity counts match an independent tally', plantedSample('tech'));

  test('details name the actual problem: noindex, the UK region code, the broken JSON-LD block and the http subresources', async ({ page }) => {
    await openSample(page, 'leftovers');
    await expect(page.locator('[data-id="canonical-absolute"] .dt')).toHaveText('"/teas/sencha" is not absolute.');
    await expect(page.locator('[data-id="heading-order"] .dt')).toHaveText('Skips: h2 -> h4.');
    await expect(page.locator('[data-id="h1-one"] .dt')).toHaveText('2 h1 elements.');
    await expect(page.locator('[data-id="robots-noindex"] .badge')).toHaveText('error');
    await page.getByTestId('sample').selectOption('content');
    await expect(page.locator('[data-id="hreflang-valid"] .dt')).toHaveText('Invalid: en-UK (the UK region code is GB).');
    await expect(page.locator('[data-id="hreflang-consistent"] .dt')).toContainText('de → "/de/tees/" is relative; de points to 2 different URLs');
    await expect(page.locator('[data-id="link-text"] .dt')).toHaveText('Generic text: "click here", "read more".');
    await expect(page.locator('[data-id="img-alt"] .dt')).toHaveText('2 of 2 images have no alt attribute.');
    await expect(page.locator('[data-id="link-empty"] .dt')).toHaveText('1 link with no text: /basket.');
    await page.getByTestId('sample').selectOption('tech');
    await expect(page.locator('[data-id="jsonld-parse"] .dt')).toContainText('block 1:');
    await expect(page.locator('[data-id="jsonld-type"] .dt')).toHaveText('Block 2 lacks @context or @type.');
    await expect(page.locator('[data-id="mixed-content"] .dt')).toHaveText('http:// subresources: http://widgets.fernhill-tea.example/chat.js, http://images.fernhill-tea.example/gift-box.jpg.');
    await expect(page.locator('[data-id="render-blocking"] .dt')).toHaveText('Blocking: http://widgets.fernhill-tea.example/chat.js.');
    await expect(page.locator('[data-id="og-basics"] .dt')).toHaveText('Missing: og:image.');
    await expect(page.locator('[data-id="data-uri"] .dt')).toContainText('<img src>');
    // a data URI inside a <style> block counts too (12,022 characters ≈ 12 KB)
    const st = await page.evaluate((big) => (window as any).__audit.audit(`<style>body { background: url("${big}") }</style>`, '').find((r: any) => r.id === 'data-uri'), 'data:image/png;base64,' + 'A'.repeat(12000));
    expect([st.status, st.detail]).toEqual(['fail', '<style> 12 KB.']);
  });

  test('title length is judged by measured width (~600 px at 20 px Arial), not by characters', async ({ page }) => {
    await page.goto(URL);
    const titles = ['Teas', 'Roasted Oolong Loose-Leaf Tea | Fernhill Tea Co.', 'il'.repeat(40), 'MW'.repeat(20), 'Buy Japanese Sencha Green Tea Online: Steamed First-Flush Loose Leaf Sencha from Shizuoka'];
    const out = await page.evaluate((ts) => ts.map((t) => {
      const c = document.createElement('canvas').getContext('2d')!;
      c.font = '20px Arial, "Liberation Sans", "Helvetica Neue", Helvetica, sans-serif';
      const r = (window as any).__audit.audit(`<title>${t}</title>`, '').find((x: any) => x.id === 'title-length');
      return { t, w: c.measureText(t).width, status: r.status };
    }), titles);
    for (const o of out) expect(o.status, `${o.t} (${Math.round(o.w)} px)`).toBe(o.w >= 200 && o.w <= 600 ? 'pass' : 'fail');
    // 80 narrow characters fit, 40 wide ones don't: width, not length
    expect(out[2].t.length).toBe(80); expect(out[2].status).toBe('pass');
    expect(out[3].t.length).toBe(40); expect(out[3].status).toBe('fail');
  });

  test('export: one test( per passing check, balanced braces, valid JavaScript, and selectors that match the page', async ({ page }) => {
    await page.goto(URL);
    const spec = await exportSpec(page);
    await expect(page.locator('#ex-h')).toBeFocused();
    expect(spec.startsWith("import { test, expect } from '@playwright/test';\n")).toBe(true);
    expect(spec).toContain("const PAGE_URL = 'https://fernhill-tea.example/teas/oolong';");
    const tests = spec.match(/^\s*test\(\s*'/gm) || [];
    expect(tests).toHaveLength(30);
    for (const id of ALL) expect(spec, id).toContain(` [${id}]', async ({ page }) => {`);
    // braces and brackets balance once string literals are taken out
    const code = spec.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
    const count = (ch: string) => code.split(ch).length - 1;
    expect(count('{')).toBe(count('}'));
    expect(count('[')).toBe(count(']'));
    // the whole file (minus the import) compiles as JavaScript, so it has no TypeScript-only syntax to trip over
    expect(() => new Function(spec.replace(/^import .*$/m, ''))).not.toThrow();
    // every page.locator('…') selector is valid CSS, and each toHaveCount(n) is true of the sample's own HTML
    const html: string = await page.evaluate(() => (window as any).__audit.SAMPLES.clean.html);
    const unq = (s: string) => s.replace(/\\(.)/g, '$1');
    const sels = [...spec.matchAll(/page\.locator\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => unq(m[1]));
    expect(sels.length).toBeGreaterThan(10);
    const counts = [...spec.matchAll(/page\.locator\('((?:[^'\\]|\\.)*)'\)\)\.toHaveCount\((\d+)\)/g)].map((m) => [unq(m[1]), Number(m[2])] as [string, number]);
    expect(counts.length).toBeGreaterThanOrEqual(8);
    const res = await page.evaluate(([h, ss, cs]) => {
      const doc = new DOMParser().parseFromString(h as string, 'text/html');
      const invalid = (ss as string[]).filter((s) => { try { doc.querySelectorAll(s); return false; } catch { return true; } });
      const wrong = (cs as [string, number][]).filter(([s, n]) => doc.querySelectorAll(s).length !== n);
      return { invalid, wrong };
    }, [html, sels, counts] as const);
    expect(res).toEqual({ invalid: [], wrong: [] });
  });

  test('the exported spec really runs: all 30 generated tests pass against the page they were generated from', async ({ page, context }) => {
    await page.goto(URL);
    const spec = await exportSpec(page);
    const { url, html } = await page.evaluate(() => (window as any).__audit.SAMPLES.clean);
    const run = await runGenerated(context, spec, url, html);
    expect(run.names).toHaveLength(30);
    expect(run.failed).toEqual([]);
  });

  test('…and it catches regressions: break four things on the clean page and exactly those four generated tests fail', async ({ page, context }) => {
    await page.goto(URL);
    const spec = await exportSpec(page);
    const { url, html } = await page.evaluate(() => (window as any).__audit.SAMPLES.clean);
    const regressed = (html as string)
      .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex">')
      .replace(`<link rel="canonical" href="${url}">`, `<link rel="canonical" href="${url}?utm_source=newsletter">`)
      .replace(' alt="Dark, twisted oolong leaves in a ceramic dish"', '')
      .replace('<img src="/img/divider.svg" alt="">', '<img src="http://cdn.fernhill-tea.example/divider.svg" alt="">');
    expect(regressed).not.toBe(html);
    // the page's own audit agrees on what broke
    const audited = await page.evaluate(([h, u]) => (window as any).__audit.audit(h, u).filter((r: any) => r.status === 'fail').map((r: any) => r.id), [regressed, url]);
    const broke = ['robots-noindex', 'canonical-self', 'img-alt', 'mixed-content'];
    expect(audited.sort()).toEqual([...broke].sort());
    const run = await runGenerated(context, spec, url, regressed);
    expect(run.failed.sort()).toEqual([...broke].sort());
  });

  test('exporting a flawed page locks in only what passes today, and those tests pass on it', async ({ page, context }) => {
    // (not the "leftovers" sample: its meta refresh navigates away as soon as a real browser loads it)
    await openSample(page, 'content');
    const spec = await exportSpec(page);
    const passing = 30 - PLANTED.content.fail.length - PLANTED.content.na.length;
    expect(spec.match(/^\s*test\(\s*'/gm)).toHaveLength(passing);
    await expect(page.getByTestId('export-meta')).toContainText(`${passing} tests from ${passing} passing checks; ${30 - passing} failing or not-applicable checks left out`);
    for (const id of PLANTED.content.fail) expect(spec).not.toContain(`[${id}]'`);
    const { url, html } = await page.evaluate(() => (window as any).__audit.SAMPLES.content);
    const run = await runGenerated(context, spec, url, html);
    expect(run.names).toHaveLength(passing);
    expect(run.failed).toEqual([]);
  });

  test('download hands over seo.spec.ts with the same text, and the export follows edits', async ({ page }) => {
    await page.goto(URL);
    const spec = await exportSpec(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    expect(dl.suggestedFilename()).toBe('seo.spec.ts');
    const path = await dl.path();
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path!, 'utf8')).toBe(spec);
    await page.getByTestId('copy').click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied.' })).toBeVisible();
    // editing the HTML and re-running regenerates the export without the check that now fails
    const html = await page.getByTestId('html').inputValue();
    await page.getByTestId('html').fill(html.replace('<meta name="twitter:card" content="summary_large_image">', ''));
    await page.getByTestId('run').click();
    await expect(page.getByTestId('sample')).toHaveValue('custom');
    await expect(page.locator('[data-id="twitter-card"]')).toHaveAttribute('data-status', 'fail');
    await expect(page.getByTestId('spec')).not.toContainText('[twitter-card]');
    expect((await page.evaluate(() => (window as any).__audit.state.spec)).match(/^\s*test\(\s*'/gm)).toHaveLength(29);
  });

  test('own HTML: no page URL means the URL-based checks are not applicable, and an http page skips mixed content', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('sample').selectOption('custom');
    await page.getByTestId('url').fill('');
    await page.getByTestId('html').fill('<html lang="en"><head><title>Custom page for a quick check</title><link rel="canonical" href="https://a.example/x"><link rel="alternate" hreflang="en" href="https://a.example/x"></head><body><h1>Hi</h1></body></html>');
    await page.getByTestId('run').click();
    for (const id of ['canonical-self', 'hreflang-self', 'mixed-content']) await expect(page.locator(`[data-id="${id}"]`)).toHaveAttribute('data-status', 'na');
    await page.getByTestId('url').fill('http://a.example/x');
    await page.getByTestId('run').click();
    await expect(page.locator('[data-id="canonical-self"]')).toHaveAttribute('data-status', 'fail');
    await expect(page.locator('[data-id="hreflang-self"]')).toHaveAttribute('data-status', 'fail');
    await expect(page.locator('[data-id="mixed-content"]')).toHaveAttribute('data-status', 'na');
    await page.getByTestId('export').click();
    await expect(page.getByTestId('spec')).toContainText("const PAGE_URL = 'http://a.example/x';");
    await page.getByTestId('url').fill('');
    await page.getByTestId('export').click();
    await expect(page.getByTestId('spec')).toContainText("const PAGE_URL = process.env.SEO_URL || 'http://localhost:3000/';");
    await expect(page.getByTestId('summary')).toHaveAttribute('aria-live', 'polite');
  });
});
