import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('renders every project and live stats', async ({ page }) => {
    await page.goto('/');
    const total = await page.evaluate(() => (window as any).PROJECTS.length);
    await expect(page.getByTestId('card')).toHaveCount(total);
    await expect(page.getByTestId('results-count')).toContainText(`${total} of ${total}`);
    await expect(page.locator('[data-stat="tests"]')).not.toHaveText('–');
  });

  test('search narrows results, syncs to the URL, and shows an empty state', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('search').fill('playwright locator');
    await expect(page.getByTestId('card').first()).toContainText('Selector Gym');
    await expect(page).toHaveURL(/q=playwright\+locator/);

    await page.getByTestId('search').fill('zzzz-no-such-thing');
    await expect(page.getByTestId('card')).toHaveCount(0);
    await expect(page.getByTestId('empty')).toBeVisible();
    await page.getByTestId('clear').click();
    await expect(page.getByTestId('empty')).toBeHidden();
  });

  test('search state survives a reload via query string', async ({ page }) => {
    await page.goto('/?q=rainey');
    await expect(page.getByTestId('search')).toHaveValue('rainey');
    await expect(page.getByTestId('card').first()).toContainText(/Rainey/);
  });

  test('category filter chips are toggle buttons', async ({ page }) => {
    await page.goto('/');
    const chip = page.getByTestId('filters').getByRole('button', { name: /Client Work/ });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    const cards = page.getByTestId('card');
    for (const text of await cards.locator('.card__meta span').allTextContents()) expect(text).toBe('Client Work');
  });

  test('card thumbnails: square shots shown whole, wide shots fill the frame', async ({ page }) => {
    test.setTimeout(90_000); // scrolls through and waits on every lazy-loaded thumbnail
    await page.goto('/');
    const thumbs = page.getByTestId('grid').locator('.card__thumb:has(img)');
    const n = await thumbs.count();
    let square = 0, wide = 0;
    for (let i = 0; i < n; i++) {
      const t = thumbs.nth(i);
      await t.scrollIntoViewIfNeeded(); // thumbnails are lazy-loaded
      const img = t.locator('img');
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
      const ratio = await img.evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight);
      // Assert the rendered result, not just the class: a CSS specificity clash once left is-fit cards on cover.
      const fit = await img.evaluate((el) => getComputedStyle(el).objectFit);
      if (ratio < 1.2) {
        await expect(t).toHaveClass(/is-fit/);
        expect(fit, `square thumb #${i} object-fit`).toBe('contain');
        expect(await t.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('url(');
        square++;
      } else {
        await expect(t).not.toHaveClass(/is-fit/);
        expect(fit, `wide thumb #${i} object-fit`).toBe('cover');
        wide++;
      }
    }
    expect(square, 'square client screenshots exercised').toBeGreaterThan(0);
    expect(wide, 'wide screenshots exercised').toBeGreaterThan(0);
  });

  test('"/" focuses search on desktop', async ({ page, isMobile }) => {
    test.skip(isMobile, 'no physical keyboard shortcut on touch devices');
    await page.goto('/');
    await page.keyboard.press('/');
    await expect(page.getByTestId('search')).toBeFocused();
  });
});

test.describe('Website of the day', () => {
  test('is the same pick all day and changes at local midnight', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-01T09:00:00') });
    await page.goto('/');
    const morning = await page.getByTestId('wotd').getAttribute('data-id');

    await page.reload();
    await expect(page.getByTestId('wotd')).toHaveAttribute('data-id', morning!);

    await page.clock.setFixedTime(new Date('2026-10-01T23:59:00'));
    await page.reload();
    await expect(page.getByTestId('wotd')).toHaveAttribute('data-id', morning!);

    await page.clock.setFixedTime(new Date('2026-10-02T00:01:00'));
    await page.reload();
    await expect(page.getByTestId('wotd')).not.toHaveAttribute('data-id', morning!);
  });

  test('rotates through every eligible project without repeats', async ({ page }) => {
    test.setTimeout(90_000);
    // No reloads: jump the paused clock a day at a time and let the page's own 30s tick roll the pick over,
    // exactly as it would for a visitor who leaves the tab open past midnight.
    const start = new Date('2026-10-01T12:00:00').getTime();
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start);
    await page.goto('/');
    const poolSize = await page.evaluate(() => (window as any).PROJECTS.filter((p: any) => p.thumb).length);
    const wotd = page.getByTestId('wotd');
    const seen = new Set<string>([(await wotd.getAttribute('data-id'))!]);
    for (let d = 1; d < poolSize; d++) {
      const before = await wotd.getAttribute('data-id');
      await page.clock.setSystemTime(start + d * 86_400_000);
      await page.clock.runFor(30_000);
      await expect(wotd).not.toHaveAttribute('data-id', before!);
      seen.add((await wotd.getAttribute('data-id'))!);
    }
    expect(seen.size).toBe(poolSize);
  });

  test('square screenshots are shown whole, not cropped', async ({ page }) => {
    test.setTimeout(90_000); // walks day by day until the pick is a square screenshot
    await page.clock.install({ time: new Date('2026-10-01T12:00:00') });
    await page.goto('/');
    // Walk forward day by day until the pick is one of the square (800×800) client screenshots.
    const start = new Date('2026-10-01T12:00:00').getTime();
    for (let d = 0; d < 60; d++) {
      await page.clock.setFixedTime(new Date(start + d * 86_400_000));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('wotd-title')).not.toBeEmpty();
      const src = await page.getByTestId('wotd').locator('img').getAttribute('src');
      if (src?.startsWith('images/')) break;
    }
    const thumb = page.getByTestId('wotd-open');
    await expect(thumb).toHaveClass(/is-fit/);
    const img = await thumb.locator('img').evaluate((el: HTMLImageElement) => {
      // Rendered image box under object-fit: contain must sit entirely inside the frame.
      const s = Math.min(el.clientWidth / el.naturalWidth, el.clientHeight / el.naturalHeight);
      return { w: el.naturalWidth * s, h: el.naturalHeight * s, fw: el.clientWidth, fh: el.clientHeight, fit: getComputedStyle(el).objectFit };
    });
    expect(img.fit).toBe('contain');
    expect(img.h).toBeLessThanOrEqual(img.fh + 0.5);
    expect(img.w).toBeLessThanOrEqual(img.fw + 0.5);
  });

  test('shows a countdown to the next pick', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-01T21:30:00') });
    await page.goto('/');
    await expect(page.getByTestId('wotd-next')).toContainText('New pick in 2h 30m');
  });

  test('"Surprise me" swaps to a different site', async ({ page }) => {
    await page.goto('/');
    const before = await page.getByTestId('wotd').getAttribute('data-id');
    await page.getByTestId('wotd-shuffle').click();
    await expect(page.getByTestId('wotd')).not.toHaveAttribute('data-id', before!);
    await expect(page.getByTestId('wotd-date')).toHaveText('· bonus pick');
  });
});

test.describe('QA dialog', () => {
  test('opens with methodology + critique, switches to prompt, closes on Escape', async ({ page }) => {
    await page.goto('/?q=selector');
    await page.getByTestId('card').first().getByTestId('qa-btn').click();
    const modal = page.getByTestId('modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('qa-methodology').locator('li').first()).toBeVisible();
    await expect(modal.getByTestId('qa-critique')).not.toBeEmpty();

    await modal.getByRole('tab', { name: 'Prompt' }).click();
    await expect(modal.getByTestId('prompt-text')).not.toBeEmpty();

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('every project has QA methodology and a Playwright critique', async ({ page }) => {
    await page.goto('/');
    const missing = await page.evaluate(() =>
      (window as any).PROJECTS.filter((p: any) => !p.qa?.methodology?.length || !p.qa?.playwright).map((p: any) => p.id));
    expect(missing).toEqual([]);
  });
});

test('theme toggle persists across reloads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('homepage has no broken requests or console errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual([]);
});

test('renders the gallery even when Google Fonts never responds', async ({ page }) => {
  // Regression: a render-blocking font stylesheet once stalled HTML parsing, so the grid didn't exist yet.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, () => { /* never fulfil: simulate a hung CDN */ });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByTestId('grid').getByTestId('card').first()).toBeVisible({ timeout: 3000 });
  await expect(page.getByTestId('wotd-title')).not.toBeEmpty();
});

test('hero terminal ends on a visible "passed" line', async ({ page }) => {
  // Regression: the replay outgrew its fixed-height box and clipped the final line.
  await page.emulateMedia({ reducedMotion: 'reduce' }); // renders the final frame immediately
  await page.goto('/');
  const term = page.getByTestId('terminal');
  await expect(term).toContainText(/\d+ passed/);
  const clipped = await term.evaluate((el) => {
    const last = el.lastElementChild!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return last.bottom > box.bottom + 1 || last.top < box.top - 1;
  });
  expect(clipped).toBe(false);
});

test('homepage has no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
