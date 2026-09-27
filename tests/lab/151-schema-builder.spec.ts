import { test, expect, Page } from '@playwright/test';

const URL = '/lab/151-schema-builder.html';
const TYPES = ['LocalBusiness', 'Organization', 'Person', 'Product', 'Article', 'Event', 'BreadcrumbList', 'FAQPage'];

// Required properties, written out here from Google Search Central's structured-data docs (not read from the page).
const REQUIRED: Record<string, string[]> = {
  LocalBusiness: ['name', 'address'],
  Organization: [],
  Person: ['name'],
  Product: ['name', 'image', 'offers'],
  Article: [],
  Event: ['name', 'startDate', 'location'],
  BreadcrumbList: ['itemListElement'],
  FAQPage: ['mainEntity'],
};
const lineOf = (s: string, idx: number) => s.slice(0, idx).split('\n').length;
type Issue = { level: string; code: string; line: number | null; msg: string };
const lint = (page: Page, src: string): Promise<{ issues: Issue[] }> => page.evaluate((s) => (window as any).__schema.lint(s), src);
const pick = (r: { issues: Issue[] }, code: string) => r.issues.filter((i) => i.code === code);
// GS1 check digit, computed independently: weights 3,1,3,... from the rightmost data digit
const gs1 = (body: string) => { let s = 0; [...body].reverse().forEach((d, i) => { s += Number(d) * (i % 2 === 0 ? 3 : 1); }); return (10 - (s % 10)) % 10; };
const chooseType = (page: Page, t: string) => page.locator('#types label').filter({ hasText: new RegExp(`^${t === 'Product' ? 'Product \\+ Offer' : t}$`) }).click();

test.describe('151 Structured Data Builder', () => {
  test("every builder's default output parses and carries Google's required properties, including nested ones", async ({ page }) => {
    await page.goto(URL);
    for (const t of TYPES) {
      await chooseType(page, t);
      await expect(page.getByTestId(`type-${t}`)).toBeChecked();
      const text = (await page.getByTestId('output').textContent())!;
      const o = JSON.parse(text);
      expect(o['@context']).toBe('https://schema.org');
      if (t === 'LocalBusiness') expect(o['@type']).toBe('BicycleStore'); else if (t === 'Article') expect(['Article', 'BlogPosting', 'NewsArticle']).toContain(o['@type']); else expect(o['@type']).toBe(t);
      for (const k of REQUIRED[t]) expect(o[k], `${t}.${k}`).toBeTruthy();
      await expect(page.getByTestId('builder-summary')).toContainText('0 errors · 0 warnings');
      if (t === 'Product') { expect(o.offers['@type']).toBe('Offer'); expect(typeof o.offers.price === 'number' || /^\d+(\.\d+)?$/.test(o.offers.price)).toBe(true); expect(o.offers.priceCurrency).toMatch(/^[A-Z]{3}$/); expect(gs1(o.gtin13.slice(0, -1))).toBe(Number(o.gtin13.slice(-1))); }
      if (t === 'Event') { expect(o.location['@type']).toBe('Place'); expect(o.location.address.streetAddress).toBeTruthy(); expect(o.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/); }
      if (t === 'LocalBusiness') { expect(o.address['@type']).toBe('PostalAddress'); expect(typeof o.geo.latitude).toBe('number'); }
      if (t === 'BreadcrumbList') {
        const items = o.itemListElement;
        expect(items.length).toBeGreaterThanOrEqual(2);
        items.forEach((it: any, i: number) => { expect(it.position).toBe(i + 1); expect(it.name).toBeTruthy(); if (i < items.length - 1) expect(it.item).toMatch(/^https:\/\//); });
      }
      if (t === 'FAQPage') for (const q of o.mainEntity) { expect(q['@type']).toBe('Question'); expect(q.name).toBeTruthy(); expect(q.acceptedAnswer.text).toBeTruthy(); }
    }
  });

  test('round trip: each copied <script> block pasted into the linter comes back clean', async ({ page }) => {
    await page.goto(URL);
    for (const t of TYPES) {
      await chooseType(page, t);
      await page.getByTestId('copy').click();
      await expect(page.getByTestId('copied')).toContainText('<script> block');
      const block: string = await page.evaluate(() => (window as any).__schema.state.copied);
      expect(block.startsWith('<script type="application/ld+json">\n')).toBe(true);
      expect(block.endsWith('\n</script>')).toBe(true);
      await page.getByTestId('lint-input').fill(block);
      await page.getByTestId('lint-run').click();
      await expect(page.getByTestId('lint-summary')).toHaveText(`0 errors · 0 warnings · ${t === 'FAQPage' ? '1 note' : '0 notes'}`);
      // and the JSON inside the block is exactly the builder's object
      const inner = block.slice(block.indexOf('\n') + 1, block.lastIndexOf('\n'));
      expect(JSON.parse(inner)).toEqual(await page.evaluate(() => (window as any).__schema.state.obj));
    }
    // the "Send to linter" button does the same in one click
    await chooseType(page, 'Event');
    await page.getByTestId('to-lint').click();
    await expect(page.getByTestId('lint-input')).toBeFocused();
    await expect(page.getByTestId('lint-summary')).toHaveText('0 errors · 0 warnings · 0 notes');
  });

  test('parse errors are reported on the right line', async ({ page }) => {
    await page.goto(URL);
    const base = '{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Quill & Kettle",\n  "url": "https://quill-and-kettle.example/"\n}';
    const cases: { name: string; src: string; at: (s: string) => number; msg: RegExp }[] = [
      { name: 'trailing comma', src: base.replace('example/"\n}', 'example/",\n}'), at: (s) => s.indexOf('example/",') + 9, msg: /trailing comma/ },
      { name: 'missing comma', src: base.replace('Kettle",', 'Kettle"'), at: (s) => s.indexOf('"url"'), msg: /is a comma missing/ },
      { name: 'single quotes', src: base.replace('"Quill & Kettle"', "'Quill & Kettle'"), at: (s) => s.indexOf("'Quill"), msg: /double quotes/ },
      { name: 'unquoted key', src: base.replace('"url"', 'url'), at: (s) => s.indexOf('url:'), msg: /property names must be in double quotes/ },
      { name: 'comment', src: base.replace('  "name"', '  // brand name\n  "name"'), at: (s) => s.indexOf('// brand'), msg: /comments/ },
      { name: 'line break in string', src: base.replace('Quill & Kettle', 'Quill &\nKettle'), at: (s) => s.indexOf('&\n') + 1, msg: /line break/ },
    ];
    for (const c of cases) {
      const r = await lint(page, c.src);
      const p = pick(r, 'parse');
      expect(p, c.name).toHaveLength(1);
      expect(p[0].line, c.name).toBe(lineOf(c.src, c.at(c.src)));
      expect(p[0].msg, c.name).toMatch(c.msg);
    }
    // unclosed object: reported at the end, naming the line where it opened
    const open = base.replace(/\n}$/, '\n');
    const r = await lint(page, open);
    expect(pick(r, 'parse')[0].msg).toMatch(/opened on line 1 is never closed/);
    // through the UI, with the column too
    await page.getByTestId('lint-input').fill(cases[1].src);
    await page.getByTestId('lint-run').click();
    const li = page.getByTestId('lint-issues').getByTestId('issue');
    await expect(li).toHaveAttribute('data-line', '5');
    await expect(li).toContainText('Parse error at line 5, column 3');
  });

  test('the broken example: unknown @type with a suggestion, a price with a currency symbol and a lower-case currency, each on its own line', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('lint-sample').click();
    const src = await page.getByTestId('lint-input').inputValue();
    const r = await page.evaluate(() => (window as any).__schema.state.lintResult);
    const u = pick(r, 'unknown-type');
    expect(u).toHaveLength(1);
    expect(u[0].line).toBe(lineOf(src, src.indexOf('"Prodcut"')));
    expect(u[0].msg).toContain('Did you mean "Product"?');
    expect(pick(r, 'bad-price')[0].line).toBe(lineOf(src, src.indexOf('"$649.00"')));
    expect(pick(r, 'bad-currency')[0].line).toBe(lineOf(src, src.indexOf('"usd"')));
    await expect(page.getByTestId('lint-summary')).toHaveText('3 errors · 3 warnings · 0 notes');
    await expect(page.locator('#l-issues [data-code="unknown-type"]')).toContainText('line 4');
    // other misspellings get sensible suggestions too
    for (const [bad, good] of [['LocalBuisness', 'LocalBusiness'], ['BreadCrumbList', 'BreadcrumbList'], ['FAQpage', 'FAQPage']]) {
      const x = await lint(page, `{"@context":"https://schema.org","@type":"${bad}"}`);
      expect(pick(x, 'unknown-type')[0].msg).toContain(`Did you mean "${good}"?`);
    }
  });

  test('missing required properties are errors at the line where the object starts; recommended ones are warnings', async ({ page }) => {
    await page.goto(URL);
    const ev = '{\n  "@context": "https://schema.org",\n  "@type": "Event",\n  "name": "Harbor Lights Night Ride",\n  "location": {\n    "@type": "Place",\n    "name": "The pier"\n  }\n}';
    const r = await lint(page, ev);
    const req = pick(r, 'missing-required');
    expect(req.map((i) => [i.line, i.msg])).toEqual([
      [1, 'Event is missing the required property "startDate".'],
      [5, 'Place is missing the required property "address".'],
    ]);
    expect(pick(r, 'missing-recommended').every((i) => i.level === 'warning' && i.line === 1)).toBe(true);
    const prod = '{"@context":"https://schema.org","@type":"Product","name":"Pannier","image":"https://x.example/p.jpg",\n"offers":\n  {"@type":"Offer","price":39.5}}';
    const rp = await lint(page, prod);
    expect(pick(rp, 'missing-required').map((i) => [i.line, i.msg])).toEqual([[3, 'Offer is missing the required property "priceCurrency".']]);
    const lb = await lint(page, '{"@context":"https://schema.org","@type":"Bakery","name":"Crumb & Co"}');
    expect(pick(lb, 'missing-required').map((i) => i.msg)).toEqual(['Bakery is missing the required property "address".']);
    const noCtx = await lint(page, '{"@type":"Person","name":"A. Example"}');
    expect(pick(noCtx, 'context')).toHaveLength(1);
    // breadcrumbs: only the last ListItem may leave out "item"
    const bc = (items: string) => `{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[\n${items}\n]}`;
    const good = await lint(page, bc('{"@type":"ListItem","position":1,"name":"Home","item":"https://x.example/"},\n{"@type":"ListItem","position":2,"name":"Here"}'));
    expect(good.issues).toEqual([]);
    const bad = await lint(page, bc('{"@type":"ListItem","position":1,"name":"Home"},\n{"@type":"ListItem","position":2,"name":"Here"}'));
    expect(pick(bad, 'missing-required').map((i) => [i.line, i.msg])).toEqual([[2, 'ListItem 1 is missing "item" (only the last breadcrumb may leave it out).']]);
    // FAQ: a question without an answer
    const faq = await lint(page, '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Open Sundays?"}]}');
    expect(pick(faq, 'missing-required').map((i) => i.msg)).toEqual(['Question is missing the required property "acceptedAnswer".']);
    expect(pick(faq, 'faq-limited')).toHaveLength(1);
  });

  test('wrong value types: prices, currencies, dates, positions, GTIN check digits and enumerations', async ({ page }) => {
    await page.goto(URL);
    const offer = (price: string, cur = '"USD"') => `{"@context":"https://schema.org","@type":"Offer","price":${price},"priceCurrency":${cur},"availability":"https://schema.org/InStock","itemCondition":"https://schema.org/NewCondition","url":"https://x.example/o"}`;
    for (const [p, ok] of [['19.99', true], ['"19.99"', true], ['0', true], ['"$19.99"', false], ['"1,299.00"', false], ['"19,99"', false], ['"19.99 USD"', false], ['-5', false]] as const) {
      expect(pick(await lint(page, offer(p)), 'bad-price').length === 0, p).toBe(ok);
    }
    for (const [c, ok] of [['"EUR"', true], ['"usd"', false], ['"$"', false], ['"US Dollar"', false]] as const) {
      expect(pick(await lint(page, offer('10', c)), 'bad-currency').length === 0, c).toBe(ok);
    }
    const ev = (d: string) => `{"@context":"https://schema.org","@type":"Event","name":"x","startDate":${d},"location":{"@type":"Place","name":"p","address":"1 Pier St"}}`;
    for (const [d, ok] of [['"2026-12-05"', true], ['"2026-12-05T18:30:00-05:00"', true], ['"2026-12-05T18:30Z"', true], ['"Dec 5, 2026"', false], ['"2026-13-05"', false], ['"05/12/2026"', false]] as const) {
      expect(pick(await lint(page, ev(d)), 'bad-date').length === 0, d).toBe(ok);
    }
    // GTINs: check digits computed here; 4006381333931 is a widely published valid EAN-13
    expect(gs1('400638133393')).toBe(1);
    expect(gs1('061414100003')).toBe(6);
    const gt = (g: string) => lint(page, `{"@context":"https://schema.org","@type":"Brand","name":"b","gtin13":"${g}"}`);
    expect(pick(await gt('4006381333931'), 'bad-gtin')).toHaveLength(0);
    expect(pick(await gt('4006381333932'), 'bad-gtin')).toHaveLength(1);
    expect(pick(await gt('40063813339'), 'bad-gtin')).toHaveLength(1);
    const pos = await lint(page, '{"@context":"https://schema.org","@type":"ListItem","name":"a","position":"1"}');
    expect(pick(pos, 'bad-position')).toHaveLength(1);
    const en = await lint(page, offer('10').replace('https://schema.org/InStock', 'In stock'));
    expect(pick(en, 'bad-enum').map((i) => i.level)).toEqual(['warning']);
    const url = await lint(page, '{"@context":"https://schema.org","@type":"Organization","name":"n","url":"/about","logo":"https://x.example/l.png","sameAs":["https://a.example/x","twitter.com/x"]}');
    expect(pick(url, 'bad-url').map((i) => i.msg)).toEqual(['url "/about" should be an absolute URL.', 'sameAs "twitter.com/x" should be an absolute URL.']);
  });

  test('the builder validates live: blanking a required field raises an error, and the script block escapes "</script>"', async ({ page }) => {
    await page.goto(URL);
    await chooseType(page, 'Event');
    await page.getByTestId('f-name').fill('');
    await expect(page.locator('#b-issues [data-code="missing-required"]')).toHaveText(/Event is missing the required property "name"/);
    await expect(page.getByTestId('builder-summary')).toContainText('1 error ·');
    await page.getByTestId('f-name').fill('Harbor Lights Night Ride');
    await expect(page.getByTestId('builder-summary')).toContainText('0 errors');
    for (const k of ['street', 'locality', 'region', 'postal', 'country']) await page.getByTestId(`f-${k}`).fill('');
    await expect(page.locator('#b-issues [data-code="missing-required"]')).toHaveText(/Place is missing the required property "address"/);
    // values survive switching types and coming back
    await chooseType(page, 'LocalBusiness');
    await page.getByTestId('f-subtype').selectOption('Bakery');
    await expect(page.getByTestId('output')).toContainText('"@type": "Bakery"');
    await page.getByTestId('f-name').fill('Crumb </script><b>Co');
    await page.getByTestId('copy').click();
    const block: string = await page.evaluate(() => (window as any).__schema.state.copied);
    expect(block.match(/<\/script/gi)).toHaveLength(1);
    expect(block).toContain('Crumb \\u003c/script>\\u003cb>Co');
    expect(JSON.parse(block.slice(block.indexOf('\n') + 1, block.lastIndexOf('\n'))).name).toBe('Crumb </script><b>Co');
    await chooseType(page, 'Event');
    await expect(page.getByTestId('f-street')).toHaveValue('');
  });

  test('pasted pages: several ld+json blocks, @graph, and line numbers that count the surrounding HTML', async ({ page }) => {
    await page.goto(URL);
    const html = [
      '<!doctype html>',
      '<html><head>',
      '<script src="/app.js"></script>',
      '<script type="application/ld+json">',
      '{"@context":"https://schema.org","@graph":[',
      '  {"@type":"WebSite","name":"Quill & Kettle","url":"https://quill-and-kettle.example/"},',
      '  {"@type":"Organizaton","name":"Quill & Kettle"}',
      ']}',
      '</script>',
      '<script type="application/ld+json">',
      '{"@context":"https://schema.org","@type":"Product","name":"Tea tin",',
      ' "image":"https://quill-and-kettle.example/tin.jpg",',
      ' "offers":{"@type":"Offer","price":"£12","priceCurrency":"GBP"}}',
      '</script>',
      '</head></html>',
    ].join('\n');
    const r = await lint(page, html);
    expect(pick(r, 'unknown-type').map((i) => [i.line, i.msg])).toEqual([[7, 'Unknown @type "Organizaton". Did you mean "Organization"?']]);
    expect(pick(r, 'bad-price').map((i) => i.line)).toEqual([13]);
    expect(pick(r, 'parse')).toHaveLength(0);
    const none = await lint(page, '<p>no structured data</p><script>var a = 1;</script>');
    expect(pick(none, 'no-block')).toHaveLength(1);
    await page.getByTestId('lint-input').fill(html);
    await page.getByTestId('lint-run').click();
    await expect(page.locator('#l-issues [data-code="bad-price"]')).toHaveAttribute('data-line', '13');
  });

  test("the rules table matches Google's required properties, cites its sources, and the FAQ restriction is explained", async ({ page }) => {
    await page.goto(URL);
    for (const t of TYPES) {
      const row = page.locator(`#rules-body tr[data-type="${t}"]`);
      await expect(row).toHaveCount(1);
      const req = (await row.locator('td').nth(0).textContent())!.trim();
      expect(req, t).toBe(REQUIRED[t].length ? REQUIRED[t].join(', ') : '—');
      await expect(row.locator('a')).toHaveAttribute('href', /developers\.google\.com\/search\/docs\/appearance\/structured-data\/|schema\.org\/Person/);
    }
    await expect(page.locator('#rules-body tr[data-type="Offer"] td').nth(0)).toHaveText('price, priceCurrency');
    await expect(page.getByTestId('faq-note')).toBeHidden();
    await chooseType(page, 'FAQPage');
    await expect(page.getByTestId('faq-note')).toBeVisible();
    await expect(page.getByTestId('faq-note')).toContainText('Since August 2023');
    await expect(page.locator('#b-issues [data-code="faq-limited"]')).toHaveAttribute('data-level', 'info');
  });

  test('keyboard: arrow keys move through the type radios and rebuild the form', async ({ page }) => {
    await page.goto(URL + '?type=Person');
    await expect(page.getByTestId('type-Person')).toBeChecked();
    await expect(page.getByTestId('f-jobTitle')).toBeVisible();
    await page.getByTestId('type-Person').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('type-Product')).toBeChecked();
    await expect(page.getByTestId('f-price')).toHaveValue('649.00');
    await expect(page.getByTestId('output')).toContainText('"@type": "Offer"');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('type-Organization')).toBeChecked();
    await expect(page.getByTestId('f-logo')).toBeVisible();
  });
});
