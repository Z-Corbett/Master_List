import { test, expect } from '@playwright/test';

const URL = '/lab/007-austin-after-dark.html?seed=7';

test.describe('007 Austin After Dark', () => {
  test('genre filter narrows the gig calendar and can be reset', async ({ page }) => {
    await page.goto(URL);
    const cards = page.getByTestId('gig-card');
    await expect(cards).toHaveCount(12);

    await page.getByTestId('filter-jazz').click();
    await expect(page.getByTestId('filter-jazz')).toHaveAttribute('aria-pressed', 'true');
    await expect(cards).toHaveCount(2);
    for (const g of await cards.all()) await expect(g).toHaveAttribute('data-genre', 'jazz');
    await expect(page.getByTestId('showing-count')).toHaveText('Showing 2 of 12 shows · Jazz');

    await page.getByTestId('filter-all').click();
    await expect(cards).toHaveCount(12);
  });

  test('choosing a night, quantity and tier computes the total and holds tickets', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('pick-g4').click();
    await expect(page.getByTestId('selected-show')).toHaveText('Violet Crown Revue');
    await expect(page.getByTestId('pick-g4')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('qty-inc').click(); // 2 -> 3
    await expect(page.getByTestId('qty')).toHaveText('3');
    // 3 × $20 + 3 × $2.50 fee
    await expect(page.getByTestId('subtotal')).toHaveText('$60.00');
    await expect(page.getByTestId('fees')).toHaveText('$7.50');
    await expect(page.getByTestId('total')).toHaveText('$67.50');

    await page.getByTestId('tier-rail').check();
    await expect(page.getByTestId('total')).toHaveText('$103.50'); // 3 × $32 + $7.50

    await page.getByTestId('reserve').click();
    const confirm = page.getByTestId('confirmation');
    await expect(confirm).toContainText('Held 3 porch-rail tickets for Violet Crown Revue');
    await expect(confirm).toContainText('$103.50');
    await expect(page.getByTestId('hold-code')).toHaveText(/^CP-[0-9A-Z]{4}$/);
  });

  test('ticket quantity is clamped between 1 and 8', async ({ page }) => {
    await page.goto(URL);
    const dec = page.getByTestId('qty-dec');
    const inc = page.getByTestId('qty-inc');
    await dec.click();
    await expect(page.getByTestId('qty')).toHaveText('1');
    await expect(dec).toBeDisabled();

    for (let i = 0; i < 7; i++) await inc.click();
    await expect(page.getByTestId('qty')).toHaveText('8');
    await expect(inc).toBeDisabled();
    await expect(page.getByTestId('total')).toHaveText('$164.00'); // 8 × $18 + 8 × $2.50
  });

  test('bats emerge from the bridge and a new wave can be released', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('bat-canvas')).toHaveAttribute('data-animating', 'true');
    const released = async () => parseInt((await page.getByTestId('bats-released').textContent()) || '0', 10);
    await expect.poll(released).toBeGreaterThan(10);
    await expect.poll(async () => parseInt((await page.getByTestId('bats-aloft').textContent()) || '0', 10)).toBeGreaterThan(0);

    const before = await released();
    await page.getByTestId('release-bats').click();
    await expect.poll(released, { timeout: 10_000 }).toBeGreaterThan(before + 40);
  });

  test('reduced motion shows a still bat column and the neon sign can be switched off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    const canvas = page.getByTestId('bat-canvas');
    await expect(canvas).toHaveAttribute('data-motion', 'static');
    await expect(canvas).toHaveAttribute('data-animating', 'false');
    const first = await page.getByTestId('bats-released').textContent();
    expect(parseInt(first || '0', 10)).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    await expect(page.getByTestId('bats-released')).toHaveText(first!);

    const toggle = page.getByTestId('neon-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('neon-sign')).toHaveAttribute('data-power', 'off');
    await toggle.click();
    await expect(page.getByTestId('neon-sign')).toHaveAttribute('data-power', 'on');
  });
});
