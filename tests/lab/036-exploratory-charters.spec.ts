import { test, expect, type Page } from '@playwright/test';

const T0 = new Date('2026-03-02T09:00:00Z').getTime();
const MIN = 60_000;

async function open(page: Page, seed = 7) {
  await page.clock.install({ time: T0 });
  await page.goto(`/lab/036-exploratory-charters.html?seed=${seed}`);
  await page.clock.pauseAt(T0 + 5_000);
}

async function drawAndStart(page: Page) {
  await page.getByTestId('draw').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('run-state')).toHaveText('running');
}

test.describe('Exploratory Charters', () => {
  test('seeded deck draws the same charters, and charters are editable', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('deck-count')).toHaveText('12 left');
    await expect(page.getByTestId('start')).toBeDisabled();
    await page.getByTestId('draw').click();
    const charter = page.getByTestId('charter');
    await expect(charter).toHaveText('Explore Search with a screen reader to discover what state survives a reload.');
    await page.getByTestId('draw').click();
    await expect(charter).toHaveText('Explore Events calendar with an expired library card to discover barriers for assistive technology.');
    await expect(page.getByTestId('deck-count')).toHaveText('10 left');
    await expect(page.getByTestId('drawn-card')).toHaveCount(2);

    // go back to the first card, then rewrite its resource
    await page.getByTestId('drawn-card').nth(1).click();
    await expect(charter).toContainText('Explore Search');
    await page.getByTestId('f-res').fill('keyboard only');
    await expect(charter).toHaveText('Explore Search with keyboard only to discover what state survives a reload.');

    // a different seed deals a different first card
    await page.goto('/lab/036-exploratory-charters.html?seed=8');
    await page.getByTestId('draw').click();
    await expect(page.getByTestId('charter')).not.toContainText('Search with a screen reader');
  });

  test('the timer splits time between test, bug and setup, and pause stops it', async ({ page }) => {
    await open(page);
    await drawAndStart(page);
    await page.clock.fastForward(10 * MIN);
    await expect(page.getByTestId('elapsed')).toHaveText('10:00');
    await expect(page.getByTestId('remaining')).toHaveText('35:00 left');
    await page.getByTestId('mode-B').click();
    await page.clock.fastForward(5 * MIN);
    await page.getByTestId('mode-S').click();
    await page.clock.fastForward(5 * MIN);
    await expect(page.getByTestId('elapsed')).toHaveText('20:00');
    await expect(page.getByTestId('split-T')).toHaveText('10:00');
    await expect(page.getByTestId('split-B')).toHaveText('5:00');
    await expect(page.getByTestId('split-S')).toHaveText('5:00');

    await page.getByTestId('pause').click();
    await expect(page.getByTestId('run-state')).toHaveText('paused');
    await expect(page.getByTestId('pause')).toHaveText('Resume');
    await page.clock.fastForward(30 * MIN);
    await expect(page.getByTestId('elapsed')).toHaveText('20:00');
    await page.getByTestId('pause').click();
    await page.getByTestId('end').click();
    await expect(page.getByTestId('report')).toBeVisible();
    await expect(page.getByTestId('report-duration')).toContainText('20:00');
    await expect(page.getByTestId('report-split-text')).toHaveText('Test 50% · Bug investigation 25% · Setup 25%');
    await expect(page.getByTestId('report-over')).toHaveText('Within the timebox');
  });

  test('timebox banner appears when time runs out and the report shows the overrun', async ({ page }) => {
    await open(page);
    await page.getByTestId('timebox').selectOption('30');
    await drawAndStart(page);
    await expect(page.getByTestId('timebox-banner')).toBeHidden();
    await page.clock.fastForward(29 * MIN);
    await expect(page.getByTestId('timebox-banner')).toBeHidden();
    await page.clock.fastForward(3 * MIN + 30_000);
    await expect(page.getByTestId('timebox-banner')).toBeVisible();
    await expect(page.getByTestId('remaining')).toHaveText('02:30 over');
    await page.getByTestId('end').click();
    await expect(page.getByTestId('report-over')).toHaveText('Overran the timebox by 2:30');
  });

  test('quick-tagged notes carry time, area and mode, and feed the report', async ({ page }) => {
    await open(page);
    await drawAndStart(page);
    const input = page.getByTestId('note-input');
    await expect(input).toBeFocused();
    await page.clock.fastForward(3 * MIN);
    await input.fill('Event list ignores the text-size setting');
    await input.press('Enter');
    await page.getByTestId('area-holds').click();
    await page.clock.fastForward(4 * MIN);
    await page.getByTestId('mode-B').click();
    // prefix shortcut switches the tag while typing
    await input.pressSequentially('q: does a hold survive a card renewal?');
    await expect(page.getByTestId('tag-question')).toHaveAttribute('aria-checked', 'true');
    await expect(input).toHaveValue('does a hold survive a card renewal?');
    await page.getByTestId('add-note').click();
    await page.getByTestId('tag-risk').click();
    await input.fill('Cancelling a hold has no confirmation');
    await input.press('Enter');

    await expect(page.getByTestId('note')).toHaveCount(3);
    await expect(page.getByTestId('note-count')).toHaveText('3');
    const first = page.getByTestId('note').last();
    await expect(first).toContainText('bug');
    await expect(first).toContainText('+03:00');
    await expect(first).toContainText('Search');
    await expect(page.getByTestId('note').nth(1)).toContainText('investigating');

    await page.clock.fastForward(1 * MIN);
    await page.getByTestId('end').click();
    await expect(page.getByTestId('count-bug')).toHaveText('1 bug');
    await expect(page.getByTestId('count-question')).toHaveText('1 question');
    await expect(page.getByTestId('count-risk')).toHaveText('1 risk');
    await expect(page.getByTestId('count-idea')).toHaveText('0 ideas');
    // coverage: 3 min on Search, 5 min on Holds
    await expect(page.getByTestId('heat-search')).toHaveAttribute('data-min', '3');
    await expect(page.getByTestId('heat-holds')).toHaveAttribute('data-min', '5');
    await expect(page.getByTestId('heat-events-calendar')).toHaveAttribute('data-min', '0');
    await expect(page.getByTestId('report')).toContainText('2 of 8 areas touched');
  });

  test('sessions persist: an ended session is listed after reload and its report reopens', async ({ page }) => {
    await open(page);
    await drawAndStart(page);
    await page.clock.fastForward(12 * MIN);
    await page.getByTestId('note-input').fill('Screen reader reads the date as a number');
    await page.getByTestId('note-input').press('Enter');
    await page.getByTestId('end').click();
    await expect(page.getByTestId('hist-item')).toHaveCount(1);

    await page.reload();
    await expect(page.getByTestId('report')).toBeHidden();
    await expect(page.getByTestId('hist-item')).toHaveCount(1);
    await expect(page.getByTestId('hist-item')).toContainText('12:00 · 1 note');
    await page.getByRole('button', { name: 'View report' }).click();
    await expect(page.getByTestId('report-charter')).toHaveText('Explore Search with a screen reader to discover what state survives a reload.');
    await expect(page.getByTestId('report')).toContainText('Screen reader reads the date as a number');
    await page.getByRole('button', { name: 'Delete session 1' }).click();
    await expect(page.getByTestId('hist-item')).toHaveCount(0);
    await expect(page.getByTestId('report')).toBeHidden();
  });
});
