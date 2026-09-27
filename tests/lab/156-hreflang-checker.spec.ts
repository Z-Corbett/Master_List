import { test, expect, Page } from '@playwright/test';

const URL_ = '/lab/156-hreflang-checker.html';
const KB = 'https://www.kestrelbikes.example';
const T = 'https://t.example';

type Issue = { level: string; kind: string; page: string | null; msg: string };
const check = (page: Page, text: string) => page.evaluate((t) => (window as any).__hreflang.check(t), text);
const kinds = (issues: Issue[], level?: string) => issues.filter((i) => !level || i.level === level).map((i) => i.kind);

/** Build HTML-mode input: page url -> [canonical|null, [[hreflang, href], ...]] */
function html(pages: Record<string, [string | null, [string, string][]]>) {
  return Object.entries(pages).map(([u, [canon, alts]]) => [`== ${u}`, ...(canon ? [`<link rel="canonical" href="${canon}">`] : []),
    ...alts.map(([c, h]) => `<link rel="alternate" hreflang="${c}" href="${h}">`)].join('\n')).join('\n\n');
}
/** A fully reciprocal cluster from [code, url] pairs, every page self-canonical. */
function cluster(set: [string, string][], tweak: (u: string, alts: [string, string][]) => [string, string][] = (_, a) => a) {
  const out: Record<string, [string | null, [string, string][]]> = {};
  for (const [, u] of set) if (!out[u]) out[u] = [u, tweak(u, set.map(([c, h]) => [c, h] as [string, string]))];
  return html(out);
}
const BASE: [string, string][] = [['en', `${T}/en/`], ['de', `${T}/de/`], ['fr', `${T}/fr/`], ['x-default', `${T}/en/`]];

test.describe('156 hreflang Checker', () => {
  test('the valid example is a clean cluster: no errors, no warnings, every cell two-way', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('ex-valid').click();
    await expect(page.getByTestId('status')).toContainText('Clean: 6 pages');
    await expect(page.getByTestId('count-errors')).toHaveText('0');
    await expect(page.getByTestId('count-warnings')).toHaveText('0');
    await expect(page.getByTestId('count-annotations')).toHaveText('36');
    const r = await page.evaluate(() => (window as any).__hreflang.result);
    expect(r.issues).toEqual([]);
    expect(r.clusters.length).toBe(1);
    const cells = page.getByTestId('matrix-0').locator('tbody td[data-row]');
    await expect(cells).toHaveCount(36);
    const states = await cells.evaluateAll((tds) => tds.map((td) => (td as HTMLElement).dataset.state));
    expect(states.filter((s) => s === 'self').length).toBe(6);
    expect(states.every((s) => s === 'self' || s === 'ok')).toBe(true);
    await expect(page.getByTestId('matrix-0').locator('td[data-col="x-default"][data-state="ok"]')).toHaveCount(6);
    // a hand-built clean cluster with script and region subtags also passes
    const clean = await check(page, cluster([['en-US', `${T}/us/`], ['en-GB', `${T}/uk/`], ['zh-Hant-TW', `${T}/tw/`], ['sr-Latn', `${T}/sr/`], ['x-default', `${T}/`]]));
    expect(clean.issues).toEqual([]);
  });

  test('the broken example: every planted error class is detected on the right page', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('ex-broken').click();
    const r = await page.evaluate(() => (window as any).__hreflang.result);
    const has = (level: string, kind: string, path: string) =>
      r.issues.some((i: Issue) => i.level === level && i.kind === kind && i.page === KB + path);
    expect(has('error', 'invalid-region', '/en-us/'), 'en-UK').toBe(true);
    expect(has('error', 'unsupported-region', '/en-us/'), 'es-419').toBe(true);
    expect(has('error', 'invalid-language', '/en-us/'), 'jp').toBe(true);
    expect(has('error', 'no-return', '/en-gb/'), '/en-gb/ lists /fr/, which does not list it back').toBe(true);
    expect(has('error', 'no-self', '/es/'), 'no self-reference').toBe(true);
    expect(has('error', 'duplicate-code', '/de/'), 'de twice').toBe(true);
    expect(has('error', 'canonical-conflict', '/ja/'), 'canonical elsewhere').toBe(true);
    expect(has('error', 'relative-url', '/fr/'), 'relative href').toBe(true);
    expect(r.issues.some((i: Issue) => i.kind === 'no-x-default' && i.level === 'warning')).toBe(true);
    // and nothing is reported on the pairs that really are reciprocal
    const noReturn = r.issues.filter((i: Issue) => i.kind === 'no-return').map((i: Issue) => i.page).sort();
    expect(noReturn).toEqual([`${KB}/en-gb/`, `${KB}/es/`]);
    await expect(page.getByTestId('status')).toContainText(`${r.errors} errors`);
    const ul = page.getByTestId('issues');
    await expect(ul.locator('li[data-kind="invalid-region"]')).toContainText('Use en-GB');
    await expect(ul.locator('li').first()).toHaveAttribute('data-level', 'error');     // errors are listed first
  });

  test('code validation: an independent table of valid and invalid codes', async ({ page }) => {
    await page.goto(URL_);
    // [code, expected kind or canonical form] - worked out from ISO 639-1, ISO 3166-1 and Google's rules
    const table: [string, string][] = [
      ['en', 'ok:en'], ['EN-gb', 'ok:en-GB'], ['de-AT', 'ok:de-AT'], ['zh-hant', 'ok:zh-Hant'], ['zh-Hant-TW', 'ok:zh-Hant-TW'],
      ['sr-Latn-RS', 'ok:sr-Latn-RS'], ['pt-BR', 'ok:pt-BR'], ['X-Default', 'ok:x-default'], ['uk', 'ok:uk'], ['nb-NO', 'ok:nb-NO'],
      ['en-UK', 'invalid-region'], ['en-EU', 'invalid-region'], ['fr-UN', 'invalid-region'], ['en-XX', 'invalid-region'],
      ['es-419', 'unsupported-region'], ['en-150', 'unsupported-region'], ['fr-002', 'unsupported-region'],
      ['jp', 'invalid-language'], ['cn', 'invalid-language'], ['eng', 'invalid-language'], ['GB', 'invalid-language'], ['xx-US', 'invalid-language'],
      ['en_US', 'underscore'], ['en-', 'malformed'], ['', 'malformed'], ['en-US-CA', 'malformed'], ['de-DEU', 'malformed'],
    ];
    const got = await page.evaluate((t) => t.map(([c]) => { const r = (window as any).__hreflang.parseCode(c); return r.ok ? 'ok:' + r.canon : r.kind; }), table);
    expect(got).toEqual(table.map(([, want]) => want));
    const msgs = await page.evaluate(() => { const p = (window as any).__hreflang.parseCode; return { uk: p('en-UK').message, jp: p('jp').message, gb: p('GB').message }; });
    expect(msgs.uk).toContain('Use en-GB');
    expect(msgs.jp).toContain('ja (Japanese)');
    expect(msgs.gb).toContain("a region can't be used on its own");
    // an unknown but well-formed script is a warning, not an error
    const s = await page.evaluate(() => (window as any).__hreflang.parseCode('az-Qaaa'));
    expect(s).toMatchObject({ ok: true, canon: 'az-Qaaa', warning: { kind: 'unknown-script' } });
  });

  test('code lists are embedded: all 183 ISO 639-1 and 249 ISO 3166-1 alpha-2 codes, and no requests', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(URL_);
    const L = await page.evaluate(() => (window as any).__hreflang.lists);
    expect(L.language.length).toBe(183);
    expect(new Set(L.language).size).toBe(183);
    expect(L.language.every((c: string) => /^[a-z]{2}$/.test(c))).toBe(true);
    expect(L.region.length).toBe(249);
    expect(new Set(L.region).size).toBe(249);
    expect(L.region.every((c: string) => /^[A-Z]{2}$/.test(c))).toBe(true);
    // spot checks from the standards: late additions and easily confused codes
    for (const c of ['en', 'ja', 'zh', 'he', 'id', 'yi', 'nb', 'nn', 'se', 'kr', 'uk']) expect(L.language, c).toContain(c);
    for (const c of ['jp', 'cn', 'iw', 'in', 'ji', 'dk', 'gr']) expect(L.language, c).not.toContain(c);
    for (const c of ['GB', 'SS', 'CW', 'SX', 'BQ', 'MF', 'AX', 'PS', 'TW', 'HK']) expect(L.region, c).toContain(c);
    for (const c of ['UK', 'EU', 'UN', 'XK', 'AN', 'YU', 'CS', 'EZ']) expect(L.region, c).not.toContain(c);
    expect(L.reserved).toEqual(expect.arrayContaining(['UK', 'EU', 'UN']));
    // checking a big input triggers no network activity at all
    const before = requests.length;
    await page.getByTestId('ex-broken').click();
    await page.getByTestId('ex-valid').click();
    await page.getByTestId('ex-sitemap').click();
    await expect(page.getByTestId('status')).toContainText('sitemap mode');
    expect(requests.slice(before)).toEqual([]);
  });

  test('return links: a one-way annotation is an error, shown in the matrix, and fixing it clears it', async ({ page }) => {
    await page.goto(URL_);
    const oneWay = cluster(BASE, (u, alts) => (u === `${T}/fr/` ? alts.filter(([c]) => c !== 'de') : alts));
    let r = await check(page, oneWay);
    expect(kinds(r.issues, 'error')).toEqual(['no-return']);
    expect(r.issues.find((i: Issue) => i.kind === 'no-return').page).toBe(`${T}/de/`);
    expect(r.warnings).toBe(0);
    await page.getByTestId('src').fill(oneWay);
    await page.getByTestId('check').click();
    const m = page.getByTestId('matrix-0');
    await expect(m.locator(`td[data-row="${T}/de/"][data-col="${T}/fr/"]`)).toHaveAttribute('data-state', 'no-return');
    await expect(m.locator(`td[data-row="${T}/fr/"][data-col="${T}/de/"]`)).toHaveAttribute('data-state', 'missing');
    // a target that isn't in the pasted set can't be verified: a warning, not an error
    r = await check(page, html({ [`${T}/en/`]: [null, [['en', `${T}/en/`], ['de', `${T}/de/`], ['x-default', `${T}/en/`]]] }));
    expect(kinds(r.issues)).toEqual(['unverified-target']);
    r = await check(page, cluster(BASE));
    expect(r.issues).toEqual([]);
  });

  test('self-reference and x-default', async ({ page }) => {
    await page.goto(URL_);
    let r = await check(page, cluster(BASE, (u, alts) => (u === `${T}/de/` ? alts.filter(([, h]) => h !== u) : alts)));
    expect(kinds(r.issues, 'error')).toEqual(['no-self']);
    expect(r.issues[0].page).toBe(`${T}/de/`);
    r = await check(page, cluster(BASE.filter(([c]) => c !== 'x-default')));
    expect(r.errors).toBe(0);
    expect(kinds(r.issues)).toEqual(['no-x-default']);
    expect(r.issues[0].level).toBe('warning');
    // x-default may share a URL with a language version; that is not a duplicate
    r = await check(page, cluster(BASE));
    expect(r.issues).toEqual([]);
  });

  test('duplicate language-region pairs, repeats and inconsistent codes', async ({ page }) => {
    await page.goto(URL_);
    // the same code (compared case-insensitively) to two URLs on one page
    let r = await check(page, cluster(BASE, (u, alts) => (u === `${T}/en/` ? [...alts, ['EN', `${T}/en-alt/`]] : alts)));
    const dup = r.issues.filter((i: Issue) => i.kind === 'duplicate-code');
    expect(dup.length).toBe(1);
    expect(dup[0]).toMatchObject({ level: 'error', page: `${T}/en/` });
    expect(dup[0].msg).toContain(`${T}/en-alt/`);
    // the identical annotation twice is only a warning
    r = await check(page, cluster(BASE, (u, alts) => (u === `${T}/fr/` ? [...alts, ['fr', `${T}/fr/`]] : alts)));
    expect(r.errors).toBe(0);
    expect(kinds(r.issues)).toEqual(['repeated']);
    // two pages disagree about which language a URL is
    r = await check(page, cluster(BASE, (u, alts) => (u === `${T}/fr/` ? alts.map(([c, h]) => [c === 'de' ? 'de-AT' : c, h]) : alts)));
    expect(kinds(r.issues)).toEqual(['inconsistent-code']);
    expect(r.issues[0].page).toBe(`${T}/de/`);
  });

  test('canonical conflicts: a non-canonical page must not be an hreflang target', async ({ page }) => {
    await page.goto(URL_);
    const src = html({
      [`${T}/en/`]: [`${T}/en/`, BASE],
      [`${T}/de/`]: [`${T}/en/`, BASE],       // canonicalised to the English page
      [`${T}/fr/`]: ['/fr/', BASE],            // relative canonical that resolves to itself: fine
    });
    const r = await check(page, src);
    expect(kinds(r.issues, 'error')).toEqual(['canonical-conflict']);
    const c = r.issues.find((i: Issue) => i.kind === 'canonical-conflict');
    expect(c.page).toBe(`${T}/de/`);
    expect(c.msg).toContain(`canonical points to ${T}/en/`);
    expect(r.pages.find((p: any) => p.url === `${T}/fr/`).canonical).toBe(`${T}/fr/`);
    await page.getByTestId('src').fill(src);
    await page.getByTestId('check').click();
    await expect(page.getByTestId('matrix-0').locator('td.canon-bad')).toHaveCount(3);   // every row's cell for /de/
  });

  test('sitemap mode reads xhtml:link and finds the planted one-way link', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('ex-sitemap').click();
    await expect(page.getByTestId('status')).toContainText('1 error and 0 warnings across 3 pages (sitemap mode)');
    const r = await page.evaluate(() => (window as any).__hreflang.result);
    expect(r.mode).toBe('sitemap');
    expect(r.issues.map((i: Issue) => `${i.kind}@${i.page}`)).toEqual(['no-return@https://www.lumentea.example/de/']);
    // the sample is itself well-formed XML with the right namespaces
    const ns = await page.evaluate(() => {
      const d = new DOMParser().parseFromString((window as any).__hreflang.examples.sitemap, 'application/xml');
      return { err: d.getElementsByTagName('parsererror').length, root: d.documentElement.namespaceURI,
        links: d.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'link').length };
    });
    expect(ns).toEqual({ err: 0, root: 'http://www.sitemaps.org/schemas/sitemap/0.9', links: 11 });
    // missing xhtml namespace and broken XML are both reported
    const noNs = await check(page, '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a.example/</loc><link rel="alternate" hreflang="en" href="https://a.example/"/></url></urlset>');
    expect(noNs.annotations).toBe(0);
    const bad = await check(page, '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a.example/?a=1&b=2</loc></url></urlset>');
    expect(bad.issues[0]).toMatchObject({ level: 'error', kind: 'parse' });
    expect(bad.issues[0].msg).toContain("isn't well-formed XML");
  });

  test('es-419 is rejected with the reason and the citation on the page', async ({ page }) => {
    await page.goto(URL_);
    const m = await page.evaluate(() => (window as any).__hreflang.parseCode('es-419'));
    expect(m.ok).toBe(false);
    expect(m.kind).toBe('unsupported-region');
    expect(m.message).toContain('UN M.49');
    expect(m.message).toContain('es-MX');
    const cite = page.getByTestId('citation');
    await expect(cite).toContainText('developers.google.com/search/docs/specialty/international/localized-versions');
    await expect(cite).toContainText("such as es-419, aren't supported");
    await expect(cite).toContainText('en-UK');
  });

  test('HTML-mode parsing: relative hrefs, bad page lines, tags outside a page, and the UI works from the keyboard', async ({ page }) => {
    await page.goto(URL_);
    const r = await check(page, [
      '<link rel="alternate" hreflang="en" href="https://x.example/">',
      '== /relative-page',
      '== https://x.example/',
      '<link rel="alternate" hreflang="en" href="//x.example/">',
      '<link rel="alternate" hreflang="en" href="https://x.example/">',
      '== https://x.example/',
    ].join('\n'));
    const msgs = r.issues.map((i: Issue) => `${i.kind}:${i.msg}`).join('\n');
    expect(msgs).toContain("parse:Some <link> tags come before the first");
    expect(msgs).toContain('parse:Line 2: "/relative-page" isn\'t an absolute URL');
    expect(msgs).toContain('parse:Line 6: https://x.example/ appears twice');
    expect(msgs).toContain('relative-url:hreflang="en" href="//x.example/"');
    expect(r.pages.length).toBe(1);
    // keyboard: focus the Valid example button and press Enter
    await page.getByTestId('ex-valid').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status')).toContainText('Clean');
    await expect(page.locator('#live')).toHaveAttribute('aria-live', 'polite');
  });
});
