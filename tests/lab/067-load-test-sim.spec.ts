import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/067-load-test-sim.html';

async function finish(page: Page) {
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('summary')).toHaveAttribute('data-done', '1');
  return page.getByTestId('summary').evaluate((e) => {
    const d = (e as HTMLElement).dataset;
    return { total: +d.total!, errors: +d.errors!, p50: +d.p50!, p95: +d.p95!, p99: +d.p99!, peak: +d.peak!, workers: +d.workers!, rate: +d.rate! };
  });
}

test.describe('Load Test Simulator', () => {
  test('capacity and the saturation estimate follow the settings', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('capacity')).toHaveText('80'); // 8 workers ÷ 0.1 s
    await expect(page.getByTestId('nstar-val')).toHaveText('88'); // 8 × (0.1 + 1.0) ÷ 0.1
    await page.getByTestId('workers').fill('16');
    await expect(page.getByTestId('workers-out')).toHaveText('16');
    await expect(page.getByTestId('capacity')).toHaveText('160');
    await page.getByTestId('think').fill('0');
    await expect(page.getByTestId('nstar-val')).toHaveText('16');
    await page.getByTestId('profile-soak').click();
    await expect(page.getByTestId('duration')).toHaveText('900');
    await expect(page.getByTestId('profile-desc')).toContainText('15 simulated minutes');
  });

  test('a seeded ramp finds the knee near N* and is exactly reproducible', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    await expect(page.getByTestId('seed')).toHaveValue('7');
    const a = await finish(page);
    expect(a.total).toBeGreaterThan(5000);
    expect(a.p50).toBeLessThanOrEqual(a.p95);
    expect(a.p95).toBeLessThanOrEqual(a.p99);
    expect(a.p99).toBeLessThanOrEqual(1000); // successful responses can't outlast the 1000 ms timeout
    expect(a.peak).toBeGreaterThan(60);
    expect(a.peak).toBeLessThan(100); // capacity is 80 req/s; 5 s windows add a little noise
    const knee = Number(await page.getByTestId('knee').getAttribute('data-knee'));
    expect(knee).toBeGreaterThanOrEqual(60);
    expect(knee).toBeLessThanOrEqual(130);
    await expect(page.getByTestId('knee')).toContainText('Knee at about');

    await page.getByTestId('reset').click();
    await expect(page.getByTestId('sum-requests')).toHaveText('–');
    const b = await finish(page);
    expect(b).toEqual(a);
    await page.getByTestId('seed').fill('8');
    const c = await finish(page);
    expect(c.total).not.toBe(a.total);
  });

  test('more workers push the knee out and cut errors', async ({ page }) => {
    await page.goto(URL + '?seed=3');
    const eight = await finish(page);
    expect(eight.errors).toBeGreaterThan(0);
    await page.getByTestId('workers').fill('24');
    const many = await finish(page);
    expect(many.errors).toBe(0);
    expect(many.p95).toBeLessThan(eight.p95);
    await expect(page.getByTestId('knee')).toHaveAttribute('data-knee', 'none');
    await expect(page.getByTestId('knee')).toContainText('kept up');
  });

  test('a spike with a tight timeout errors; autoscaling adds workers under steady load', async ({ page }) => {
    await page.goto(URL + '?seed=11');
    await page.getByTestId('profile-spike').click();
    await page.getByTestId('timeout').fill('300');
    await page.getByTestId('peak').fill('250');
    const spike = await finish(page);
    expect(spike.errors).toBeGreaterThan(50);
    expect(spike.p99).toBeLessThanOrEqual(300);
    await expect(page.getByTestId('sum-error-rate')).toContainText('%');

    await page.getByTestId('profile-steady').click();
    await page.getByTestId('timeout').fill('2000');
    const fixed = await finish(page);
    expect(fixed.workers).toBe(8);
    await page.getByTestId('autoscale').check();
    const scaled = await finish(page);
    expect(scaled.workers).toBeGreaterThan(8);
    expect(scaled.total).toBeGreaterThan(fixed.total);
    await expect(page.getByTestId('sum-workers')).toHaveText(String(scaled.workers));
  });

  test('the live run advances with the clock and can be paused', async ({ page }) => {
    const t0 = new Date('2026-09-24T12:00:00Z');
    await page.clock.install({ time: t0 });
    await page.clock.pauseAt(t0);
    await page.goto(URL + '?seed=5');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('phase')).toHaveText('running');
    await page.clock.runFor(2000); // 2 real seconds at 10× ≈ 20 simulated seconds
    const t = Number(await page.getByTestId('simtime').textContent());
    expect(t).toBeGreaterThanOrEqual(15);
    expect(t).toBeLessThanOrEqual(21);
    await expect(page.getByTestId('live-line')).toContainText('users');
    expect(Number(await page.getByTestId('now-vus').textContent())).toBeGreaterThan(0);
    await page.getByTestId('run').click();
    await expect(page.getByTestId('phase')).toHaveText('paused');
    await page.clock.runFor(1000);
    expect(Number(await page.getByTestId('simtime').textContent())).toBe(t);
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('simtime')).toHaveText('150');
    await expect(page.getByTestId('phase')).toHaveText('finished');
  });
});
