import { test, expect, type Page } from '@playwright/test';

const ms = async (page: Page, id: string) => Number(await page.getByTestId(id).getAttribute('data-ms'));

test.describe('Waterfall', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab/049-waterfall.html');
  });

  test('slower network profiles push FCP and LCP later, and are labelled approximate', async ({ page }) => {
    await expect(page.getByTestId('net-fast4g')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/Approximate simulation profiles/)).toBeVisible();
    const fast = { fcp: await ms(page, 'm-fcp'), lcp: await ms(page, 'm-lcp') };
    expect(fast.lcp).toBeGreaterThanOrEqual(fast.fcp);

    await page.getByTestId('net-slow4g').click();
    await expect(page.getByTestId('net-slow4g')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('net-fast4g')).toHaveAttribute('aria-checked', 'false');
    const slow = { fcp: await ms(page, 'm-fcp'), lcp: await ms(page, 'm-lcp') };
    await page.getByTestId('net-g3').click();
    const g3 = { fcp: await ms(page, 'm-fcp'), lcp: await ms(page, 'm-lcp') };
    expect(slow.fcp).toBeGreaterThan(fast.fcp);
    expect(g3.fcp).toBeGreaterThan(slow.fcp);
    expect(g3.lcp).toBeGreaterThan(slow.lcp);
    // on 3G the 2.5 s LCP budget is blown and the metric turns red
    await expect(page.getByTestId('m-lcp')).toHaveAttribute('data-over', 'true');
    await expect(page.getByTestId('budget-lcp')).toHaveAttribute('data-over', 'true');
    await expect(page.getByTestId('live')).toContainText('3G: FCP');
  });

  test('turning compression off inflates JS past its budget; a raised budget clears it and persists', async ({ page }) => {
    const bytesOn = Number(await page.getByTestId('m-bytes').getAttribute('data-bytes'));
    await expect(page.getByTestId('budget-js')).toHaveAttribute('data-over', 'false');
    await expect(page.getByTestId('budget-js')).toHaveAttribute('data-used', '161.0');

    await page.getByTestId('tg-gzip').click();
    await expect(page.getByTestId('tg-gzip')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('budget-js')).toHaveAttribute('data-over', 'true');
    await expect(page.getByTestId('budget-js')).toHaveAttribute('data-used', '512.0'); // 62 + 310 + 140 KB raw
    await expect(page.getByTestId('budget-js')).toContainText('over by 342.0 KB');
    // photos are already-compressed formats; only the SVG logo grows (2 KB -> 6 KB)
    await expect(page.getByTestId('budget-img')).toHaveAttribute('data-used', '430.0');
    expect(Number(await page.getByTestId('m-bytes').getAttribute('data-bytes'))).toBeGreaterThan(bytesOn);

    // raising the budget is persisted immediately and clears the warning
    await page.getByTestId('budget-input-js').fill('600');
    await expect(page.getByTestId('budget-js')).toHaveAttribute('data-over', 'false');
    await page.reload();
    await expect(page.getByTestId('budget-input-js')).toHaveValue('600');
  });

  test('a render-blocking script owns the critical chain until it is deferred', async ({ page }) => {
    await page.getByTestId('net-slow4g').click();
    await page.getByTestId('tg-gzip').click();
    await expect(page.getByTestId('chain')).toHaveAttribute('data-ids', 'html vendor');
    await expect(page.getByTestId('row-vendor')).toHaveAttribute('data-critical', 'true');
    await expect(page.getByTestId('why')).toContainText('render-blocking script');
    await expect(page.getByTestId('row-main').locator('[data-exec="vendor"]')).toHaveAttribute('data-kind', 'sync');
    const fcpBlocked = await ms(page, 'm-fcp');

    await page.getByTestId('tg-defer').click();
    await expect(page.getByTestId('row-main').locator('[data-exec="vendor"]')).toHaveAttribute('data-kind', 'defer');
    await expect(page.getByTestId('row-vendor')).toHaveAttribute('data-critical', 'false');
    await expect(page.getByTestId('row-vendor')).toContainText('Low');
    await expect(page.getByTestId('chain')).toHaveAttribute('data-ids', 'html hero');
    expect(await ms(page, 'm-fcp')).toBeLessThan(fcpBlocked / 2);

    await page.getByTestId('tg-async').click();
    await expect(page.getByTestId('row-main').locator('[data-exec="analytics"]')).toHaveAttribute('data-kind', 'async');
  });

  test('preload starts the hero and font earlier and improves LCP', async ({ page }) => {
    await page.getByTestId('net-slow4g').click();
    const heroStart = Number(await page.getByTestId('row-hero').getAttribute('data-start'));
    const fontStart = Number(await page.getByTestId('row-font').getAttribute('data-start'));
    const htmlEnd = Number(await page.getByTestId('row-html').getAttribute('data-end'));
    expect(heroStart).toBe(htmlEnd); // found by the parser once the document has arrived
    const lcp = await ms(page, 'm-lcp');

    await page.getByTestId('tg-preload').click();
    const heroPre = Number(await page.getByTestId('row-hero').getAttribute('data-start'));
    expect(heroPre).toBeLessThan(heroStart);
    expect(Number(await page.getByTestId('row-font').getAttribute('data-start'))).toBeLessThan(fontStart);
    expect(await ms(page, 'm-lcp')).toBeLessThan(lcp);

    await page.getByTestId('row-hero').click();
    await expect(page.getByTestId('detail')).toContainText('preload hint');
    await expect(page.getByTestId('detail')).toContainText('img.fernbrook.example');
  });

  test('HTTP/1.1 opens extra connections; lazy-loading drops below-fold images', async ({ page }) => {
    await expect(page.getByTestId('m-req')).toHaveAttribute('data-conns', '4');
    await expect(page.getByTestId('row-vendor')).not.toHaveAttribute('data-segs', /tcp/);
    await page.getByTestId('tg-h2').click();
    expect(Number(await page.getByTestId('m-req').getAttribute('data-conns'))).toBeGreaterThan(4);
    // under HTTP/1.1 several same-origin requests pay their own TCP + TLS handshakes
    const www = ['css', 'vendor', 'app', 'logo', 'font'];
    let handshakes = 0;
    for (const id of www) if (/tcp tls/.test((await page.getByTestId(`row-${id}`).getAttribute('data-segs'))!)) handshakes++;
    expect(handshakes).toBeGreaterThanOrEqual(3);
    await page.getByTestId('tg-h2').click();

    await expect(page.getByTestId('budget-img')).toHaveAttribute('data-over', 'true');
    await page.getByTestId('tg-lazy').click();
    await expect(page.locator('.row[data-skipped="true"]')).toHaveCount(4);
    await expect(page.getByTestId('m-req')).toHaveAttribute('data-n', '9');
    await expect(page.getByTestId('budget-img')).toHaveAttribute('data-over', 'false');
    await page.getByTestId('row-p2').click();
    await expect(page.getByTestId('detail')).toContainText('loading="lazy"');
  });
});
