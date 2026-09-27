import { test, expect, Page } from '@playwright/test';

const URL = '/lab/146-fiesta-medals.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__fiesta.state);
const C = (page: Page) => page.evaluate(() => (window as any).__fiesta.consts);

/** The valuation table as printed on the page, written out independently of the page's code. */
const TABLE = { shape: { round: 1, shield: 2, heart: 3, star: 3, texas: 5 } as Record<string, number>, icon: { guitar: 2, papel: 1, cascarones: 1, flowers: 1 } as Record<string, number> };
const worth = (d: any) => TABLE.shape[d.shape] + TABLE.icon[d.icon] + (d.stones ? 2 : 0) + (d.dangles ? 2 : 0) + (d.spinner ? 3 : 0);

/** Parse an "M x,y L x,y … Z" polygon path into points. */
const parsePoly = (d: string) => d.replace(/^M|Z$/g, '').split('L').map((p) => p.split(',').map(Number));
function mirrored(pts: number[][], cx: number, tol: number) {
  return pts.every(([x, y]) => pts.some(([u, v]) => Math.abs(u - (2 * cx - x)) < tol && Math.abs(v - y) < tol));
}

async function fresh(page: Page, url = URL) {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

test.describe('146 Fiesta Medal Maker', () => {
  test('designs are seeded: the same seed gives the same medal and SVG, other seeds differ, and every part is from the vocabulary', async ({ page }) => {
    await fresh(page);
    const c = await C(page);
    const s = await S(page);
    expect(s.seed).toBe(7);
    const [a, b] = await page.evaluate(() => [(window as any).__fiesta.design(7), (window as any).__fiesta.design(7)]);
    expect(a).toEqual(b);
    expect(s.design).toEqual(a);
    const svg1 = await page.evaluate(() => (window as any).__fiesta.svgString());
    await page.reload();
    expect(await page.evaluate(() => (window as any).__fiesta.svgString())).toBe(svg1);
    const many = await page.evaluate(() => Array.from({ length: 40 }, (_, i) => (window as any).__fiesta.design(i + 1)));
    expect(new Set(many.map((d: any) => JSON.stringify(d))).size).toBe(40);
    expect(new Set(many.map((d: any) => d.shape)).size).toBe(5);                 // all five shapes turn up
    for (const d of many) {
      expect(c.SHAPES).toContain(d.shape);
      expect(c.ICONS).toContain(d.icon);
      expect(d.stripes.length).toBeGreaterThanOrEqual(3);
      expect(d.stripes.length).toBeLessThanOrEqual(5);
      d.stripes.forEach((n: string, i: number) => { expect(Object.keys(c.PALETTE)).toContain(n); if (i) expect(n).not.toBe(d.stripes[i - 1]); });
    }
    await expect(page.getByTestId('seed')).toHaveText('seed 7');
    await page.getByTestId('reseed').click();
    const seed = (await S(page)).seed;
    expect(page.url()).toContain(`seed=${seed}`);
  });

  test('symmetric shapes are mirror images about the centre line, in the drawn SVG too; Texas is not', async ({ page }) => {
    await fresh(page);
    const c = await C(page);
    for (const shape of ['round', 'shield', 'star', 'heart']) {
      const pts = await page.evaluate((sh) => (window as any).__fiesta.outline(sh), shape);
      expect(mirrored(pts, c.CX, 1e-6), `${shape} outline`).toBe(true);
      await page.getByTestId('shape').selectOption(shape);
      await page.getByTestId('dangles').check();
      await page.getByTestId('stones').check();
      const d = await page.locator('#stage path[data-part=body]').getAttribute('d');
      expect(mirrored(parsePoly(d!), c.CX, 0.011), `${shape} drawn`).toBe(true);     // the SVG rounds to 2 decimals
      const dangles = await page.evaluate((sh) => (window as any).__fiesta.dangles(sh), shape);
      expect(mirrored(dangles, c.CX, 1e-6)).toBe(true);
      // each dangle hangs just below the outline, never inside the medal
      for (const [x, y] of dangles) expect(y).toBeGreaterThan(Math.max(...pts.filter((p: number[]) => Math.abs(p[0] - x) < 3).map((p: number[]) => p[1]), -1e9) - 3);
    }
    const stones = await page.evaluate(() => (window as any).__fiesta.stones());
    expect(mirrored(stones, c.CX, 1e-6)).toBe(true);
    for (const [x, y] of stones) expect(Math.hypot(x - c.CX, y - c.CY)).toBeCloseTo(c.DISC + 1, 9);
    const tx = await page.evaluate(() => (window as any).__fiesta.outline('texas'));
    expect(mirrored(tx, c.CX, 5)).toBe(false);
    // the Panhandle is at the top left and the southern tip at the bottom right of centre, as on a map
    const top = tx.reduce((a: number[], p: number[]) => (p[1] < a[1] ? p : a));
    const bottom = tx.reduce((a: number[], p: number[]) => (p[1] > a[1] ? p : a));
    expect(top[0]).toBeLessThan(c.CX);
    expect(bottom[0]).toBeGreaterThan(c.CX);
  });

  test('lettering sits on the circle: every glyph on radius r, reading clockwise, centred over the top', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('text').fill('¡VIVA FIESTA!');
    const L = await page.evaluate(() => (window as any).__fiesta.layout());
    expect(L.chars).toHaveLength('¡VIVA FIESTA!'.length);
    const [cx, cy] = L.centre;
    // screen angle in degrees, unwrapped so the top of the circle is −90
    const ang = ([x, y]: number[]) => { let a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI; if (a > 90) a -= 360; return a; };
    let prev = -Infinity;
    for (const ch of L.chars) {
      expect(Math.hypot(ch.start[0] - cx, ch.start[1] - cy)).toBeCloseTo(L.r, 0);
      expect(Math.hypot(ch.end[0] - cx, ch.end[1] - cy)).toBeCloseTo(L.r, 0);
      const a = ang(ch.start);
      expect(a).toBeGreaterThan(prev);                                              // clockwise, left to right over the top
      expect(ang(ch.end)).toBeGreaterThan(a);
      prev = a;
      // each glyph is turned to follow the tangent: rotation = angle + 90°
      expect(Math.abs(((ch.rot - ((a + ang(ch.end)) / 2 + 90)) % 360 + 540) % 360 - 180)).toBeLessThan(6);
    }
    const first = ang(L.chars[0].start), last = ang(L.chars.at(-1).end);
    expect((first + last) / 2).toBeCloseTo(-90, 0);
    expect(L.fontSize).toBe(15);                                                     // short text: full size
    // the arc length the browser measured matches the angle it spans on radius r
    expect(((last - first) * Math.PI) / 180 * L.r).toBeCloseTo(L.length, -1);
  });

  test('long lettering shrinks to fit its arc, and stays centred', async ({ page }) => {
    await fresh(page);
    const c = await C(page);
    const long = 'ABUELA APPROVED CONFETTI XYZ';
    await page.getByTestId('text').fill(long);
    const L = await page.evaluate(() => (window as any).__fiesta.layout());
    expect(L.chars).toHaveLength(28);
    expect(L.fontSize).toBeLessThan(15);
    const [cx, cy] = L.centre;
    const ang = ([x, y]: number[]) => { let a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI; if (a > 90) a -= 360; return a; };
    const span = ang(L.chars.at(-1).end) - ang(L.chars[0].start);
    expect(span).toBeLessThanOrEqual(c.ARC_LIMIT + 1);
    expect(span).toBeGreaterThan(c.ARC_LIMIT * 0.85);                                // shrunk just enough, not to a crumb
    expect(L.length).toBeLessThanOrEqual((c.TEXT_R * c.ARC_LIMIT * Math.PI) / 180 + 0.5);
    expect((ang(L.chars[0].start) + ang(L.chars.at(-1).end)) / 2).toBeCloseTo(-90, 0);
    await expect(page.getByTestId('text')).toHaveAttribute('maxlength', '28');
  });

  test('the design controls drive the medal: shape, icon and each bling layer', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('shape').selectOption('texas');
    await page.getByTestId('icon').selectOption('guitar');
    for (const k of ['stones', 'dangles', 'spinner']) await page.getByTestId(k).uncheck();
    const stage = page.getByTestId('stage');
    await expect(stage.locator('[data-part=stones]')).toHaveCount(0);
    await expect(stage.locator('[data-part=dangles]')).toHaveCount(0);
    await expect(stage.locator('[data-part=spinner]')).toHaveCount(0);
    await page.getByTestId('stones').check();
    await expect(stage.locator('[data-part=stones] circle')).toHaveCount(32);        // 16 stones, each with a glint
    await page.getByTestId('dangles').check();
    await expect(stage.locator('[data-part=dangles] path')).toHaveCount(3);
    await page.getByTestId('spinner').check();
    await expect(stage.locator('[data-part=spinner] path')).toHaveCount(12);
    const s = await S(page);
    expect(s.design).toMatchObject({ shape: 'texas', icon: 'guitar', stones: true, dangles: true, spinner: true });
    expect(s.values.design).toBe(5 + 2 + 2 + 2 + 3);
    await expect(stage.locator('svg')).toHaveAttribute('aria-label', /Texas-shaped medal .* with a guitar and rhinestones, dangles, a spinner/);
    await page.getByTestId('spin-toggle').click();
    await expect(page.getByTestId('spin-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(stage).toHaveClass(/paused/);
    const before = (await S(page)).design.stripes;
    await page.getByTestId('ribbon').click();
    const after = (await S(page)).design.stripes;
    await expect(page.getByTestId('stripes').locator('span')).toHaveCount(after.length);
    expect(after.length).toBeGreaterThanOrEqual(3);
    expect(typeof before[0]).toBe('string');
  });

  test('the sash persists in localStorage across reloads, and deleting a medal removes it for good', async ({ page }) => {
    await fresh(page);
    await expect(page.getByTestId('sash-count')).toHaveText('0');
    await expect(page.getByTestId('trade')).toBeDisabled();
    await page.getByTestId('text').fill('FIRST ONE');
    await page.getByTestId('pin').click();
    await page.getByTestId('shape').selectOption('heart');
    await page.getByTestId('text').fill('SECOND');
    await page.getByTestId('pin').click();
    await expect(page.getByTestId('sash-medal')).toHaveCount(2);
    await expect(page.getByTestId('status')).toContainText('2 of 12');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fiesta-sash-v1')!));
    expect(stored.map((d: any) => d.text)).toEqual(['FIRST ONE', 'SECOND']);
    expect(stored[1].shape).toBe('heart');
    await page.reload();
    await expect(page.getByTestId('sash-medal')).toHaveCount(2);
    expect((await S(page)).sash).toEqual(stored);
    await page.getByRole('button', { name: 'Remove medal 1: FIRST ONE' }).click();
    await expect(page.getByTestId('sash-medal')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Remove medal 1: SECOND' })).toBeFocused();
    await page.reload();
    await expect(page.getByTestId('sash-count')).toHaveText('1');
    expect((await S(page)).sash.map((d: any) => d.text)).toEqual(['SECOND']);
    await page.getByRole('button', { name: /Remove medal 1/ }).click();
    await expect(page.getByTestId('pin')).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('fiesta-sash-v1'))).toBe('[]');
    // corrupt storage is ignored, not fatal
    await page.evaluate(() => localStorage.setItem('fiesta-sash-v1', '{not json'));
    await page.reload();
    await expect(page.getByTestId('sash-count')).toHaveText('0');
  });

  test('trade logic: the page values medals by its published table, and the vendor swaps only within a point', async ({ page }) => {
    await fresh(page);
    // the rule, checked over many generated pairs against the table written in this spec
    const pairs = await page.evaluate(() => {
      const f = (window as any).__fiesta, out: any[] = [];
      for (let i = 1; i <= 30; i++) { const a = f.design(i), b = f.design(i + 100); out.push({ a, b, va: f.value(a), vb: f.value(b), ok: f.tradeOk(a, b) }); }
      return out;
    });
    let accepts = 0, declines = 0;
    for (const p of pairs) {
      expect(p.va).toBe(worth(p.a));
      expect(p.vb).toBe(worth(p.b));
      expect(p.ok).toBe(worth(p.a) >= worth(p.b) - 1);
      p.ok ? accepts++ : declines++;
    }
    expect(accepts).toBeGreaterThan(0);
    expect(declines).toBeGreaterThan(0);
    const s = await S(page);
    expect(s.vendor).toHaveLength(3);
    expect(s.values.vendor).toEqual(s.vendor.map(worth));
    expect(s.vendor[2]).toMatchObject({ spinner: true, dangles: true });             // the vendor always has one prize medal
    await expect(page.getByTestId('vendor-medal')).toHaveCount(3);
  });

  test('trading from the sash: a rich medal is accepted and swapped, a plain one is declined', async ({ page }) => {
    await fresh(page);
    // a Texas medal with everything on it is worth 14, more than anything a vendor stocks
    await page.getByTestId('shape').selectOption('texas');
    await page.getByTestId('icon').selectOption('guitar');
    for (const k of ['stones', 'dangles', 'spinner']) await page.getByTestId(k).check();
    await page.getByTestId('text').fill('BIG TEXAS');
    await page.getByTestId('pin').click();
    let s = await S(page);
    const prize = s.vendor[2];
    await page.getByTestId('vendor-medal').nth(2).click();
    await page.getByTestId('trade').click();
    await expect(page.getByTestId('trade-msg')).toContainText('Trato hecho');
    s = await S(page);
    expect(s.lastTrade).toMatchObject({ mine: 14, theirs: worth(prize), ok: true });
    expect(s.sash[0]).toEqual(prize);
    expect(s.vendor[2].text).toBe('BIG TEXAS');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fiesta-sash-v1')!)[0])).toEqual(prize);
    // now a plain round medal (1 + 1 = 2) for the Texas medal on her table: declined, nothing moves
    await page.getByTestId('shape').selectOption('round');
    await page.getByTestId('icon').selectOption('papel');
    for (const k of ['stones', 'dangles', 'spinner']) await page.getByTestId(k).uncheck();
    await page.getByTestId('text').fill('PLAIN');
    await page.getByTestId('pin').click();
    await page.getByTestId('offer').selectOption('1');
    await page.getByTestId('vendor-medal').nth(2).click();
    await page.getByTestId('trade').click();
    await expect(page.getByTestId('trade-msg')).toContainText('worth 14, yours only 2');
    s = await S(page);
    expect(s.lastTrade).toMatchObject({ mine: 2, theirs: 14, ok: false });
    expect(s.sash.map((d: any) => d.text)).toEqual([prize.text, 'PLAIN']);
    await page.getByTestId('next-vendor').click();
    const next = await S(page);
    expect(next.vendor.map((d: any) => d.text).join()).not.toBe(s.vendor.map((d: any) => d.text).join());
  });

  test('SVG export is a well-formed standalone file, even with markup characters in the lettering', async ({ page }) => {
    await fresh(page);
    await page.getByTestId('text').fill('A&B <3 "YO"');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-svg').click()]);
    expect(dl.suggestedFilename()).toBe('fiesta-medal-7.svg');
    const chunks: Buffer[] = [];
    for await (const ch of await dl.createReadStream()) chunks.push(ch as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const r = await page.evaluate((src) => {
      const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
      const root = doc.documentElement;
      const tp = doc.querySelector('textPath')!;
      const ref = tp.getAttribute('href')!.slice(1);
      return { err: doc.getElementsByTagName('parsererror').length, tag: root.localName, ns: root.namespaceURI, vb: root.getAttribute('viewBox'), text: tp.textContent, refOk: !!doc.getElementById(ref) && doc.getElementById(ref)!.localName === 'path' };
    }, text);
    expect(r).toEqual({ err: 0, tag: 'svg', ns: 'http://www.w3.org/2000/svg', vb: '0 0 300 420', text: 'A&B <3 "YO"', refOk: true });
    expect(text).toContain('A&amp;B &lt;3 &quot;YO&quot;');
    expect(text).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);                 // no external references
  });

  test('PNG export renders the SVG at 2× into a real PNG', async ({ page }) => {
    await fresh(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-png').click()]);
    expect(dl.suggestedFilename()).toBe('fiesta-medal-7.png');
    const chunks: Buffer[] = [];
    for await (const ch of await dl.createReadStream()) chunks.push(ch as Buffer);
    const png = Buffer.concat(chunks);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(600);                                          // IHDR width
    expect(png.readUInt32BE(20)).toBe(840);                                          // IHDR height
    await expect(page.getByTestId('status')).toContainText('fiesta-medal-7.png');
  });
});
