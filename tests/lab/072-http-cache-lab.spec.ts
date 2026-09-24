import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/072-http-cache-lab.html';
const SLUGS = ['app', 'profile', 'news', 'avatar', 'greeting', 'cart'];

async function req(page: Page, slug: string, opts: { mode?: 'normal' | 'reload' | 'hard'; lang?: string; offline?: boolean } = {}) {
  await page.getByTestId('req-res').selectOption(String(SLUGS.indexOf(slug)));
  await page.getByTestId('mode-' + (opts.mode || 'normal')).check();
  await page.getByTestId('req-lang').selectOption(opts.lang || 'en-US');
  await page.getByTestId('offline').setChecked(!!opts.offline);
  await page.getByTestId('send').click();
  return page.getByTestId('stamp');
}
const outcome = async (page: Page, slug: string, opts = {}) => (await req(page, slug, opts)).getAttribute('data-outcome');

test.describe('HTTP Cache Lab', () => {
  test('immutable bundle: miss, fresh hit, reload skipped, hard reload refetches', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('date')).toHaveText('Thu, 01 Jan 2026 09:00:00 GMT');
    expect(await outcome(page, 'app')).toBe('miss');
    await expect(page.getByTestId('res-headers').last()).toContainText('Cache-Control: max-age=31536000, immutable');
    await page.getByTestId('adv-1d').click();
    await expect(page.getByTestId('clock')).toHaveAttribute('data-t', '86400');
    expect(await outcome(page, 'app')).toBe('hit');
    expect(await outcome(page, 'app', { mode: 'reload' })).toBe('hit');
    await expect(page.getByTestId('stamp')).toContainText('immutable');
    // without immutable, a reload revalidates even a fresh copy
    await page.getByTestId('cc-app').fill('max-age=31536000');
    expect(await outcome(page, 'app', { mode: 'hard' })).toBe('hard');
    await expect(page.getByTestId('req-headers').first()).toContainText('Cache-Control: no-cache');
    expect(await outcome(page, 'app', { mode: 'reload' })).toBe('revalidated');
    await expect(page.getByTestId('req-headers').first()).toContainText('Cache-Control: max-age=0');
    await expect(page.getByTestId('req-headers').first()).toContainText('If-None-Match: "app-v1"');
  });

  test('no-cache revalidates every time; a new version turns 304 into 200', async ({ page }) => {
    await page.goto(URL);
    expect(await outcome(page, 'profile')).toBe('miss');
    await page.getByTestId('adv-10s').click();
    expect(await outcome(page, 'profile')).toBe('revalidated');
    await expect(page.getByTestId('req-headers')).toContainText('If-None-Match: "profile-v1"');
    await expect(page.getByTestId('res-headers')).toContainText('HTTP/1.1 304 Not Modified');
    await page.getByTestId('publish-profile').click();
    await expect(page.getByTestId('version-profile')).toHaveText('origin v2');
    expect(await outcome(page, 'profile')).toBe('changed');
    await expect(page.getByTestId('res-headers')).toContainText('ETag: "profile-v2"');
    // offline, no-cache forbids using the stored copy
    expect(await outcome(page, 'profile', { offline: true })).toBe('gateway');
    await expect(page.getByTestId('stamp')).toHaveText('504 Gateway Timeout');
  });

  test('heuristic freshness from Last-Modified, then If-Modified-Since', async ({ page }) => {
    await page.goto(URL);
    expect(await outcome(page, 'news')).toBe('miss');
    // published two hours before t=0, so 10 % gives 720 s
    await expect(page.getByTestId('state-news')).toHaveAttribute('data-lifetime', '720');
    await page.getByTestId('adv-5m').click();
    expect(await outcome(page, 'news')).toBe('hit');
    await page.getByTestId('adv-5m').click();
    await page.getByTestId('adv-5m').click();
    await expect(page.getByTestId('state-news')).toHaveAttribute('data-state', 'stale');
    expect(await outcome(page, 'news')).toBe('revalidated');
    await expect(page.getByTestId('req-headers')).toContainText('If-Modified-Since: Thu, 01 Jan 2026 07:00:00 GMT');
    await expect(page.getByTestId('req-headers')).not.toContainText('If-None-Match');
    // no validators at all: a stale copy can only be fetched again in full
    await page.getByTestId('lm-news').uncheck();
    await page.getByTestId('cc-news').fill('max-age=60');
    expect(await outcome(page, 'news', { mode: 'hard' })).toBe('hard');
    await page.getByTestId('adv-1h').click();
    expect(await outcome(page, 'news')).toBe('changed');
    await expect(page.getByTestId('stamp')).toContainText('no validator');
  });

  test('stale-while-revalidate, must-revalidate and offline', async ({ page }) => {
    await page.goto(URL);
    expect(await outcome(page, 'avatar')).toBe('miss');
    await page.getByTestId('adv-1m').click();
    await page.getByTestId('adv-1m').click(); // age 120: stale, inside the 300 s SWR window
    await expect(page.getByTestId('state-avatar')).toHaveAttribute('data-state', 'swr');
    expect(await outcome(page, 'avatar')).toBe('swr');
    await expect(page.getByTestId('exchange')).toContainText('Cache → origin (background)');
    await expect(page.getByTestId('state-avatar')).toHaveAttribute('data-state', 'fresh'); // freshened by the background 304
    await page.getByTestId('adv-5m').click();
    await page.getByTestId('adv-5m').click(); // age 600: beyond max-age + SWR
    expect(await outcome(page, 'avatar', { offline: true })).toBe('offline-stale');
    expect(await outcome(page, 'avatar')).toBe('revalidated');
    await page.getByTestId('cc-avatar').fill('max-age=60, stale-while-revalidate=300, must-revalidate');
    await page.getByTestId('publish-avatar').click();
    expect(await outcome(page, 'avatar', { mode: 'hard' })).toBe('hard');
    await page.getByTestId('adv-1m').click();
    await page.getByTestId('adv-1m').click();
    await expect(page.getByTestId('state-avatar')).toHaveAttribute('data-state', 'stale'); // must-revalidate disables SWR
    expect(await outcome(page, 'avatar', { offline: true })).toBe('gateway');
  });

  test('Vary keys variants by language; no-store never stores; the tour fills the log', async ({ page }) => {
    await page.goto(URL);
    expect(await outcome(page, 'greeting', { lang: 'en-US' })).toBe('miss');
    expect(await outcome(page, 'greeting', { lang: 'fr-FR' })).toBe('miss');
    expect(await outcome(page, 'greeting', { lang: 'en-US' })).toBe('hit');
    await expect(page.getByTestId('state-greeting')).toContainText('2 variants');
    await page.getByTestId('vary-greeting').selectOption('*');
    expect(await outcome(page, 'greeting', { mode: 'hard' })).toBe('hard');
    expect(await outcome(page, 'greeting')).toBe('miss');
    await expect(page.getByTestId('exchange')).toContainText('Vary: *');

    expect(await outcome(page, 'cart')).toBe('nostore');
    expect(await outcome(page, 'cart')).toBe('nostore');
    await expect(page.getByTestId('state-cart')).toHaveAttribute('data-state', 'none');

    await page.getByTestId('tour').click();
    await expect(page.getByTestId('log-row')).toHaveCount(17);
    const outs = await page.getByTestId('log-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-outcome')).reverse());
    expect(outs).toEqual(['miss', 'miss', 'miss', 'miss', 'miss', 'nostore', 'hit', 'revalidated', 'hit', 'nostore', 'swr', 'miss', 'hit', 'hit', 'revalidated', 'revalidated', 'revalidated']);
    await page.getByTestId('log-row').last().click(); // the first request of the tour
    await expect(page.getByTestId('why')).toContainText('/assets/app.3f9a1c.js at t = 0 s');
  });
});
