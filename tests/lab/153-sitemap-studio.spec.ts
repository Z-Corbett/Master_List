import { test, expect, Page } from '@playwright/test';

const URL_ = '/lab/153-sitemap-studio.html';
const H = 'https://www.harbor-lane-pottery.example';

// Independent oracle: the five predefined XML entities, as listed in the sitemaps.org protocol's escaping table.
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;').replace(/>/g, '&gt;').replace(/</g, '&lt;');

/** Parse an XML string in the page with DOMParser and return what the test needs to know about it. */
async function parseXml(page: Page, xml: string) {
  return page.evaluate((x) => {
    const doc = new DOMParser().parseFromString(x, 'application/xml');
    const err = doc.getElementsByTagName('parsererror').length > 0;
    const root = doc.documentElement;
    const locs = Array.from(doc.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'loc')).map((n) => n.textContent);
    const lastmods = Array.from(doc.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'lastmod')).map((n) => n.textContent);
    return { err, root: root.localName, ns: root.namespaceURI, locs, lastmods, urls: doc.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'url').length };
  }, xml);
}
const result = (page: Page) => page.evaluate(() => {
  const r = (window as any).__sitemap.result;
  return { ...r, files: r.files.map((f: any) => ({ name: f.name, kind: f.kind, count: f.count, bytes: f.bytes, xml: f.count > 1000 ? '' : f.xml })) };
});
async function buildWith(page: Page, text: string) {
  await page.getByTestId('urls').fill(text);
  await page.getByTestId('build').click();
}

test.describe('153 Sitemap Studio', () => {
  test('the messy sample: rejects relative, other-host and wrong-protocol URLs, keeps the rest', async ({ page }) => {
    await page.goto(URL_);
    await expect(page.getByTestId('status')).toContainText('Built with errors');
    const r = await result(page);
    const msgs = r.issues.map((i: any) => `${i.level}:${i.msg}`).join('\n');
    expect(msgs).toMatch(/error:Line 4: "\/shop\/bowls\/" isn't an absolute URL/);
    expect(msgs).toMatch(/error:Line 6: http:\/\/www\.harbor-lane-pottery\.example doesn't match/);
    expect(msgs).toMatch(/error:Line 7: https:\/\/shop\.harbor-lane-pottery\.example doesn't match/);
    expect(msgs).toMatch(/warning:Line 5: duplicate of line 2/);
    const x = await parseXml(page, r.files[0].xml);
    expect(x.err).toBe(false);
    expect(x.root).toBe('urlset');
    expect(x.ns).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
    // every <loc> is on the sitemap's own protocol and host, with no duplicates
    for (const l of x.locs) expect(new URL(l!).origin).toBe(H);
    expect(new Set(x.locs).size).toBe(x.locs.length);
    expect(x.locs).not.toContain('http://www.harbor-lane-pottery.example/about/');
    expect(x.locs.some((l) => l!.includes('gift-cards'))).toBe(false);
    // 13 lines − relative − http − other host − duplicate = 9 URLs
    expect(x.urls).toBe(9);
    await expect(page.getByTestId('count-urls')).toHaveText('9');
    // non-ASCII is percent-encoded as UTF-8: é → %C3%A9
    expect(x.locs).toContain(`${H}/journal/caf%C3%A9-glazes`);
  });

  test('entity escaping is exact, and the XML round-trips through DOMParser', async ({ page }) => {
    await page.goto(URL_);
    const raw = `${H}/find?q=cups&size='tall'&label="gift"&cmp=<b>1</b>`;
    await buildWith(page, `${raw} 2026-09-01`);
    await expect(page.getByTestId('status')).toContainText('Valid: 1 URL in 1 file');
    const r = await result(page);
    const xml: string = r.files[0].xml;
    expect(xml).toContain(`<loc>${xmlEscape(raw)}</loc>`);
    expect(xml).toContain('&amp;size=&apos;tall&apos;&amp;label=&quot;gift&quot;&amp;cmp=&lt;b&gt;1&lt;/b&gt;');
    // nothing unescaped slipped through inside the <loc>
    const inner = xml.split('<loc>')[1].split('</loc>')[0];
    expect(inner).not.toMatch(/[<>"']|&(?!amp;|apos;|quot;|lt;|gt;)/);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    const x = await parseXml(page, xml);
    expect(x.err).toBe(false);
    expect(x.locs).toEqual([raw]);
    expect(x.lastmods).toEqual(['2026-09-01']);
    await expect(page.getByTestId('file-sitemap.xml')).toContainText('✓ parses');
  });

  test('lastmod must be W3C Datetime', async ({ page }) => {
    await page.goto(URL_);
    // Formats from the W3C Date and Time Formats note, which sitemaps.org cites.
    const valid = ['1997', '1997-07', '1997-07-16', '1997-07-16T19:20+01:00', '1997-07-16T19:20:30+01:00', '1997-07-16T19:20:30.45+01:00', '2026-09-01T00:00:00Z', '2024-02-29'];
    const invalid = ['2026-13-01', '2026-02-30', '2025-02-29', '2026-09-01T09:30', '2026-9-1', '01/09/2026', '2026-09-01 10:00:00', '2026-09-01T24:00:00Z', 'yesterday', '2026-09-01T10:00:00+0100'];
    const got = await page.evaluate(([v, i]) => ({
      v: v.map((s) => (window as any).__sitemap.validLastmod(s)), i: i.map((s) => (window as any).__sitemap.validLastmod(s)) }), [valid, invalid]);
    expect(got.v).toEqual(valid.map(() => true));
    expect(got.i).toEqual(invalid.map(() => false));
    // in the UI a bad lastmod is an error, and the URL is kept without it
    await buildWith(page, `${H}/a 2026-02-30\n${H}/b 2026-09-01T09:30\n${H}/c 2026-09-01T09:30:00-05:00`);
    await expect(page.getByTestId('count-errors')).toHaveText('2');
    await expect(page.getByTestId('issues')).toContainText('lastmod "2026-02-30" isn\'t W3C Datetime');
    const x = await parseXml(page, (await result(page)).files[0].xml);
    expect(x.urls).toBe(3);
    expect(x.lastmods).toEqual(['2026-09-01T09:30:00-05:00']);
  });

  test('120,000 URLs split at 50,000 into three sitemaps plus an index, all well-formed', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(URL_);
    await page.getByTestId('gen-n').fill('120000');
    await page.getByTestId('gen').click();
    await expect(page.getByTestId('count-files')).toHaveText('4', { timeout: 30_000 });
    await expect(page.getByTestId('count-urls')).toHaveText('120,000');
    const files = await page.evaluate(() => (window as any).__sitemap.result.files.map((f: any) => ({ name: f.name, kind: f.kind, count: f.count, bytes: f.bytes })));
    expect(files.map((f: any) => f.name)).toEqual(['sitemap-1.xml', 'sitemap-2.xml', 'sitemap-3.xml', 'sitemap_index.xml']);
    expect(files.slice(0, 3).map((f: any) => f.count)).toEqual([50000, 50000, 20000]);
    for (let i = 0; i < 3; i++) {
      const info = await page.evaluate((k) => {
        const f = (window as any).__sitemap.result.files[k];
        const doc = new DOMParser().parseFromString(f.xml, 'application/xml');
        const urls = doc.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'url');
        return { err: doc.getElementsByTagName('parsererror').length, urls: urls.length, first: urls[0].firstElementChild!.textContent,
          bytes: new TextEncoder().encode(f.xml).length };
      }, i);
      expect(info.err).toBe(0);
      expect(info.urls).toBe(files[i].count);
      expect(info.first).toBe(`${H}/${info.first!.split('/')[3]}/item-${i * 50000 + 1}`);
      expect(info.bytes).toBe(files[i].bytes);                   // byte counts are real UTF-8 lengths
      expect(info.bytes).toBeLessThanOrEqual(52428800);
    }
    const index = await page.evaluate(() => (window as any).__sitemap.result.files[3].xml);
    const x = await parseXml(page, index);
    expect(x.err).toBe(false);
    expect(x.root).toBe('sitemapindex');
    expect(x.locs).toEqual([1, 2, 3].map((n) => `${H}/sitemap-${n}.xml`));
    await expect(page.getByTestId('status')).toContainText('sitemap_index.xml');
  });

  test('limits: exactly 50,000 fits one file, 50,001 splits, and the 50 MB byte limit splits too', async ({ page }) => {
    await page.goto(URL_);
    const out = await page.evaluate((h) => {
      const S = (window as any).__sitemap;
      const mk = (n: number) => Array.from({ length: n }, (_, i) => `${h}/p/${i}`);
      const a = S.build(mk(50000), { loc: h + '/sitemap.xml' });
      const b = S.build(mk(50001), { loc: h + '/sitemap.xml' });
      // byte limit, lowered so the test doesn't have to allocate 50 MB: 10 URLs of about 100 bytes against 500 bytes
      const c = S.build(mk(10), { loc: h + '/sitemap.xml', maxBytes: 500 });
      return { limits: S.limits, a: a.files.map((f: any) => f.count), b: b.files.map((f: any) => f.name + ':' + f.count),
        c: c.files.filter((f: any) => f.kind === 'urlset').map((f: any) => ({ n: f.count, bytes: f.bytes, real: new TextEncoder().encode(f.xml).length })) };
    }, H);
    expect(out.limits).toEqual({ MAX_URLS: 50000, MAX_BYTES: 50 * 1024 * 1024, MAX_LOC: 2048 });
    expect(out.a).toEqual([50000]);
    expect(out.b).toEqual(['sitemap-1.xml:50000', 'sitemap-2.xml:1', 'sitemap_index.xml:2']);
    expect(out.c.length).toBeGreaterThan(1);
    expect(out.c.reduce((s, f) => s + f.n, 0)).toBe(10);
    for (const f of out.c) { expect(f.real).toBe(f.bytes); expect(f.bytes).toBeLessThanOrEqual(500); }
  });

  test('mixed hosts are rejected, whichever host the sitemap lives on', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('loc').fill('https://blog.harbor-lane-pottery.example/sitemap.xml');
    await buildWith(page, [
      'https://blog.harbor-lane-pottery.example/post-1',
      `${H}/shop/`,
      'https://blog.harbor-lane-pottery.example:8443/post-2',
      'http://blog.harbor-lane-pottery.example/post-3',
      'https://blog.harbor-lane-pottery.example/post-4'].join('\n'));
    await expect(page.getByTestId('count-errors')).toHaveText('3');
    const x = await parseXml(page, (await result(page)).files[0].xml);
    expect(x.locs).toEqual(['https://blog.harbor-lane-pottery.example/post-1', 'https://blog.harbor-lane-pottery.example/post-4']);
    await expect(page.getByTestId('issues').locator('li[data-level="error"]').first()).toContainText('A sitemap may only list URLs from its own protocol and host');
    // a relative sitemap location can't define a host at all
    await page.getByTestId('loc').fill('/sitemap.xml');
    await page.getByTestId('build').click();
    await expect(page.getByTestId('status')).toHaveText('No sitemap: fix the errors below.');
    await expect(page.getByTestId('count-files')).toHaveText('0');
  });

  test('robots.txt matching follows RFC 9309, and blocked sitemap URLs are warned about', async ({ page }) => {
    await page.goto(URL_);
    const cases = await page.evaluate(() => {
      const R = (window as any).__sitemap.robots;
      const txt = 'User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\nDisallow: /tie\nAllow: /tie\n\nUser-agent: FooBot\nuser-agent: BarBot\nDisallow: /\nAllow: /public\n';
      return {
        privatePage: R(txt, 'Googlebot', '/private/x'),
        longestAllow: R(txt, 'Googlebot', '/private/open/y'),
        pdfEnd: R(txt, 'Googlebot', '/files/a.pdf'),
        pdfQuery: R(txt, 'Googlebot', '/files/a.pdf?v=2'),
        tieAllow: R(txt, 'Googlebot', '/tie'),
        fooRoot: R(txt, 'foobot', '/shop'),
        barPublic: R(txt, 'BarBot', '/public/a'),
        robotsTxt: R(txt, 'FooBot', '/robots.txt'),
        emptyDisallow: R('User-agent: *\nDisallow:\n', 'Googlebot', '/anything'),
      };
    });
    expect(cases).toEqual({ privatePage: false, longestAllow: true, pdfEnd: false, pdfQuery: true, tieAllow: true,
      fooRoot: false, barPublic: true, robotsTxt: true, emptyDisallow: true });
    // in the UI (the bundled robots.txt): /search?q= and /cart/checkout warn, /search/help does not
    const warn = page.getByTestId('issues').locator('li[data-level="warning"]');
    await expect(warn.filter({ hasText: '/search?q=mug&color=blue is disallowed by robots.txt (Disallow: /search)' })).toHaveCount(1);
    await expect(warn.filter({ hasText: '/cart/checkout is disallowed by robots.txt (Disallow: /cart/)' })).toHaveCount(1);
    await expect(warn.filter({ hasText: '/search/help' })).toHaveCount(0);
    // a crawler with its own group sees the whole site blocked
    await page.getByTestId('ua').fill('examplebot');
    await page.getByTestId('build').click();
    await expect(warn.filter({ hasText: '(Disallow: /)' })).toHaveCount(9);
  });

  test('crawling the bundled site skips 404s, noindex, non-canonical and external links', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('crawl').click();
    const log = page.getByTestId('crawl-log');
    await expect(log).toContainText('404  /shop/bowls/discontinued-bowl');
    await expect(log).toContainText('200  /journal/drafts/wip  noindex: left out');
    await expect(log).toContainText('200  /shop/?sort=price  canonical → /shop/: left out');
    await expect(log).toContainText('ext  https://instagram.example/harborlane  (other host: not followed)');
    await expect(page.getByTestId('status')).toContainText('Valid: 15 URLs in 1 file');
    const r = await result(page);
    const x = await parseXml(page, r.files[0].xml);
    expect(x.err).toBe(false);
    expect(x.locs).toContain(`${H}/journal/glazes-&-firing`);
    expect(x.locs).toContain(`${H}/shop/vases/bud-vase-"moss"`);
    expect(r.files[0].xml).toContain('glazes-&amp;-firing');
    expect(r.files[0].xml).toContain('bud-vase-&quot;moss&quot;');
    expect(x.locs.some((l) => /cart|drafts|sort=/.test(l!))).toBe(false);
    expect(x.lastmods).toContain('2026-08-20T09:15:00-05:00');
  });

  test('download gives the exact XML under the right file name', async ({ page }) => {
    await page.goto(URL_);
    await page.getByTestId('crawl').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('dl-sitemap.xml').click()]);
    expect(dl.suggestedFilename()).toBe('sitemap.xml');
    const chunks: Buffer[] = [];
    for await (const c of await dl.createReadStream()) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    expect(body).toBe((await result(page)).files[0].xml);
  });

  test('changefreq/priority are opt-in and come with the note that Google ignores them', async ({ page }) => {
    await page.goto(URL_);
    await expect(page.getByTestId('issues')).not.toContainText('ignores them');
    expect((await result(page)).files[0].xml).not.toContain('<priority>');
    await page.getByTestId('opt-cf').check();
    await page.getByTestId('build').click();
    await expect(page.getByTestId('issues')).toContainText('Google has said it ignores them');
    const xml: string = (await result(page)).files[0].xml;
    const pr = [...xml.matchAll(/<priority>([^<]+)<\/priority>/g)].map((m) => +m[1]);
    expect(pr.length).toBe(9);
    for (const p of pr) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1); }
    expect((await parseXml(page, xml)).err).toBe(false);
  });

  test('?seed makes generated test URLs repeatable', async ({ page }) => {
    const firstLastmods = async (seed: number) => {
      await page.goto(`${URL_}?seed=${seed}`);
      await page.getByTestId('gen-n').fill('25');
      await page.getByTestId('gen').click();
      await expect(page.getByTestId('count-urls')).toHaveText('25');
      return (await parseXml(page, (await result(page)).files[0].xml)).lastmods.join(',') + '|' + (await result(page)).files[0].xml.match(/<loc>[^<]+/g)!.join(',');
    };
    const a = await firstLastmods(7), b = await firstLastmods(7), c = await firstLastmods(8);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
