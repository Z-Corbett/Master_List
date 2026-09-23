import { test, expect, Page } from '@playwright/test';

const URL = '/lab/027-fast-and-feast.html';

async function openOn(page: Page, iso: string) {
  const t = new Date(`${iso}T09:00:00`);
  await page.clock.install({ time: t });
  await page.clock.pauseAt(new Date(t.getTime() + 1000));
  await page.goto(URL);
}

const guideDays = (page: Page) => page.getByTestId('guide-day');
const chip = (page: Page, date: string, person: string) =>
  page.locator(`[data-testid="guide-day"][data-date="${date}"] [data-testid="chip"][data-person="${person}"]`);

test.describe('027 Fast & Feast', () => {
  test('after Easter the planner defaults to next year\'s Lent, with dates from the computus', async ({ page }) => {
    await openOn(page, '2026-09-23');
    await expect(page.getByTestId('disclaimer')).toContainText(/pastor or diocese/);
    await expect(page.getByTestId('year-input')).toHaveValue('2027');
    await expect(page.getByTestId('ash-date')).toHaveText('Wed 10 Feb 2027');
    await expect(page.getByTestId('gf-date')).toHaveText('Fri 26 Mar');
    await expect(page.getByTestId('easter-date')).toHaveText('Sun 28 Mar');
    const dates = await guideDays(page).evaluateAll(els => els.map(e => `${(e as HTMLElement).dataset.date}:${(e as HTMLElement).dataset.kind}`));
    expect(dates).toEqual([
      '2027-02-10:fast', '2027-02-12:abst', '2027-02-19:abst', '2027-02-26:abst',
      '2027-03-05:abst', '2027-03-12:abst', '2027-03-19:sol', '2027-03-26:fast'
    ]);
    // 19 March 2027 is a Friday: the Solemnity of St Joseph lifts abstinence (can. 1251)
    await expect(page.locator('[data-date="2027-03-19"]')).toContainText('Solemnity of St Joseph');
    await expect(page.getByTestId('abst-days')).toHaveText('7');
    await expect(page.getByTestId('fast-days')).toHaveText('2');
  });

  test('obligations follow the US age rules (abstain 14+, fast 18–59)', async ({ page }) => {
    await openOn(page, '2026-09-23');
    await page.getByTestId('year-input').fill('2026');
    await page.getByTestId('year-input').press('Enter');
    await expect(page.getByTestId('ash-date')).toHaveText('Wed 18 Feb 2026');
    await expect(guideDays(page)).toHaveCount(8); // Ash Wed + 6 Fridays + Good Friday, no Friday solemnity in 2026

    const ash = '2026-02-18', fri = '2026-02-20';
    await expect(chip(page, ash, 'Adult 1')).toHaveAttribute('data-obl', 'fast');    // 38
    await expect(chip(page, ash, 'Teen')).toHaveAttribute('data-obl', 'abst');       // 15
    await expect(chip(page, ash, 'Kid')).toHaveAttribute('data-obl', 'free');        // 10
    await expect(chip(page, ash, 'Grandpa')).toHaveAttribute('data-obl', 'abst');    // 64
    await expect(chip(page, fri, 'Adult 1')).toHaveAttribute('data-obl', 'abst');

    // boundary ages: 13 / 14 / 17 / 18 / 59 / 60
    const ages = page.getByTestId('person-age');
    const expectFor = async (age: number, obl: string) => {
      await ages.nth(3).fill(String(age));
      await expect(chip(page, ash, 'Kid')).toHaveAttribute('data-obl', obl);
    };
    await expectFor(13, 'free');
    await expectFor(14, 'abst');
    await expectFor(17, 'abst');
    await expectFor(18, 'fast');
    await expectFor(59, 'fast');
    await expectFor(60, 'abst');
    await expect(page.getByTestId('fasters')).toHaveText('2');

    await page.getByTestId('add-person').click();
    await expect(page.getByTestId('person')).toHaveCount(6);
    await expect(page.getByTestId('fasters')).toHaveText('3');
    await page.getByTestId('person-remove').first().click();
    await expect(page.getByTestId('person')).toHaveCount(5);
  });

  test('tap a recipe then a slot to plan; full meals are refused in small-meal slots', async ({ page }) => {
    await openOn(page, '2026-09-23');
    await page.getByTestId('recipe-migas').getByRole('button').click();
    await expect(page.getByTestId('recipe-migas').getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('slot-2027-02-10-main').click();
    await expect(page.getByTestId('slot-2027-02-10-main')).toContainText('Friday Migas');

    await page.getByTestId('recipe-enchiladas').getByRole('button').click();
    await page.getByTestId('slot-2027-02-10-small1').click();
    await expect(page.getByTestId('toast')).toContainText('is a full meal');
    await expect(page.getByTestId('slot-2027-02-10-small1')).toHaveAttribute('aria-label', 'Small meal, Wed 10 Feb: empty');

    await page.getByTestId('slot-2027-02-11-main').click(); // still holding the enchiladas
    await expect(page.getByTestId('slot-2027-02-11-main')).toContainText('Black Bean Enchiladas');
    // Thursday is not a fast day, so it only has a main slot
    await expect(page.getByTestId('slot-2027-02-11-small1')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('slot-2027-02-10-main')).toContainText('Friday Migas');
    await page.getByTestId('slot-2027-02-10-main').getByTestId('slot-remove').click();
    await expect(page.getByTestId('slot-2027-02-10-main')).toContainText('Empty');
  });

  test('drag and drop a recipe onto a day', async ({ page }) => {
    await openOn(page, '2026-09-23');
    await page.getByTestId('recipe-fishtacos').dragTo(page.getByTestId('slot-2027-02-12-main'));
    await expect(page.getByTestId('slot-2027-02-12-main')).toContainText('Crispy Fish Tacos');
    await expect(page.getByTestId('toast')).toContainText('planned for Fri 12 Feb');
  });

  test('shopping list merges ingredients and scales to the household', async ({ page }) => {
    await openOn(page, '2026-09-23');
    await expect(page.getByTestId('shopping-list')).toContainText('Nothing planned');
    const plan = async (rid: string, slot: string) => {
      await page.getByTestId(`recipe-${rid}`).getByRole('button').click();
      await page.getByTestId(slot).click();
    };
    await plan('migas', 'slot-2027-02-10-main');
    await plan('beantacos', 'slot-2027-02-10-small1');
    await plan('potatotacos', 'slot-2027-02-11-main');
    const item = (name: string) => page.locator(`[data-testid="shop-item"][data-name="${name}"]`);
    // 5 people / 4 servings = ×1.25
    await expect(item('eggs')).toHaveAttribute('data-qty', '15');           // (6 + 6) × 1.25
    await expect(item('flour tortillas')).toHaveAttribute('data-qty', '20'); // (8 + 8) × 1.25
    await expect(item('refried beans')).toHaveAttribute('data-qty', '1.25');
    await expect(page.getByTestId('shop-meta')).toContainText('3 meals');

    await page.getByTestId('person-remove').last().click(); // 4 people -> ×1
    await expect(item('eggs')).toHaveAttribute('data-qty', '12');

    await page.getByTestId('week-select').selectOption('1');
    await expect(page.getByTestId('shopping-list')).toContainText('Nothing planned');
    await page.getByTestId('week-select').selectOption('0');
    await page.getByTestId('clear-week').click();
    await expect(page.getByTestId('shopping-list')).toContainText('Nothing planned');
  });
});
