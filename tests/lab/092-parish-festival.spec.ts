import { test, expect, Page } from '@playwright/test';

const URL = '/lab/092-parish-festival.html';

async function at(page: Page, when: string) {
  await page.clock.install({ time: new Date(when) });
  await page.goto(URL);
  await page.clock.pauseAt(new Date(new Date(when).getTime() + 1000));
}

test.describe('092 St. Fiacre Fall Festival', () => {
  test('the countdown knows before, during and after the festival', async ({ page }) => {
    await at(page, '2026-10-10T09:00:00');
    await expect(page.getByTestId('countdown')).toHaveText(/^7\s*days until the festival$/);
    await at(page, '2026-10-16T22:00:00');
    await expect(page.getByTestId('countdown')).toHaveText(/^1\s*day until the festival$/);
    await at(page, '2026-10-17T08:00:00');
    await expect(page.getByTestId('countdown')).toContainText('Today');
    await at(page, '2026-10-18T14:00:00');
    await expect(page.getByTestId('countdown')).toContainText('The festival is on');
    await at(page, '2026-10-20T10:00:00');
    await expect(page.getByTestId('countdown')).toContainText('See you next fall');
  });

  test('schedule: stages are tabs, days are toggles, arrow keys move between stages', async ({ page }) => {
    await page.goto(URL);
    const sched = page.getByTestId('schedule').locator('li');
    await expect(page.getByTestId('stage-gazebo')).toHaveAttribute('aria-selected', 'true');
    await expect(sched).toHaveCount(6);
    await expect(sched.first()).toContainText('11:00 AM');
    await expect(page.getByTestId('schedule')).toContainText('Blessing of the gardens');
    await page.getByTestId('day-sun').click();
    await expect(page.getByTestId('day-sun')).toHaveAttribute('aria-pressed', 'true');
    await expect(sched.first()).toContainText('Festival Mass on the lawn');
    await expect(page.getByTestId('schedule')).toContainText('Grand raffle drawing');
    await page.getByRole('tab', { name: 'Parish Hall' }).click();
    await expect(page.getByTestId('stage-hall')).toHaveAttribute('aria-selected', 'true');
    await expect(sched).toHaveCount(3);
    await expect(page.getByTestId('schedule')).toContainText('Brisket plates served');
    // roving focus with the arrow keys, wrapping round
    await page.getByTestId('stage-hall').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('stage-kids')).toBeFocused();
    await expect(page.getByTestId('stage-kids')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('schedule')).toContainText('Petting zoo');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('stage-gazebo')).toBeFocused();
    await expect(page.getByTestId('stage-kids')).toHaveAttribute('tabindex', '-1');
  });

  test('food map: pick a booth for its menu, filters dim the rest', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('booth-3').click();
    const detail = page.getByTestId('booth-detail');
    await expect(detail).toContainText('Altar Society Kolaches');
    await expect(detail.getByTestId('menu').locator('li')).toHaveCount(3);
    await expect(detail).toContainText('Sausage klobasnek');
    await expect(page.getByTestId('booth-3')).toHaveClass(/sel/);
    // keyboard: focus a booth and press Enter
    await page.getByTestId('booth-9').focus();
    await page.keyboard.press('Enter');
    await expect(detail).toContainText('Snow Cones');
    await expect(page.getByTestId('booth-3')).not.toHaveClass(/sel/);
    // filters
    await page.getByTestId('filter-drinks').click();
    await expect(page.getByTestId('filter-drinks')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#map .booth:not(.dim)')).toHaveCount(2);
    await expect(page.getByTestId('booth-6')).not.toHaveClass(/dim/);
    await expect(page.getByTestId('booth-1')).toHaveClass(/dim/);
    await expect(page.getByTestId('map')).toHaveAttribute('aria-label', /2 of 10 booths/);
    await page.getByTestId('filter-meatless').click();
    await expect(page.locator('#map .booth:not(.dim)')).toHaveCount(7);
    await page.getByTestId('filter-all').click();
    await expect(page.locator('#map .booth.dim')).toHaveCount(0);
  });

  test('raffle calculator finds the cheapest bundles and the most tickets for a budget', async ({ page }) => {
    await page.goto(URL);
    const input = page.getByTestId('raffle-input');
    const total = page.getByTestId('raffle-total');
    // 7 tickets = one 6-bundle + one single
    await expect(total).toHaveText('$30');
    await expect(page.getByTestId('raffle-breakdown')).toContainText('1 × single ticket');
    await expect(page.getByTestId('raffle-breakdown')).toContainText('1 × 6-ticket bundle');
    await expect(page.getByTestId('raffle-saving')).toHaveText('You save $5 against buying 7 single tickets.');
    // 13 exactly costs $55, but 15 cost $50: the calculator says so
    await input.fill('13');
    await expect(total).toHaveText('$50');
    await expect(page.getByTestId('raffle-summary')).toContainText('Buy 15 tickets');
    await expect(page.getByTestId('raffle-summary')).toContainText('exactly 13 ($55)');
    await input.fill('36');
    await expect(total).toHaveText('$100');
    await expect(page.getByTestId('raffle-breakdown')).toContainText('1 × 40-ticket bundle');
    await input.fill('41');
    await expect(total).toHaveText('$105');
    await input.fill('0');
    await expect(page.getByTestId('raffle-error')).toBeVisible();
    await input.fill('2.5');
    await expect(page.getByTestId('raffle-error')).toBeVisible();
    // budget mode
    await page.getByTestId('mode-budget').check();
    await expect(input).toHaveValue('80');
    await expect(total).toHaveText('22 tickets');          // 15 + 6 + 1 for $80
    await input.fill('99');
    await expect(total).toHaveText('25 tickets');
    await expect(page.getByTestId('raffle-summary')).toContainText('spending $95 ($4 left');
    await input.fill('4');
    await expect(total).toHaveText('0 tickets');
    // cross-check the table against brute force for many sizes
    const bad = await page.evaluate(() => {
      const F = (window as any).__festival, B = F.BUNDLES;
      const errs: string[] = [];
      for (let n = 1; n <= 90; n++) {
        let best = Infinity;
        for (let a = 0; a <= 3; a++) for (let b = 0; b <= 16; b++) for (let c = 0; c <= 7; c++) for (let d = 0; d <= 130; d++) {
          if (a * 40 + b * 15 + c * 6 + d >= n) { best = Math.min(best, a * 100 + b * 50 + c * 25 + d * 5); break; }
        }
        const r = F.forTickets(n);
        const got = r.bundles.reduce((s: number, k: number, i: number) => s + k * B[i].n, 0);
        if (r.bestCost !== best || got !== r.best || got < n) errs.push(`${n}: ${r.bestCost} vs ${best}`);
      }
      return errs;
    });
    expect(bad).toEqual([]);
  });

  test('volunteer sign-up validates, stays in this browser and sends nothing', async ({ page }) => {
    await page.goto(URL);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await expect(page.getByTestId('privacy-note')).toContainText('Nothing is sent anywhere');
    await page.getByTestId('v-submit').click();
    await expect(page.getByTestId('v-msg')).toHaveText('Please fix the highlighted fields.');
    await expect(page.getByTestId('v-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('v-name')).toBeFocused();
    await expect(page.locator('#eShift')).toHaveText('Pick at least one shift.');
    await page.getByTestId('v-name').fill('Teresa Villarreal');
    await page.getByTestId('v-email').fill('teresa@example');
    await page.getByTestId('shift-sat-bingo').check();
    await page.getByTestId('v-submit').click();
    await expect(page.locator('#eEmail')).toContainText('name@example.com');
    await page.getByTestId('v-email').fill('teresa@example.com');
    await expect(page.getByTestId('shift-sat-kids')).toBeDisabled();       // already full
    await expect(page.getByTestId('spots-sat-bingo')).toHaveText('3 spots left');
    await page.getByTestId('shift-sun-food').check();
    await page.getByTestId('v-shirt').selectOption('L');
    await page.getByTestId('v-submit').click();
    await expect(page.getByTestId('v-msg')).toHaveText('Thank you, Teresa Villarreal! Saved in this browser only (2 shifts). Nothing was sent.');
    await expect(page.getByTestId('spots-sat-bingo')).toHaveText('2 spots left');
    await expect(page.getByTestId('signup')).toHaveCount(1);
    await expect(page.getByTestId('v-name')).toHaveValue('');
    expect(requests).toEqual([]);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lab092-volunteers') || '[]'));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: 'Teresa Villarreal', email: 'teresa@example.com', shirt: 'L', shifts: ['sat-bingo', 'sun-food'] });
    // it survives a reload, and can be removed
    await page.reload();
    await expect(page.getByTestId('signup')).toHaveCount(1);
    await expect(page.getByTestId('signup')).toContainText('Sat 6–9 PM · Bingo callers & runners');
    await expect(page.getByTestId('spots-sat-bingo')).toHaveText('2 spots left');
    await page.getByRole('button', { name: 'Remove sign-up for Teresa Villarreal' }).click();
    await expect(page.getByTestId('signup')).toHaveCount(0);
    await expect(page.getByTestId('spots-sat-bingo')).toHaveText('3 spots left');
    expect(await page.evaluate(() => localStorage.getItem('lab092-volunteers'))).toBe('[]');
  });

  test('Mass times and the FAQ', async ({ page }) => {
    await page.goto(URL);
    const masses = page.getByTestId('mass-times');
    await expect(masses).toContainText('5:00 PM');
    await expect(masses).toContainText('Festival Mass · Gazebo lawn');
    await expect(masses).toContainText('Misa en español');
    const faq = page.getByTestId('faq-parking');
    await expect(faq.locator('p')).toBeHidden();
    await faq.locator('summary').click();
    await expect(faq).toHaveAttribute('open', '');
    await expect(faq.locator('p')).toContainText('golf-cart shuttle');
    await page.getByText('What is the blessing of the gardens?').click();
    await expect(page.getByText('patron saint of gardeners')).toBeVisible();
  });
});
