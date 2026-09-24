import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const URL = '/lab/080-scriptorium.html?seed=21';
const S = (page: Page) => page.evaluate(() => (window as any).__scriptorium.state);
const sig = (page: Page) => page.evaluate(() => (window as any).__scriptorium.baseSignature());

test.describe('080 Scriptorium', () => {
  test('typing a letter illuminates it and brings the matching Latin text', async ({ page }) => {
    test.setTimeout(60_000); // re-renders the page once per text in the collection
    await page.goto(URL);
    let s = await S(page);
    expect(s.letter).toBe('P');
    expect(s.textLines[0]).toMatch(/^ATER noster,/);           // the rest of the first word, rubricated in capitals
    await page.getByTestId('letter').fill('a');
    await expect(page.getByTestId('letter')).toHaveValue('A');
    await expect(page.getByTestId('text')).toHaveValue('ave');
    await expect(page.getByTestId('note')).toHaveText('A: Ave Maria follows the initial.');
    s = await S(page);
    expect(s.textLines[0]).toMatch(/^VE Maria,/);                 // only the first word is rubricated
    expect(s.textLines.join(' ')).toContain('Dominus tecum');
    await expect(page.getByTestId('page')).toHaveAttribute('aria-label', /Illuminated initial A .* Followed by Ave Maria\./);
    // a letter no text begins with: shown as a specimen
    await page.getByTestId('letter').fill('x');
    await expect(page.getByTestId('note')).toContainText('No text in the collection begins with X');
    s = await S(page);
    expect(s.noMatch).toBe(true);
    expect(s.textLines.join(' ')).toContain('Littera X.');
    // not a letter: refused
    await page.getByTestId('letter').fill('7');
    await expect(page.getByTestId('letter')).toHaveValue('X');
    await expect(page.getByTestId('note')).toHaveText('Only the letters A to Z can be illuminated here.');
    // every text in the collection starts with the letter its option advertises, and choosing one sets the initial
    const opts = await page.getByTestId('text').locator('option').evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent![0]]));
    expect(opts.length).toBeGreaterThanOrEqual(18);
    for (const [value, letter] of opts) {
      await page.getByTestId('text').selectOption(value);
      await expect(page.getByTestId('letter')).toHaveValue(letter);
    }
  });

  test('variations are seeded: same seed and letter give the same page, a new variation differs', async ({ page }) => {
    await page.goto('/lab/080-scriptorium.html?seed=21&letter=B');
    const a = { sig: await sig(page), s: await S(page) };
    expect(a.s.letter).toBe('B');
    await page.reload();
    expect(await sig(page)).toBe(a.sig);
    expect((await S(page)).drolleries).toEqual(a.s.drolleries);
    await page.getByTestId('vary').click();
    const b = await S(page);
    expect(b.seed).not.toBe(21);
    expect(b.letter).toBe('B');
    await expect(page.getByTestId('seed')).toHaveText(`seed ${b.seed} · letter B`);
    expect(await sig(page)).not.toBe(a.sig);
    // the address remembers the variation
    expect(page.url()).toContain(`seed=${b.seed}`);
    // drolleries: two to four distinct creatures, always in the margins, never in the text block
    for (const seed of [1, 2, 3, 4, 5]) {
      await page.goto(`/lab/080-scriptorium.html?seed=${seed}&letter=M`);
      const d = (await S(page)).drolleries;
      expect(d.length).toBeGreaterThanOrEqual(2);
      expect(d.length).toBeLessThanOrEqual(4);
      expect(new Set(d.map((x: any) => x.kind)).size).toBe(d.length);
      for (const x of d) {
        expect(['snail', 'hare', 'bird', 'grotesque']).toContain(x.kind);
        expect(x.y > 1000 || x.x < 90 || x.y < 100).toBe(true);
      }
    }
  });

  test('pigment palettes colour the ground; the royal palette gilds the letter', async ({ page }) => {
    await page.goto(URL);
    const gold = () => page.evaluate(() => (window as any).__scriptorium.goldCoverage());
    const lapisGold = await gold();
    for (const k of ['lapis', 'vermilion', 'verdigris', 'royal']) {
      await page.getByTestId(`palette-${k}`).click();
      await expect(page.getByTestId(`palette-${k}`)).toHaveAttribute('aria-pressed', 'true');
      // most of the field inside the gold frame is the palette's ground pigment
      expect(await page.evaluate(() => (window as any).__scriptorium.groundShare())).toBeGreaterThan(0.35);
    }
    expect(await gold()).toBeGreaterThan(lapisGold * 1.3);   // the gold letter adds to the gilded area
    // the frame itself is burnished gold: warm, bright, with red above blue
    const box = await page.evaluate(() => (window as any).__scriptorium.box);
    const [r, g, b] = await page.evaluate(([x, y]) => (window as any).__scriptorium.basePixel(x, y), [box.x + 8, box.y + box.size / 2]);
    expect(r).toBeGreaterThan(b + 50);
    expect(g).toBeGreaterThan(b);
  });

  test('vines interlace and carry acanthus leaves across letters and seeds', async ({ page }) => {
    await page.goto(URL);
    let crossings = 0;
    for (const L of ['D', 'O', 'S', 'T']) {
      await page.getByTestId('letter').fill(L);
      const s = await S(page);
      expect(s.vines).toBeGreaterThanOrEqual(4);
      expect(s.leaves).toBeGreaterThan(20);
      expect(s.bezants).toBeGreaterThan(0);
      crossings += s.crossings;
    }
    expect(crossings).toBeGreaterThan(0);
  });

  test('burnished gold shimmers over time unless motion is reduced; PNG export', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-03-01T09:00:00') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-03-01T09:00:01'));
    const shown = () => page.evaluate(() => (window as any).__scriptorium.shownSignature());
    await expect(page.getByTestId('shimmer')).toBeChecked();
    // sample the displayed canvas across one sweep of light: it must not stay the same
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) { await page.clock.runFor(400); seen.add(await shown()); }
    expect(seen.size).toBeGreaterThan(2);
    await page.getByTestId('shimmer').uncheck();
    await expect(page.getByTestId('note')).toHaveText('The gold is still.');
    await page.clock.runFor(100);
    const still = await shown();
    await page.clock.runFor(900);
    expect(await shown()).toBe(still);
    const dlP = page.waitForEvent('download');
    await page.getByTestId('export').click();
    const dl = await dlP;
    expect(dl.suggestedFilename()).toBe('initial-P-21.png');
    expect([...readFileSync(await dl.path()).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test('reduced motion starts with the gold still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await expect(page.getByTestId('shimmer')).not.toBeChecked();
    expect((await S(page)).shimmer).toBe(false);
  });
});
