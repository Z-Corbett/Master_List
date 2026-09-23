import { test, expect, Page } from '@playwright/test';

const URL = '/lab/015-kanban-for-one.html';
const col = (page: Page, id: string) => page.getByTestId(`col-${id}`);
const card = (page: Page, title: string) => page.getByTestId('card').filter({ hasText: title });
const titles = (page: Page, id: string) => page.evaluate(c => (window as any).__kanban.column(c), id);

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.describe('Kanban for One', () => {
  test('keyboard moves: ] and [ change column, Alt+arrows reorder, announced via aria-live', async ({ page }) => {
    const c = card(page, 'Renew the portfolio domain');
    await c.focus();
    await page.keyboard.press(']');
    await expect(col(page, 'doing').getByTestId('card')).toHaveCount(3);
    await expect(col(page, 'doing')).toContainText('Renew the portfolio domain');
    await expect(page.getByTestId('announcer')).toHaveText(/Moved “Renew the portfolio domain” to Doing, position 3 of 3\. Doing is at its WIP limit\./);
    // focus follows the card, so the next key keeps working on it
    await expect(card(page, 'Renew the portfolio domain')).toBeFocused();
    await page.keyboard.press('Alt+ArrowUp');
    expect(await titles(page, 'doing')).toEqual([
      'Fix the flaky login spec on mobile', 'Renew the portfolio domain', 'Write QA notes for Mempool Garden',
    ]);
    await page.keyboard.press('Alt+ArrowRight');
    await expect(col(page, 'review')).toContainText('Renew the portfolio domain');
    await page.keyboard.press('[');
    await page.keyboard.press('[');
    expect(await titles(page, 'backlog')).toContain('Renew the portfolio domain');
    await page.keyboard.press('[');
    await expect(page.getByTestId('announcer')).toContainText('already in Backlog');
  });

  test('drag and drop with the pointer moves a card and persists across reloads', async ({ page }) => {
    // Doing sits to the right on desktop and directly below Backlog on phones; either way both are on screen.
    const grip = card(page, 'Draft a post on flaky-test triage').getByTestId('grip');
    const target = col(page, 'doing').getByTestId('card').first();
    await grip.evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150));
    const from = (await grip.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
    const to = (await target.boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 12 });
    await page.mouse.up();

    const expected = ['Draft a post on flaky-test triage', 'Fix the flaky login spec on mobile', 'Write QA notes for Mempool Garden'];
    expect(await titles(page, 'doing')).toEqual(expected);
    expect(await titles(page, 'backlog')).not.toContain('Draft a post on flaky-test triage');
    await expect(page.getByTestId('announcer')).toContainText('to Doing, position 1 of 3');
    await expect(col(page, 'doing')).toHaveAttribute('data-wip', 'at');

    await page.reload();
    expect(await titles(page, 'doing')).toEqual(expected);
    await expect(col(page, 'doing').getByTestId('card').first()).toContainText('#writing');
  });

  test('WIP limits warn when a column is over its limit, and the limit is editable', async ({ page }) => {
    const review = col(page, 'review');
    await expect(review).toHaveAttribute('data-wip', 'ok');
    await expect(page.getByTestId('wip-review')).toHaveText('1 / 2');
    for (const t of ['Sketch the Tidewater ripple visuals', 'Renew the portfolio domain']) {
      await card(page, t).focus();
      await page.keyboard.press(']');
      await page.keyboard.press(']');
    }
    await expect(review).toHaveAttribute('data-wip', 'over');
    await expect(page.getByTestId('wip-review')).toHaveText('3 / 2');
    await expect(page.getByTestId('over-review')).toBeVisible();
    await expect(page.getByTestId('announcer')).toContainText('Review is over its WIP limit (3 of 2)');

    await page.getByTestId('limit-review').fill('3');
    await page.getByTestId('limit-review').press('Enter');
    await page.getByTestId('limit-review').blur();
    await expect(review).toHaveAttribute('data-wip', 'at');
    await expect(page.getByTestId('over-review')).toBeHidden();
  });

  test('add, inline-edit with tags, then filter by search', async ({ page }) => {
    await page.getByTestId('add-backlog').click();
    await page.getByTestId('add-input').fill('Plant stones in Tidewater');
    await page.getByTestId('add-input').press('Enter');
    await expect(card(page, 'Plant stones in Tidewater')).toHaveCount(1);
    await page.getByTestId('add-input').press('Escape');

    await card(page, 'Plant stones in Tidewater').dblclick();
    const input = page.getByTestId('edit-input');
    await input.fill('Plant stones and tune the scale');
    await page.getByTestId('tag-bug').click();
    await expect(page.getByTestId('tag-bug')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('tag-learning').click();
    await page.getByTestId('save-edit').click();
    const edited = card(page, 'Plant stones and tune the scale');
    await expect(edited).toContainText('#bug');
    await expect(edited).toContainText('#learning');
    await expect(page.getByTestId('announcer')).toContainText('with tags bug, learning');

    await page.getByTestId('search').fill('#bug');
    await expect(page.getByTestId('shown-count')).toHaveText('2 of 11 shown');
    await expect(page.locator('[data-testid="card"]:visible')).toHaveCount(2);
    await page.getByTestId('search').fill('tune');
    await expect(page.locator('[data-testid="card"]:visible')).toHaveCount(1);
    await page.getByTestId('search').fill('');
    await expect(page.getByTestId('shown-count')).toHaveText('11 cards');
  });

  test('export produces the board as JSON and import replaces it (bad files are rejected)', async ({ page }) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
    expect(download.suggestedFilename()).toBe('kanban-for-one.json');
    const exported = JSON.parse(await (await download.createReadStream()).toArray().then(b => Buffer.concat(b).toString('utf8')));
    expect(exported.columns.map((c: any) => c.id)).toEqual(['backlog', 'doing', 'review', 'done']);
    expect(Object.keys(exported.cards)).toHaveLength(10);

    const board = {
      version: 1, nextId: 3,
      columns: [
        { id: 'backlog', limit: 0, cards: ['c1'] }, { id: 'doing', limit: 1, cards: ['c2'] },
        { id: 'review', limit: 2, cards: [] }, { id: 'done', limit: 0, cards: [] },
      ],
      cards: { c1: { id: 'c1', title: 'Imported idea', tags: ['design'] }, c2: { id: 'c2', title: 'Imported task', tags: ['nope', 'admin'] } },
    };
    await page.getByTestId('import').setInputFiles({ name: 'board.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(board)) });
    await expect(page.getByTestId('announcer')).toContainText('Imported board with 2 cards');
    await expect(page.getByTestId('card')).toHaveCount(2);
    await expect(card(page, 'Imported task')).toContainText('#admin');
    await expect(card(page, 'Imported task')).not.toContainText('#nope');
    await expect(col(page, 'doing')).toHaveAttribute('data-wip', 'at');

    await page.getByTestId('import').setInputFiles({ name: 'junk.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
    await expect(page.getByTestId('announcer')).toContainText('Import failed');
    await expect(page.getByTestId('card')).toHaveCount(2);
  });
});
