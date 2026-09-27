import { test, expect, Page } from '@playwright/test';

const URL = '/lab/150-serp-preview.html';
const ELL = ' …';

// The test measures text with its own canvas (same browser, same font stack), and wraps with its own greedy loop,
// so a bug in the page's fit() can't hide behind the page's own numbers.
async function measureAll(page: Page, texts: string[], size: number): Promise<number[]> {
  return page.evaluate(([ts, sz]) => {
    const c = document.createElement('canvas').getContext('2d')!;
    c.font = `${sz}px ${(window as any).__serp.FAMILY}`;
    return (ts as string[]).map((t) => c.measureText(t).width);
  }, [texts, size] as const);
}
async function linesNeeded(page: Page, text: string, px: number, size: number): Promise<number> {
  return page.evaluate(([t, p, sz]) => {
    const c = document.createElement('canvas').getContext('2d')!;
    c.font = `${sz}px ${(window as any).__serp.FAMILY}`;
    let n = 0; let line = '';
    for (const w of (t as string).split(' ')) {
      const cand = line ? line + ' ' + w : w;
      if (c.measureText(cand).width <= (p as number)) line = cand; else { n++; line = w; }
    }
    return n + (line ? 1 : 0);
  }, [text, px, size] as const);
}
const spans = (page: Page, id: string) => page.getByTestId(id).locator('span').allTextContents();
const issueIds = (page: Page) => page.getByTestId('issue').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));

test.describe('150 SERP & Social Preview', () => {
  test('truncation is by pixel width, not characters: 60 narrow characters fit, 60 wide ones do not', async ({ page }) => {
    await page.goto(URL);
    const narrow = 'Ill fill tilt lilt jilt ' .repeat(4).slice(0, 60).trim();
    const wide = 'MWM WOW MOM ' .repeat(6).slice(0, 60).trim();
    const [wn, ww] = await measureAll(page, [narrow, wide], 20);
    expect(wn).toBeLessThan(600);
    expect(ww).toBeGreaterThan(600);
    await page.getByTestId('title').fill(narrow);
    expect(await spans(page, 'desk-title')).toEqual([narrow]);
    await expect(page.getByTestId('title-count')).toContainText(`${narrow.length} characters · ${Math.round(wn)} px of ~600 px`);
    await expect(page.getByTestId('title-count')).not.toHaveClass(/over/);
    await page.getByTestId('title').fill(wide);
    const shown = (await spans(page, 'desk-title'))[0];
    expect(shown.endsWith(ELL)).toBe(true);
    expect((await measureAll(page, [shown], 20))[0]).toBeLessThanOrEqual(600);
    await expect(page.getByTestId('title-count')).toHaveClass(/over/);
    expect(await issueIds(page)).toContain('title-trunc');
  });

  test('desktop title sweep: the ellipsis appears exactly when the text is wider than 600 px, and longer titles never show more', async ({ page }) => {
    await page.goto(URL);
    const words = 'Handmade Walnut Cutting Boards and Serving Trays, Finished with Food-Safe Oil and Shipped Across the Pacific Northwest'.split(' ');
    const titles = words.map((_, i) => words.slice(0, i + 1).join(' '));
    const widths = await measureAll(page, titles, 20);
    const fits = await page.evaluate((ts) => ts.map((t) => (window as any).__serp.fit(t, (window as any).__serp.LAYOUT.desktop.title)), titles);
    let firstCut: string | null = null;
    for (let i = 0; i < titles.length; i++) {
      const f = fits[i];
      expect(f.lines).toHaveLength(1);
      expect(f.truncated, titles[i]).toBe(widths[i] > 600);
      const line: string = f.lines[0];
      expect((await measureAll(page, [line], 20))[0]).toBeLessThanOrEqual(600);
      if (!f.truncated) { expect(line).toBe(titles[i]); expect(line.includes('…')).toBe(false); continue; }
      const kept = line.slice(0, -ELL.length);
      expect(line.endsWith(ELL)).toBe(true);
      expect(titles[i].startsWith(kept + ' ')).toBe(true);          // cut at a word boundary, never mid-word
      if (firstCut === null) firstCut = kept; else expect(kept).toBe(firstCut); // more text in, same text shown
    }
    expect(firstCut).not.toBeNull();
    // the preview in the page shows the same thing
    await page.getByTestId('title').fill(titles[titles.length - 1]);
    expect(await spans(page, 'desk-title')).toEqual([firstCut + ELL]);
  });

  test('descriptions wrap to 2 desktop lines and 3 mobile lines, each within its width, cut only when they overflow', async ({ page }) => {
    await page.goto(URL);
    const short = 'Fresh sourdough and pastry, baked daily.';
    const long = 'Learn to bake a crackly, open-crumb sourdough loaf in our three-hour hands-on class. Small groups of eight, all ingredients included, and you take home your own starter, two loaves, a printed schedule for feeding the starter and a banneton to keep.';
    for (const text of [short, long]) {
      await page.getByTestId('desc').fill(text);
      for (const [id, px, maxLines] of [['desk-desc', 600, 2], ['mob-desc', 316, 3]] as const) {
        const lines = await spans(page, id);
        const need = await linesNeeded(page, text, px, 14);
        const cut = need > maxLines;
        expect(lines.length).toBe(Math.min(need, maxLines));
        for (const w of await measureAll(page, lines, 14)) expect(w, `${id} line width`).toBeLessThanOrEqual(px);
        expect(lines[lines.length - 1].endsWith(ELL), `${id} ellipsis for ${text.length} chars`).toBe(cut);
        const visible = lines.join(' ').replace(/ …$/, '');
        expect(text.startsWith(visible)).toBe(true);
      }
    }
    // the long one really is long enough to need cutting on both
    expect(await linesNeeded(page, long, 600, 14)).toBeGreaterThan(2);
    await expect(page.getByTestId('desk-metrics')).toContainText('description truncated');
    await expect(page.getByTestId('mob-metrics')).toContainText('description truncated');
  });

  test('extracting from pasted HTML: decoded title, collapsed description, canonical URL, h1 and Open Graph fields', async ({ page }) => {
    await page.goto(URL);
    await page.getByText('Paste HTML to extract these fields').click();
    await page.getByTestId('sample-html').click();
    await expect(page.getByTestId('title')).toHaveValue('Rye & Caraway Loaf — Larkspur Bakehouse');
    await expect(page.getByTestId('desc')).toHaveValue('A dense, tangy rye loaf with toasted caraway, baked every Friday. Order by Thursday noon.');
    await expect(page.getByTestId('url')).toHaveValue('https://larkspur-bakehouse.example/bread/rye-caraway');
    await expect(page.getByTestId('h1')).toHaveValue('Rye & Caraway Loaf — Larkspur Bakehouse');
    await expect(page.getByTestId('og-w')).toHaveValue('1080');
    await expect(page.getByTestId('twitter-card')).toHaveValue('');
    await expect(page.getByTestId('extract-msg')).toHaveText('Extracted 5 of 6 fields.');
    await expect(page.getByTestId('og-card')).toContainText('Our Friday rye & caraway loaf');     // og:title wins on the card
    await expect(page.getByTestId('crumb')).toHaveText('https://larkspur-bakehouse.example › bread › rye-caraway');
    // and HTML without a canonical leaves the URL alone; odd casing of the name attribute still works
    const url = await page.getByTestId('url').inputValue();
    await page.getByTestId('html').fill('<title> Only\n a   title </title><META NAME="Description" CONTENT="Upper-case meta">');
    await page.getByTestId('extract').click();
    await expect(page.getByTestId('title')).toHaveValue('Only a title');
    await expect(page.getByTestId('desc')).toHaveValue('Upper-case meta');
    await expect(page.getByTestId('url')).toHaveValue(url);
    await expect(page.getByTestId('extract-msg')).toContainText('no canonical, URL left as it was');
    const x = await page.evaluate(() => (window as any).__serp.extract('<meta property="og:image" content="https://a.example/i.png"><meta name="twitter:card" content="summary">'));
    expect([x.ogImage, x.card, x.title]).toEqual(['https://a.example/i.png', 'summary', '']);
  });

  test('Open Graph checks: missing og:image, and aspect ratios judged against about 1.91:1', async ({ page }) => {
    await page.goto(URL);
    const within = (w: number, h: number) => w / h >= 1.8 && w / h <= 2.05; // 1.91:1 with room for X's 2:1
    expect(1200 / 630).toBeCloseTo(1.905, 3);
    for (const [w, h] of [[1200, 630], [1200, 600], [1000, 1000], [1200, 300], [600, 315], [1080, 1350]]) {
      await page.getByTestId('og-w').fill(String(w));
      await page.getByTestId('og-h').fill(String(h));
      const ids = await issueIds(page);
      expect(ids.includes('og-ratio'), `${w}×${h}`).toBe(!within(w, h));
      if (!within(w, h)) await expect(page.locator('[data-id="og-ratio"]')).toContainText(`${w} × ${h} (${(w / h).toFixed(2)}:1)`);
    }
    await page.getByTestId('og-h').fill('');
    expect(await issueIds(page)).toContain('og-size-unknown');
    await page.getByTestId('og-image').fill('');
    const ids = await issueIds(page);
    expect(ids).toContain('no-og-image');
    expect(ids).not.toContain('og-size-unknown');
    await expect(page.getByTestId('og-img')).toHaveText('No og:image');
    await expect(page.locator('[data-id="no-og-image"]')).toHaveAttribute('data-level', 'error');
    await page.getByTestId('twitter-card').selectOption('');
    expect(await issueIds(page)).toContain('no-twitter-card');
  });

  test('a title that repeats the h1 is flagged as a note (ignoring case and spacing), and never as an error', async ({ page }) => {
    await page.goto(URL);
    expect(await issueIds(page)).not.toContain('title-h1-dup');
    await page.getByTestId('title').fill('Sourdough Basics Class');
    await page.getByTestId('h1').fill('  sourdough   BASICS class ');
    const dup = page.locator('[data-id="title-h1-dup"]');
    await expect(dup).toHaveAttribute('data-level', 'info');
    await expect(dup).toContainText('Not an error');
    await page.getByTestId('h1').fill('Sourdough Basics');
    await expect(dup).toHaveCount(0);
    // the default sample page has a clean bill of health apart from the long description
    await page.reload();
    expect(await issueIds(page)).toEqual(['desc-trunc']);
  });

  test('bulk mode: duplicate titles and descriptions are grouped exactly as an independent tally says', async ({ page }) => {
    await page.goto(URL);
    const pages = [
      { url: 'https://quill-and-kettle.example/', title: 'Quill & Kettle | Tea Room, Est. 2019', description: 'Loose-leaf tea, scones and "proper" sandwiches.' },
      { url: 'https://quill-and-kettle.example/menu', title: 'Menu | Quill & Kettle', description: 'Our menu, with prices.' },
      { url: 'https://quill-and-kettle.example/menu/lunch', title: 'MENU |  quill & kettle', description: 'Lunch, served 11 till 3.' },
      { url: 'https://quill-and-kettle.example/menu/tea', title: 'Menu | Quill & Kettle', description: 'Our menu, with prices.' },
      { url: 'https://quill-and-kettle.example/visit', title: 'Visit', description: '' },
    ];
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = ['title,url,description', ...pages.map((p) => [p.title, p.url, p.description].map(q).join(','))].join('\n');
    // the test's own tally
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const tally = (k: 'title' | 'description') => {
      const m = new Map<string, number[]>();
      pages.forEach((p, i) => { if (p[k]) m.set(norm(p[k]), [...(m.get(norm(p[k])) ?? []), i + 1]); });
      return [...m.values()].filter((g) => g.length > 1);
    };
    const tGroups = tally('title'); const dGroups = tally('description');
    expect(tGroups).toEqual([[2, 3, 4]]);
    expect(dGroups).toEqual([[2, 4]]);

    await page.getByTestId('tab-bulk').click();
    await page.getByTestId('csv').fill(csv);
    await page.getByTestId('bulk-run').click();
    const rows = page.getByTestId('bulk-row');
    await expect(rows).toHaveCount(5);
    for (let i = 0; i < pages.length; i++) {
      const flags = (await rows.nth(i).getAttribute('data-flags'))!.split(' ').filter(Boolean);
      expect(flags.includes('dup-title'), `row ${i + 1}`).toBe(tGroups.flat().includes(i + 1));
      expect(flags.includes('dup-desc'), `row ${i + 1}`).toBe(dGroups.flat().includes(i + 1));
      expect(flags.includes('no-desc')).toBe(!pages[i].description);
    }
    await expect(rows.nth(0)).toContainText('Quill & Kettle | Tea Room, Est. 2019'); // comma inside quotes kept
    const st = await page.evaluate(() => (window as any).__serp.state.bulk);
    expect(st.pages[0].desc).toBe('Loose-leaf tea, scones and "proper" sandwiches.'); // doubled quotes unescaped
    await expect(rows.nth(2)).toContainText('duplicate title (= row 2, 4)');
    await expect(page.getByTestId('bulk-summary')).toHaveText('5 pages · 3 share a title (1 group) · 2 share a description (1 group) · 0 titles likely cut');
  });

  test('bulk mode: the sample CSV flags a long title by its measured width, and a bad header is refused', async ({ page }) => {
    await page.goto(URL + '?mode=bulk');
    await expect(page.getByTestId('tab-bulk')).toHaveAttribute('aria-selected', 'true');
    const rows = page.getByTestId('bulk-row');
    await expect(rows).toHaveCount(6);
    const st = await page.evaluate(() => (window as any).__serp.state.bulk);
    const widths = await measureAll(page, st.pages.map((p: any) => p.title), 20);
    for (let i = 0; i < st.pages.length; i++) {
      const p = st.pages[i];
      expect(p.titlePx).toBe(Math.round(widths[i]));
      expect(p.flags.includes('trunc-title'), p.title).toBe(!!p.title && widths[i] > 600);
    }
    expect(st.pages[3].flags).toContain('trunc-title');
    expect(st.pages[0].flags).toContain('dup-desc');
    expect(st.dupTitleGroups).toEqual([[2, 3, 6]]);
    await page.getByTestId('csv').fill('page,heading\nhttps://x.example/,Hello');
    await page.getByTestId('bulk-run').click();
    await expect(page.getByTestId('csv-error')).toHaveText('The header row must name url, title and description.');
    await expect(rows).toHaveCount(0);
  });

  test('URL breadcrumbs, a URL error, and keyboard tabs', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('crumb')).toHaveText('https://larkspur-bakehouse.example › classes › sourdough-basics');
    await page.getByTestId('url').fill('https://www.larkspur-bakehouse.example/caf%C3%A9/menu?x=1');
    await expect(page.getByTestId('crumb')).toHaveText('https://www.larkspur-bakehouse.example › café › menu');
    await expect(page.getByTestId('desk')).toContainText('larkspur-bakehouse');
    await page.getByTestId('url').fill('larkspur.example/no-scheme');
    await expect(page.getByTestId('url-error')).toHaveText('Enter an absolute URL starting with http:// or https://');
    expect(await issueIds(page)).toContain('bad-url');
    await page.getByTestId('tab-single').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-bulk')).toBeFocused();
    await expect(page.getByTestId('tab-bulk')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('bulk-row').first()).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('title')).toBeVisible();
  });

  test('the page says what it approximates and cites its sources', async ({ page }) => {
    await page.goto(URL);
    const notes = page.getByTestId('notes');
    await expect(notes).toContainText('About 580–600 px is the commonly cited width');
    await expect(notes).toContainText('These are approximations');
    await expect(notes).toContainText('Google has said the meta keywords tag is ignored');
    await expect(notes).toContainText('Influencing your title links in search results');
    await expect(page.getByTestId('limits').locator('tbody tr')).toHaveCount(2);
    // the limits table and the page's layout constants agree
    const L = await page.evaluate(() => (window as any).__serp.LAYOUT);
    expect(L).toEqual({ desktop: { title: { px: 600, size: 20, lines: 1 }, desc: { px: 600, size: 14, lines: 2 } }, mobile: { title: { px: 316, size: 18, lines: 2 }, desc: { px: 316, size: 14, lines: 3 } } });
    await expect(page.getByTestId('limits')).toContainText('2 lines × 316 px at 18 px');
    await expect(page.getByTestId('issues')).toHaveAttribute('aria-live', 'polite');
  });
});
