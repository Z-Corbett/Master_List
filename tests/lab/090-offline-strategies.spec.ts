import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/090-offline-strategies.html';
const KEYS = ['cache-first', 'network-first', 'swr', 'network-only', 'cache-only'] as const;
async function last(page: Page) {
  const out: Record<string, { source: string; version: string; latency: string; behind: string }> = {};
  for (const k of KEYS) {
    const el = page.getByTestId('last-' + k);
    out[k] = { source: (await el.getAttribute('data-source'))!, version: (await el.getAttribute('data-version'))!, latency: (await el.getAttribute('data-latency'))!, behind: (await el.getAttribute('data-behind'))! };
  }
  return out;
}
const send = (page: Page) => page.getByTestId('send').click();

test.describe('Offline Strategies Lab', () => {
  test('online with a precached v1: who answers from where, and how fast', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('cache-network-first')).toHaveAttribute('data-v', '1');
    await send(page);
    const r = await last(page);
    expect(r['cache-first']).toEqual({ source: 'cache', version: '1', latency: '8', behind: '0' });
    expect(r['network-first']).toEqual({ source: 'network', version: '1', latency: '150', behind: '0' });
    expect(r['swr']).toEqual({ source: 'cache', version: '1', latency: '8', behind: '0' });
    expect(r['network-only']).toEqual({ source: 'network', version: '1', latency: '150', behind: '0' });
    expect(r['cache-only']).toEqual({ source: 'cache', version: '1', latency: '8', behind: '0' });
    await expect(page.getByTestId('clock')).toHaveText('0.5 s');
    await expect(page.getByTestId('log-row')).toHaveCount(1);
  });

  test('a server update: cache-first stays stale, SWR catches up one request later, network-first is fresh', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('publish').click();
    await expect(page.getByTestId('server-version')).toHaveText('v2');
    await send(page);
    let r = await last(page);
    expect(r['cache-first']).toMatchObject({ version: '1', behind: '1' });
    expect(r['swr']).toMatchObject({ source: 'cache', version: '1', behind: '1' });
    expect(r['network-first']).toMatchObject({ source: 'network', version: '2', behind: '0' });
    expect(r['cache-only']).toMatchObject({ version: '1', behind: '1' });
    await expect(page.getByTestId('cache-swr')).toHaveAttribute('data-v', '2'); // the background refresh landed (150 ms < 0.5 s)
    await send(page);
    r = await last(page);
    expect(r['swr']).toMatchObject({ source: 'cache', version: '2', behind: '0' });
    expect(r['cache-first']).toMatchObject({ version: '1', behind: '1' }); // never revalidates
  });

  test('offline: network-only fails, network-first falls back, an empty cache fails', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('offline').click();
    await expect(page.getByTestId('offline')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('net-state')).toHaveText('offline');
    await send(page);
    let r = await last(page);
    expect(r['network-only']).toMatchObject({ source: 'fail', latency: '30' });
    expect(r['network-first']).toMatchObject({ source: 'fallback', version: '1', latency: '38' });
    expect(r['cache-first'].source).toBe('cache');
    // start again with nothing precached
    await page.getByTestId('precache').click();
    await page.getByTestId('reset').click();
    await expect(page.getByTestId('log-row')).toHaveCount(0);
    await page.getByTestId('offline').click();
    await send(page);
    r = await last(page);
    for (const k of KEYS) expect(r[k].source, k).toBe('fail');
    await page.getByTestId('offline').click(); // back online: only cache-only still fails
    await send(page);
    r = await last(page);
    expect(r['cache-only'].source).toBe('fail');
    expect(r['cache-first'].source).toBe('network');
    await expect(page.locator('[data-testid="cmp-cache-only"]')).toHaveAttribute('data-fail', '2');
  });

  test('slow network: network-first gives up at 3 s and the late response still refreshes the cache', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('publish').click();
    await page.getByTestId('slow').click();
    await send(page);
    let r = await last(page);
    expect(r['network-first']).toMatchObject({ source: 'fallback', version: '1', latency: '3008' });
    expect(r['network-only']).toMatchObject({ source: 'network', version: '2', latency: '4000' });
    await expect(page.getByTestId('cache-network-first')).toHaveAttribute('data-v', '1');
    await page.getByTestId('wait-1').click();
    await page.getByTestId('wait-1').click();
    await expect(page.getByTestId('cache-network-first')).toHaveAttribute('data-v', '1'); // 2.5 s: still in flight
    await page.getByTestId('wait-1').click();
    await page.getByTestId('wait-1').click();
    await expect(page.getByTestId('cache-network-first')).toHaveAttribute('data-v', '2'); // arrived at 4.0 s
    // with the timeout switched off, network-first simply waits the full 4 s
    await page.getByTestId('nf-timeout').click();
    await send(page);
    r = await last(page);
    expect(r['network-first']).toMatchObject({ source: 'network', version: '2', latency: '4000' });
  });

  test('the tunnel commute scenario produces the expected comparison table', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('scenario-commute').click();
    await expect(page.getByTestId('log-row')).toHaveCount(6);
    await expect(page.getByTestId('clock')).toHaveText('23.0 s');
    const row = async (k: string) => page.getByTestId('cmp-' + k).evaluate((e) => ({ ok: e.getAttribute('data-ok'), fail: e.getAttribute('data-fail'), cache: e.getAttribute('data-cache'), net: e.getAttribute('data-net'), avg: e.getAttribute('data-avg'), stale: e.getAttribute('data-stale'), max: e.getAttribute('data-maxbehind') }));
    // worked by hand from the documented latencies: see the qa notes
    expect(await row('cache-first')).toEqual({ ok: '6', fail: '0', cache: '6', net: '0', avg: '8', stale: '4', max: '1' });
    expect(await row('network-first')).toEqual({ ok: '6', fail: '0', cache: '3', net: '3', avg: '589', stale: '2', max: '1' });
    expect(await row('swr')).toEqual({ ok: '6', fail: '0', cache: '6', net: '0', avg: '8', stale: '2', max: '1' });
    expect(await row('network-only')).toEqual({ ok: '4', fail: '2', cache: '0', net: '4', avg: '1113', stale: '0', max: '0' });
    expect(await row('cache-only')).toEqual({ ok: '6', fail: '0', cache: '6', net: '0', avg: '8', stale: '4', max: '1' });
    await expect(page.getByTestId('announce')).toHaveText('Scenario finished: 6 requests.');
  });
});
