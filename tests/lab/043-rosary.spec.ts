import { test, expect, Page } from '@playwright/test';

const URL = '/lab/043-rosary.html';

async function openOn(page: Page, isoDate: string) {
  await page.clock.setFixedTime(new Date(`${isoDate}T09:00:00`));
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}
const title = (page: Page) => page.getByTestId('prayer-title');

test.describe('043 Rosary Companion', () => {
  test('the mysteries follow the day of the week', async ({ page }) => {
    // 20 September 2026 is a Sunday
    const week: Array<[string, string, string]> = [
      ['2026-09-20', 'Sunday', 'Glorious'], ['2026-09-21', 'Monday', 'Joyful'], ['2026-09-22', 'Tuesday', 'Sorrowful'],
      ['2026-09-23', 'Wednesday', 'Glorious'], ['2026-09-24', 'Thursday', 'Luminous'], ['2026-09-25', 'Friday', 'Sorrowful'],
      ['2026-09-26', 'Saturday', 'Joyful'],
    ];
    for (const [iso, day, set] of week) {
      await openOn(page, iso);
      await expect(page.getByTestId('today-day')).toContainText(day);
      await expect(page.getByTestId('today-set')).toHaveText(`The ${set} Mysteries`);
      await expect(page.getByTestId('set-name')).toHaveText(`${set} Mysteries`);
      await expect(page.getByTestId('schedule').locator('tr.is-today')).toContainText(`${day}${set}`);
    }
  });

  test('seasonal Sunday custom: Joyful in Advent, Sorrowful in Lent, only when switched on', async ({ page }) => {
    await openOn(page, '2026-11-29'); // First Sunday of Advent 2026
    await expect(page.getByTestId('today-set')).toHaveText('The Glorious Mysteries');
    await page.getByTestId('seasonal').check();
    await expect(page.getByTestId('today-set')).toHaveText('The Joyful Mysteries');
    await expect(page.getByTestId('today-why')).toHaveText('A Sunday of Advent (seasonal custom)');

    const facts = await page.evaluate(() => {
      const r = (window as any).__rosary;
      return {
        easter: [2024, 2025, 2026, 2027].map((y) => r.easter(y)),
        seasons: ['2026-11-22', '2026-11-29', '2026-12-20', '2026-12-27', '2026-02-15', '2026-02-22', '2026-03-29', '2026-04-05', '2026-03-04']
          .map((d) => r.season(d)),
        lentSunday: r.todaysSet('2026-03-01').key,
        easterSunday: r.todaysSet('2026-04-05').key,
      };
    });
    expect(facts.easter).toEqual(['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28']);
    // Christ the King, Advent 1, Advent 4, after Christmas, before Ash Wednesday, Lent 1, Palm Sunday, Easter, a Lenten weekday
    expect(facts.seasons).toEqual([null, 'advent', 'advent', null, null, 'lent', 'lent', null, null]);
    expect(facts.lentSunday).toBe('sorrowful');
    expect(facts.easterSunday).toBe('glorious');

    // the choice is remembered
    await page.reload();
    await expect(page.getByTestId('seasonal')).toBeChecked();
    await expect(page.getByTestId('today-set')).toHaveText('The Joyful Mysteries');
  });

  test('walks the opening prayers and first decade bead by bead', async ({ page }) => {
    await openOn(page, '2026-09-21'); // Monday: Joyful
    await expect(title(page)).toHaveText('Sign of the Cross');
    await expect(page.getByTestId('bead-crucifix')).toHaveClass(/cur/);
    await expect(page.getByTestId('prev')).toBeDisabled();
    await page.getByTestId('next').click();
    await expect(title(page)).toHaveText("Apostles' Creed");
    await expect(page.getByTestId('prayer-text')).toContainText('I believe in God, the Father Almighty');
    await page.getByTestId('next').click();
    await expect(title(page)).toHaveText('Our Father');
    await expect(page.getByTestId('bead-p-L0')).toHaveClass(/cur/);
    await expect(page.getByTestId('bead-crucifix')).toHaveClass(/done/);
    const intents = ['faith', 'hope', 'charity'];
    for (let k = 1; k <= 3; k++) {
      await page.keyboard.press('ArrowRight');
      await expect(title(page)).toHaveText(`Hail Mary · ${k} of 3`);
      await expect(page.getByTestId('where')).toContainText(intents[k - 1]);
      await expect(page.getByTestId(`bead-p-S${k}`)).toHaveClass(/cur/);
    }
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Glory Be');
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Our Father');
    await expect(page.getByTestId('mystery-kicker')).toHaveText('Announce · The First Joyful Mystery');
    await expect(page.getByTestId('mystery-name')).toHaveText('The Annunciation');
    await expect(page.getByTestId('mystery-ref')).toHaveText('Luke 1:26–38');
    for (let k = 1; k <= 10; k++) await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Hail Mary · 10 of 10');
    await expect(page.getByTestId('bead-d1-10')).toHaveClass(/cur/);
    await expect(page.getByTestId('mystery-kicker')).toHaveText('Meditate · The First Joyful Mystery');
    await page.getByTestId('next').click();
    await expect(title(page)).toHaveText('Glory Be');
    await page.getByTestId('next').click();
    await expect(title(page)).toHaveText('Fatima Prayer');
    await expect(page.getByTestId('optional')).toBeVisible();
    await expect(page.getByTestId('prayer-text')).toHaveText(/^O my Jesus, forgive us our sins/);
    await page.getByTestId('next').click();
    await expect(page.getByTestId('mystery-name')).toHaveText('The Visitation');
    await expect(page.getByTestId('bead-L2')).toHaveClass(/cur/);
    await expect(page.getByTestId('step-no')).toHaveText('Step 21 of 75');
  });

  test('the Fatima Prayer is optional and the override changes the mysteries', async ({ page }) => {
    await openOn(page, '2026-09-24'); // Thursday: Luminous
    await page.getByTestId('bead-d3-5').click();
    await expect(title(page)).toHaveText('Hail Mary · 5 of 10');
    await expect(page.getByTestId('mystery-name')).toHaveText('The Proclamation of the Kingdom');
    await expect(page.getByTestId('step-no')).toHaveText('Step 39 of 75');
    await page.getByTestId('fatima').uncheck();
    // five Fatima prayers dropped; two of them came before this bead, and the place is kept
    await expect(page.getByTestId('step-no')).toHaveText('Step 37 of 70');
    await expect(title(page)).toHaveText('Hail Mary · 5 of 10');
    await page.getByTestId('set-sorrowful').check();
    await expect(page.getByTestId('mystery-name')).toHaveText('The Crowning with Thorns');
    await expect(page.getByTestId('today-set')).toHaveText('The Sorrowful Mysteries (chosen)');
    await expect(page.getByTestId('today-why')).toHaveText("Today's usual set would be the Luminous Mysteries.");
    const fatimaSteps = await page.evaluate(() => (window as any).__rosary.steps.filter((s: any) => s.p === 'fatima').length);
    expect(fatimaSteps).toBe(0);
  });

  test('closing prayers, completion, and progress saved across reloads', async ({ page }) => {
    await openOn(page, '2026-09-23');
    await page.getByTestId('bead-d2-7').click();
    await page.getByTestId('set-joyful').check();
    await page.reload();
    await expect(title(page)).toHaveText('Hail Mary · 7 of 10');
    await expect(page.getByTestId('mystery-name')).toHaveText('The Visitation');
    await expect(page.getByTestId('set-joyful')).toBeChecked();

    await page.keyboard.press('End');
    await expect(title(page)).toHaveText('Sign of the Cross');
    await expect(page.getByTestId('bead-center')).toHaveClass(/cur/);
    await page.getByTestId('prev').click();
    await expect(title(page)).toHaveText('Closing Prayer');
    await expect(page.getByTestId('prayer-text')).toContainText('obtain what they promise');
    await page.getByTestId('prev').click();
    await expect(title(page)).toHaveText('Hail, Holy Queen');
    await expect(page.getByTestId('prayer-text')).toContainText('R. That we may be made worthy of the promises of Christ.');
    await page.getByTestId('next').click();
    await page.getByTestId('next').click();
    await expect(page.getByTestId('next')).toHaveText('Amen ✓');
    await page.getByTestId('next').click();
    await expect(page.getByTestId('done')).toBeVisible();
    await expect(page.getByTestId('done')).toBeFocused();
    await page.reload();
    await expect(title(page)).toHaveText('Sign of the Cross');
    await expect(page.getByTestId('step-no')).toHaveText('Step 1 of 75');
  });
});
