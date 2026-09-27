import { test, expect, Page } from '@playwright/test';

const URL = '/lab/152-robots-tester.html';

type Rule = [type: 'allow' | 'disallow', pattern: string];

// ---- The test's own matcher, written independently of the page (regex-based, not the page's position-set walk) ----
// RFC 9309 §2.2.2 / §2.2.3: '*' is any run of characters, a trailing '$' anchors the end, matching starts at the path start.
const toRegex = (p: string) => {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
};
// longest pattern wins; on equal length allow wins; no match = allowed
function oracle(rules: Rule[], path: string): { allowed: boolean; rule: Rule | null } {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!r[1] || !toRegex(r[1]).test(path)) continue;
    if (!best || r[1].length > best[1].length || (r[1].length === best[1].length && r[0] === 'allow')) best = r;
  }
  return { allowed: path === '/robots.txt' || !best || best[0] === 'allow', rule: best };
}

const check = (page: Page, txt: string, tokens: string[], url: string) =>
  page.evaluate(([t, k, u]) => (window as any).__robots.check(t, k, u), [txt, tokens, url] as const);

async function runUI(page: Page, robots: string, token: string, urls: string[]) {
  await page.getByTestId('robots').fill(robots);
  await page.getByTestId('ua').selectOption('custom');
  await page.getByTestId('custom').fill(token);
  await page.getByTestId('urls').fill(urls.join('\n'));
  await page.getByTestId('run').click();
}

const RFC_51 = `User-Agent: *
Disallow: *.gif$
Disallow: /example/
Allow: /publications/

User-Agent: foobot
Disallow:/
Allow:/example/page.html
Allow:/example/allowed.gif

User-Agent: barbot
User-Agent: bazbot
Disallow: /example/page.html

User-Agent: quxbot
`;

test.describe('152 robots.txt Tester', () => {
  test('RFC 9309 §5.1 example: every bot and path agrees with the independent matcher and with the RFC text', async ({ page }) => {
    await page.goto(URL + '?sample=rfc');
    // the groups as the RFC reads them, transcribed by hand (not parsed)
    const groups: Record<string, Rule[]> = {
      star: [['disallow', '*.gif$'], ['disallow', '/example/'], ['allow', '/publications/']],
      foobot: [['disallow', '/'], ['allow', '/example/page.html'], ['allow', '/example/allowed.gif']],
      barbot: [['disallow', '/example/page.html']],
      bazbot: [['disallow', '/example/page.html']],
      quxbot: [],
    };
    const paths = ['/example/page.html', '/example/allowed.gif', '/example/other.html', '/publications/report.gif', '/publications/x.html', '/cat.gif', '/cat.gif?x=1', '/', '/robots.txt'];
    for (const [bot, rules] of Object.entries({ ...groups, otherbot: groups.star })) {
      for (const p of paths) {
        const got = await check(page, RFC_51, [bot === 'star' ? 'nobodybot' : bot], p);
        expect(got.allowed, `${bot} ${p}`).toBe(oracle(rules, p).allowed);
      }
    }
    // spot checks straight from the RFC's prose
    expect((await check(page, RFC_51, ['foobot'], '/example/page.html')).allowed).toBe(true);
    expect((await check(page, RFC_51, ['foobot'], '/example/other.html')).allowed).toBe(false);
    expect((await check(page, RFC_51, ['BarBot'], '/example/page.html')).allowed).toBe(false);
    expect((await check(page, RFC_51, ['quxbot'], '/example/page.html')).allowed).toBe(true);
    // the UI shows the same verdicts with the winning line
    await expect(page.getByTestId('custom')).toHaveValue('foobot');
    const rows = page.getByTestId('result');
    await expect(rows).toHaveCount(7);
    await expect(rows.nth(0)).toHaveAttribute('data-verdict', 'allowed');
    await expect(rows.nth(0)).toHaveAttribute('data-line', '8'); // Allow:/example/page.html
    await expect(rows.nth(2)).toHaveAttribute('data-verdict', 'disallowed');
    await expect(rows.nth(2)).toHaveAttribute('data-line', '7'); // Disallow:/
    await expect(rows.nth(6).getByTestId('why')).toContainText('/robots.txt is always allowed');
    await expect(page.getByTestId('summary')).toHaveText('7 URLs tested: 3 allowed, 4 disallowed.');
  });

  test('RFC 9309 §5.2 longest match, and the §2.2.1 rule that groups for the same crawler are combined', async ({ page }) => {
    await page.goto(URL);
    const longest = 'User-Agent: foobot\nAllow: /example/page/\nDisallow: /example/page/disallowed.gif\n';
    const r = await check(page, longest, ['foobot'], '/example/page/disallowed.gif');
    expect(r.allowed).toBe(false);
    expect(r.rule.line).toBe(3);
    expect((await check(page, longest, ['foobot'], '/example/page/ok.gif')).allowed).toBe(true);

    const split = 'user-agent: ExampleBot\ndisallow: /foo\ndisallow: /bar\n\nuser-agent: ExampleBot\ndisallow: /baz\n';
    for (const p of ['/foo', '/bar', '/baz/x']) expect((await check(page, split, ['examplebot'], p)).allowed, p).toBe(false);
    expect((await check(page, split, ['examplebot'], '/qux')).allowed).toBe(true);
    await runUI(page, split, 'ExampleBot', ['/baz']);
    await expect(page.getByTestId('group')).toContainText('lines 1, 5, combined');
    await expect(page.getByTestId('group')).toContainText('3 rules');
  });

  test("Google's path-matching examples (/fish, /fish/, /*.php, /*.php$, /fish*.php) match the documented lists and the regex oracle", async ({ page }) => {
    await page.goto(URL);
    // Google Search Central, "How Google interprets the robots.txt specification": URL matching based on path values
    const table: Record<string, { yes: string[]; no: string[] }> = {
      '/': { yes: ['/', '/anything/at/all'], no: [] },
      '/$': { yes: ['/'], no: ['/page', '/?q=1'] },
      '/fish': { yes: ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fishheads/yummy.html', '/fish.php?id=anything'], no: ['/Fish.asp', '/catfish', '/?id=fish', '/desert/fish'] },
      '/fish*': { yes: ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fishheads/yummy.html', '/fish.php?id=anything'], no: ['/Fish.asp', '/catfish', '/?id=fish', '/desert/fish'] },
      '/fish/': { yes: ['/fish/', '/fish/?id=anything', '/fish/salmon.htm'], no: ['/fish', '/fish.html', '/animals/fish/', '/Fish/Salmon.asp'] },
      '/*.php': { yes: ['/index.php', '/filename.php', '/folder/filename.php', '/folder/filename.php?parameters', '/folder/any.php.file.html', '/filename.php/'], no: ['/', '/windows.PHP'] },
      '/*.php$': { yes: ['/filename.php', '/folder/filename.php'], no: ['/filename.php?parameters', '/filename.php/', '/filename.php5', '/windows.PHP'] },
      '/fish*.php': { yes: ['/fish.php', '/fishheads/catfish.php?parameters'], no: ['/Fish.PHP'] },
    };
    for (const [pat, { yes, no }] of Object.entries(table)) {
      const txt = `user-agent: *\ndisallow: ${pat}\n`;
      for (const p of yes) {
        expect(toRegex(pat).test(p), `oracle ${pat} ${p}`).toBe(true);
        expect((await check(page, txt, ['Googlebot'], p)).allowed, `${pat} should block ${p}`).toBe(false);
      }
      for (const p of no) {
        expect(toRegex(pat).test(p), `oracle ${pat} ${p}`).toBe(false);
        expect((await check(page, txt, ['Googlebot'], p)).allowed, `${pat} should not block ${p}`).toBe(true);
      }
    }
    // full URLs are reduced to path + query; the fragment is dropped
    const full = await check(page, 'user-agent: *\ndisallow: /*.php$\n', ['Googlebot'], 'https://shop.example:8443/folder/filename.php#top');
    expect(full.path).toBe('/folder/filename.php');
    expect(full.allowed).toBe(false);
  });

  test("Google's order-of-precedence table: longest rule wins, allow wins ties, /$ only matches the root", async ({ page }) => {
    await page.goto(URL + '?sample=google');
    const rows: { url: string; allow: string; disallow: string; winner: Rule }[] = [
      { url: '/page', allow: '/p', disallow: '/', winner: ['allow', '/p'] },
      { url: '/folder/page', allow: '/folder', disallow: '/folder', winner: ['allow', '/folder'] },
      { url: '/page.htm', allow: '/page', disallow: '/*.htm', winner: ['disallow', '/*.htm'] },
      { url: '/page.php5', allow: '/page', disallow: '/*.ph', winner: ['allow', '/page'] },
      { url: '/', allow: '/$', disallow: '/', winner: ['allow', '/$'] },
      { url: '/page.htm', allow: '/$', disallow: '/', winner: ['disallow', '/'] },
    ];
    for (const row of rows) {
      const rules: Rule[] = [['allow', row.allow], ['disallow', row.disallow]];
      expect(oracle(rules, row.url).rule, `oracle ${row.url}`).toEqual(row.winner);
      const got = await check(page, `user-agent: *\nallow: ${row.allow}\ndisallow: ${row.disallow}\n`, ['Googlebot'], row.url);
      expect([got.rule.type, got.rule.value], row.url).toEqual(row.winner);
      expect(got.allowed).toBe(row.winner[0] === 'allow');
      expect(got.rule.length).toBe(row.winner[1].length);
    }
    // the tie is explained in the UI (row b of the bundled sample)
    await page.getByTestId('custom').fill('rowb');
    await page.getByTestId('urls').fill('/folder/page');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('result')).toHaveAttribute('data-verdict', 'allowed');
    await expect(page.getByTestId('why')).toContainText('allow wins the tie');
    await expect(page.getByTestId('result').locator('tr.win td').nth(1)).toHaveText('allow');
  });

  test('group selection: case-insensitive product token, most specific token first, * as fallback, nothing when no group applies', async ({ page }) => {
    await page.goto(URL);
    const txt = 'User-agent: *\nDisallow: /star\n\nUser-agent: googlebot/2.1\nDisallow: /g\n\nUser-agent: GOOGLEBOT-IMAGE\nDisallow: /img\n';
    // "googlebot/2.1" still names the product token googlebot
    expect((await check(page, txt, ['Googlebot'], '/g')).allowed).toBe(false);
    expect((await check(page, txt, ['Googlebot'], '/star')).allowed).toBe(true); // the * group is not merged in
    expect((await check(page, txt, ['Googlebot-Image', 'Googlebot'], '/img')).allowed).toBe(false);
    expect((await check(page, txt, ['Googlebot-Image', 'Googlebot'], '/g')).allowed).toBe(true);
    // with no Googlebot-Image group, the image crawler falls back to Googlebot's group, not *
    const noImg = txt.replace(/User-agent: GOOGLEBOT-IMAGE\nDisallow: \/img\n/, '');
    const fb = await check(page, noImg, ['Googlebot-Image', 'Googlebot'], '/g');
    expect(fb.allowed).toBe(false);
    expect(fb.group.by).toBe('Googlebot');
    const other = await check(page, txt, ['Bingbot'], '/star');
    expect(other.allowed).toBe(false);
    expect(other.group.star).toBe(true);
    // no matching group and no * group: no rules apply
    expect((await check(page, 'User-agent: foobot\nDisallow: /\n', ['Bingbot'], '/x')).allowed).toBe(true);
    // the UI: switching crawler changes the chosen group
    await page.getByTestId('robots').fill(txt);
    await page.getByTestId('urls').fill('/img/a.png');
    await page.getByTestId('ua').selectOption('googlebot-image');
    await expect(page.getByTestId('group')).toContainText('group for "Googlebot-Image"');
    await expect(page.getByTestId('result')).toHaveAttribute('data-verdict', 'disallowed');
    await page.getByTestId('ua').selectOption('bingbot');
    await expect(page.getByTestId('group')).toContainText('the * group');
    await expect(page.getByTestId('result')).toHaveAttribute('data-verdict', 'allowed');
    // an invalid custom token is refused with an alert
    await page.getByTestId('ua').selectOption('custom');
    await expect(page.getByTestId('custom')).toBeFocused();
    await page.getByTestId('custom').fill('Bad/Bot 2');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('ua-error')).toContainText('not a valid product token');
    await expect(page.getByTestId('result')).toHaveCount(0);
  });

  test('percent-encoding normalisation follows the RFC 9309 table, and %2A / %24 match a literal * and $', async ({ page }) => {
    await page.goto(URL);
    const norm = (s: string, pat = false) => page.evaluate(([x, p]) => (window as any).__robots.normalise(x, p), [s, pat] as const);
    // RFC 9309 §2.2.2 examples: U+30C4 is UTF-8 E3 83 84; %62%61%7A are unreserved letters and decode to "baz"
    expect(Buffer.from('ツ', 'utf8').toString('hex').toUpperCase()).toBe('E38384');
    expect(await norm('/foo/bar?baz=quz')).toBe('/foo/bar?baz=quz');
    expect(await norm('/foo/bar/ツ')).toBe('/foo/bar/%E3%83%84');
    expect(await norm('/foo/bar/%E3%83%84')).toBe('/foo/bar/%E3%83%84');
    expect(await norm('/foo/bar/%e3%83%84')).toBe('/foo/bar/%E3%83%84');
    expect(await norm('/foo/bar/%62%61%7A')).toBe('/foo/bar/baz');
    expect(await norm('/a%2Fb')).toBe('/a%2Fb'); // an encoded reserved "/" stays encoded
    // so a rule written one way matches the URL written the other way
    expect((await check(page, 'user-agent: *\ndisallow: /foo/bar/%62az\n', ['x'], '/foo/bar/baz')).allowed).toBe(false);
    expect((await check(page, 'user-agent: *\ndisallow: /caf%C3%A9\n', ['x'], '/café/menu')).allowed).toBe(false);
    expect((await check(page, 'user-agent: *\ndisallow: /ツ\n', ['x'], '/%E3%83%84')).allowed).toBe(false);
    // §2.2.3: a literal * or $ in a rule has to be written %2A / %24
    const lit = 'user-agent: *\ndisallow: /path/file-with-a-%2A.html\ndisallow: /path/foo-%24\n';
    expect((await check(page, lit, ['x'], '/path/file-with-a-*.html')).allowed).toBe(false);
    expect((await check(page, lit, ['x'], '/path/file-with-a-b.html')).allowed).toBe(true);
    expect((await check(page, lit, ['x'], '/path/foo-$')).allowed).toBe(false);
    expect((await check(page, lit, ['x'], '/path/foo-')).allowed).toBe(true);
    // matching is case-sensitive
    expect((await check(page, 'user-agent: *\ndisallow: /Private\n', ['x'], '/private')).allowed).toBe(true);
  });

  test('parser details: comments, blank lines inside a group, empty disallow, rules before any user-agent, /robots.txt always allowed', async ({ page }) => {
    await page.goto(URL);
    const txt = [
      'Disallow: /orphan',
      '# comment line',
      'User-agent: *   # everyone',
      '',
      'Disallow: /tmp/ # trailing comment',
      'Disallow:',
      'Disallow: /',
      'Crawl-delay: 10',
      'Noindex: /old',
    ].join('\n');
    const p = await page.evaluate((t) => (window as any).__robots.parse(t), txt);
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].rules.map((r: any) => r.value)).toEqual(['/tmp/', '', '/']);
    expect((await check(page, txt, ['x'], '/robots.txt')).allowed).toBe(true);
    expect((await check(page, txt, ['x'], '/robots.txt')).rule).toBeNull();
    expect((await check(page, txt, ['x'], '/tmp/a')).rule.line).toBe(5);
    // an empty Disallow matches nothing on its own
    expect((await check(page, 'User-agent: *\nDisallow:\n', ['x'], '/anything')).allowed).toBe(true);
    await page.getByTestId('robots').fill(txt);
    await page.getByTestId('run').click();
    const warnings = page.getByTestId('warnings');
    await expect(warnings).toContainText('Line 1: disallow before any user-agent line, ignored');
    await expect(warnings).toContainText('crawl-delay is not part of RFC 9309');
    await expect(warnings).toContainText('unknown record "noindex"');
  });

  test('Sitemap extractor lists every Sitemap line, flags relative ones, and a Sitemap line does not split a group', async ({ page }) => {
    await page.goto(URL + '?sample=shop');
    const items = page.getByTestId('sitemap');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveText('https://juniper-rye.example/sitemap-index.xml (line 21)');
    await expect(items.nth(1)).toContainText('not an absolute URL');
    const txt = 'User-agent: a\nSitemap: https://x.example/s.xml\nUser-agent: b\nDisallow: /p\nsitemap:https://x.example/t.xml.gz\n';
    const parsed = await page.evaluate((t) => (window as any).__robots.parse(t), txt);
    expect(parsed.sitemaps.map((s: any) => s.url)).toEqual(['https://x.example/s.xml', 'https://x.example/t.xml.gz']);
    expect(parsed.groups).toHaveLength(1);
    expect((await check(page, txt, ['a'], '/p')).allowed).toBe(false);
    await expect(page.getByText('at most 50,000 URLs and be at most 50 MB (52,428,800 bytes) uncompressed')).toBeVisible();
  });

  test('the 500 KiB parse limit: rules beyond 512,000 bytes are ignored and the page says so', async ({ page }) => {
    await page.goto(URL);
    const LIMIT = 500 * 1024;
    expect(await page.evaluate(() => (window as any).__robots.LIMIT)).toBe(LIMIT);
    const filler = '# ' + 'x'.repeat(98) + '\n'; // 101 bytes per line
    const head = 'User-agent: *\nDisallow: /early\n';
    const pad = filler.repeat(Math.ceil(LIMIT / filler.length));
    const big = head + pad + 'Disallow: /late\n';
    expect(Buffer.byteLength(big)).toBeGreaterThan(LIMIT);
    expect((await check(page, big, ['x'], '/early')).allowed).toBe(false);
    expect((await check(page, big, ['x'], '/late')).allowed).toBe(true);
    // the same rule just inside the limit still counts
    const small = head + filler.repeat(100) + 'Disallow: /late\n';
    expect((await check(page, small, ['x'], '/late')).allowed).toBe(false);
    // typing 500 KiB through fill() is slow, so set the value directly and press the real button
    await page.getByTestId('robots').evaluate((el, v) => { (el as HTMLTextAreaElement).value = v; }, big);
    await page.getByTestId('run').click();
    await expect(page.getByTestId('warnings')).toContainText('File is over 500 KiB');
    await expect(page.getByTestId('size')).toContainText(`${Buffer.byteLength(big).toLocaleString('en-US')} bytes`);
  });

  test('the fictional shop sample: Googlebot ignores the * group, the image crawler gets its own, and copy lists every verdict', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('sample')).toHaveValue('shop');
    const rows = page.getByTestId('result');
    await expect(rows).toHaveCount(12);
    const verdicts = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-verdict')));
    // Googlebot's own group has no /search or *.pdf rules, so those stay crawlable for it
    expect(verdicts).toEqual(['allowed', 'disallowed', 'disallowed', 'disallowed', 'disallowed', 'allowed', 'allowed', 'allowed', 'allowed', 'allowed', 'disallowed', 'allowed']);
    await page.getByTestId('ua').selectOption('custom');
    await page.getByTestId('custom').fill('SomeOtherBot');
    await page.getByTestId('run').click();
    await expect(rows.nth(5)).toHaveAttribute('data-verdict', 'disallowed'); // /search?q=tent via the * group
    await expect(rows.nth(6)).toHaveAttribute('data-verdict', 'allowed');    // /search/guides: allow ...$ is longer
    await expect(rows.nth(7)).toHaveAttribute('data-verdict', 'disallowed'); // /search/guides/winter: $ stops the allow
    await expect(rows.nth(8)).toHaveAttribute('data-verdict', 'disallowed'); // /catalog.pdf
    await page.getByTestId('copy').click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveText('Copied 12 lines.');
    const copied: string = await page.evaluate(() => (window as any).__robots.state.copied);
    expect(copied.split('\n')).toHaveLength(12);
    expect(copied.split('\n')[5]).toBe('BLOCK\t/search?q=tent\tdisallow: /search (line 6)');
    await expect(page.getByTestId('notes')).toContainText('robots.txt controls crawling, not indexing');
    await expect(page.getByTestId('notes')).toContainText('RFC 9309');
  });
});
