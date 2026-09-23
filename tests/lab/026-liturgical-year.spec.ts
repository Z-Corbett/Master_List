import { test, expect, Page } from '@playwright/test';

const URL = '/lab/026-liturgical-year.html';

// Independent reference values (published Easter dates), not produced by the page.
const KNOWN_EASTER: Record<number, string> = {
  1981: '1981-04-19', 2000: '2000-04-23', 2011: '2011-04-24', 2019: '2019-04-21', 2024: '2024-03-31',
  2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2038: '2038-04-25', 2285: '2285-03-22'
};

async function atDate(page: Page, iso: string) {
  const t = new Date(`${iso}T10:00:00`);
  await page.clock.install({ time: t });
  await page.clock.pauseAt(new Date(t.getTime() + 1000));
  await page.goto(URL);
}

async function setYear(page: Page, y: number) {
  const input = page.getByTestId('year-input');
  await input.fill(String(y));
  await input.press('Enter');
  await expect(input).toHaveValue(String(y));
}

const feastDate = (page: Page, id: string) => page.getByTestId(`feast-${id}`).locator('td.d').getAttribute('data-iso');

test.describe('026 The Liturgical Year', () => {
  test('Easter by the Gregorian computus matches known dates', async ({ page }) => {
    await atDate(page, '2026-09-23');
    for (const y of [2024, 2025, 2026, 2027]) {
      await setYear(page, y);
      expect(await feastDate(page, 'easter')).toBe(KNOWN_EASTER[y]);
      await expect(page.getByTestId('year-label')).toContainText(`Liturgical year ${y - 1}–${y}`);
    }
    const all = await page.evaluate(years => years.map(y => (window as any).__litcal.easter(y)), Object.keys(KNOWN_EASTER).map(Number));
    expect(all).toEqual(Object.values(KNOWN_EASTER));
  });

  test('movable feasts for 2026 hang correctly from Easter and Advent', async ({ page }) => {
    await atDate(page, '2026-09-23');
    await expect(page.getByTestId('year-input')).toHaveValue('2026');
    const expected: Record<string, string> = {
      advent1: '2025-11-30', christmas: '2025-12-25', holyfamily: '2025-12-28', epiphany: '2026-01-04', baptism: '2026-01-11',
      ash: '2026-02-18', palm: '2026-03-29', goodfriday: '2026-04-03', easter: '2026-04-05', mercy: '2026-04-12',
      ascension: '2026-05-14', pentecost: '2026-05-24', trinity: '2026-05-31', corpus: '2026-06-07', heart: '2026-06-12',
      christking: '2026-11-22'
    };
    for (const [id, iso] of Object.entries(expected)) expect(await feastDate(page, id), id).toBe(iso);
    await expect(page.getByTestId('year-label')).toContainText('Saturday 28 November 2026');
    await expect(page.getByTestId('cycle')).toHaveText('Sunday cycle A · Weekday II');
  });

  test('today marker and day name follow the (fake) clock', async ({ page }) => {
    await atDate(page, '2026-09-23');
    await expect(page.getByTestId('today-marker')).toHaveAttribute('data-date', '2026-09-23');
    await expect(page.getByTestId('day-name')).toHaveText('Wednesday of the 25th Week in Ordinary Time');
    await expect(page.getByTestId('day-colour')).toHaveAttribute('data-colour', 'green');

    await atDate(page, '2026-03-01');
    await expect(page.getByTestId('day-name')).toHaveText('Second Sunday of Lent');
    await expect(page.getByTestId('day-colour')).toHaveAttribute('data-colour', 'violet');

    // After the First Sunday of Advent the wheel rolls to the next liturgical year
    await atDate(page, '2026-12-01');
    await expect(page.getByTestId('year-input')).toHaveValue('2027');
    await expect(page.getByTestId('day-name')).toHaveText('Tuesday of the First Week of Advent');
    await setYear(page, 2030);
    await expect(page.getByTestId('today-marker')).not.toHaveAttribute('data-date', /.+/);
    await page.getByTestId('go-today').click();
    await expect(page.getByTestId('year-input')).toHaveValue('2027');
  });

  test('clicking a season segment shows its span, length and colour', async ({ page }) => {
    await atDate(page, '2026-09-23');
    await page.getByTestId('seg-lent').click();
    const detail = page.getByTestId('season-detail');
    await expect(detail).toContainText('Lent');
    await expect(detail).toContainText('Wednesday 18 February 2026 – Wednesday 1 April 2026');
    await expect(page.getByTestId('season-days')).toHaveText('43');
    await expect(page.getByTestId('season-btn-lent')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('seg-lent')).toHaveClass(/sel/);

    await page.getByTestId('season-btn-easter').click();
    await expect(page.getByTestId('season-days')).toHaveText('49');
    await expect(detail).toContainText('White');
    await page.getByTestId('season-btn-pentecost').click();
    await expect(detail).toContainText('Red');
    await expect(page.getByTestId('season-days')).toHaveText('1');

    // keyboard activation of a wheel segment
    await page.getByTestId('seg-advent').focus();
    await page.keyboard.press('Enter');
    await expect(detail).toContainText('Sunday 30 November 2025 – Wednesday 24 December 2025');
  });

  test('transfer rules for fixed solemnities match real calendars', async ({ page }) => {
    await atDate(page, '2026-09-23');
    await setYear(page, 2024);
    expect(await feastDate(page, 'annunciation')).toBe('2024-04-08'); // 25 Mar 2024 fell in Holy Week
    await setYear(page, 2023);
    expect(await feastDate(page, 'joseph')).toBe('2023-03-20');       // Sunday of Lent -> Monday
    expect(await feastDate(page, 'baptism')).toBe('2023-01-09');      // Epiphany on 8 Jan -> Monday
    await setYear(page, 2025);
    expect(await feastDate(page, 'immaculate')).toBe('2024-12-09');   // Sunday of Advent -> Monday
    await setYear(page, 2022);
    expect(await feastDate(page, 'baptist')).toBe('2022-06-23');      // yields to the Sacred Heart
    await setYear(page, 2008);
    expect(await feastDate(page, 'joseph')).toBe('2008-03-15');       // Holy Week -> Saturday before Palm Sunday
  });

  test('stepping days by keyboard and picking feasts updates the day card; year is clamped', async ({ page }) => {
    await atDate(page, '2026-09-23');
    await page.getByTestId('feast-pentecost').getByRole('button').click();
    await expect(page.getByTestId('day-name')).toHaveText('Pentecost Sunday');
    await expect(page.getByTestId('day-colour')).toHaveAttribute('data-colour', 'red');
    await page.getByTestId('wheel').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('day-name')).toHaveText('Monday of the 8th Week in Ordinary Time');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('day-name')).toHaveText('Saturday of the Seventh Week of Easter');

    await page.getByTestId('year-input').fill('1800');
    await page.getByTestId('year-input').press('Enter');
    await expect(page.getByTestId('year-input')).toHaveValue('1970');
    await page.getByTestId('year-prev').click();
    await expect(page.getByTestId('year-input')).toHaveValue('1970');
  });
});
