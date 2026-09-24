import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/083-test-heuristics.html';
const seg = (page: Page, id: string) => page.locator(`[data-testid="seg"][data-id="${id}"]`);
async function addIdea(page: Page, text: string) {
  await page.getByTestId('idea-input').fill(text);
  await page.getByTestId('add-idea').click();
}

test.describe('Test Heuristics Deck', () => {
  test('both decks are complete, in order, and correctly attributed', async ({ page }) => {
    await page.goto(URL);
    const names = async (fan: string) => page.getByTestId(fan).getByTestId('mini').evaluateAll((els) => els.map((e) => e.firstChild!.textContent));
    expect((await names('fan-sf')).join('')).toBe('SFDIPOT');
    expect((await names('fan-hc')).join('')).toBe('HICCUPPSF');
    await expect(page.getByTestId('seg')).toHaveCount(16);
    await expect(page.locator('header')).toContainText("James Bach's Heuristic Test Strategy Model");
    await expect(page.locator('header')).toContainText('James Bach and Michael Bolton');
    const cards = await page.evaluate(() => (window as any).__heur.cards.map((c: any) => c.name));
    expect(cards).toEqual(['Structure', 'Function', 'Data', 'Interfaces', 'Platform', 'Operations', 'Time',
      'History', 'Image', 'Comparable products', 'Claims', 'User expectations', 'Product', 'Purpose', 'Statutes & standards', 'Familiar problems']);
  });

  test('jotting ideas fills the wheel segment by level and updates coverage', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('wheel-pct')).toHaveText('0%');
    await page.getByTestId('fan-sf').getByTestId('mini').nth(2).click(); // Data
    await expect(page.getByTestId('card-name')).toHaveText('Data');
    await page.getByTestId('use-prompt').first().click();
    await expect(page.getByTestId('idea-input')).toHaveValue(/Tip of 0 %/);
    await page.getByTestId('add-idea').click();
    await expect(seg(page, 'sf-data')).toHaveAttribute('data-level', '1');
    await addIdea(page, 'Bill of $0.01 split between two diners');
    await addIdea(page, 'Diner name of 200 characters');
    await addIdea(page, 'Split among 12 diners with a 15.5 % tip');
    await expect(page.getByTestId('idea')).toHaveCount(4);
    await expect(seg(page, 'sf-data')).toHaveAttribute('data-level', '3'); // capped at 3
    await expect(page.getByTestId('idea-total')).toHaveText('4');
    await expect(page.getByTestId('covered')).toHaveText('1');
    await expect(page.getByTestId('wheel-pct')).toHaveText('6%'); // 1 of 16
    await addIdea(page, '   '); // blank ideas are ignored
    await expect(page.getByTestId('idea')).toHaveCount(4);
    await page.getByTestId('del-idea').first().click();
    await expect(page.getByTestId('idea')).toHaveCount(3);
    await expect(page.getByTestId('idea').first()).toHaveText(/Bill of \$0\.01/);
  });

  test('wheel segments and arrow keys move between cards', async ({ page }) => {
    await page.goto(URL);
    await seg(page, 'hc-claims').click();
    await expect(page.getByTestId('card-name')).toHaveText('Claims');
    await expect(page.getByTestId('card')).toContainText('card 11 of 16');
    await page.getByTestId('next').click();
    await expect(page.getByTestId('card-name')).toHaveText('User expectations');
    await page.getByTestId('fan-hc').getByTestId('mini').last().focus();
    await page.keyboard.press('ArrowRight'); // wraps around to the first card
    await expect(page.getByTestId('card-name')).toHaveText('Structure');
    await expect(page.getByTestId('fan-sf').getByTestId('mini').first()).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('card-name')).toHaveText('Familiar problems');
    await seg(page, 'sf-time').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('card-name')).toHaveText('Time');
  });

  test('ideas persist, export as Markdown, and "deal" only picks empty cards', async ({ page }) => {
    await page.goto(URL + '?seed=5');
    for (let i = 0; i < 15; i++) {
      await page.getByTestId('deal').click();
      const id = await page.getByTestId('card').getAttribute('data-id');
      await expect(page.getByTestId('idea')).toHaveCount(0); // a dealt card never has ideas yet
      await addIdea(page, 'idea for ' + id);
    }
    await expect(page.getByTestId('covered')).toHaveText('15');
    await page.reload();
    await expect(page.getByTestId('covered')).toHaveText('15');
    const empty = await page.getByTestId('seg').evaluateAll((els) => els.filter((e) => e.getAttribute('data-level') === '0').map((e) => e.getAttribute('data-id')));
    expect(empty).toHaveLength(1);
    await page.getByTestId('deal').click();
    await expect(page.getByTestId('card')).toHaveAttribute('data-id', empty[0]!);

    await page.getByTestId('export-btn').click();
    const md = page.getByTestId('export');
    await expect(md).toBeVisible();
    await expect(md).toContainText('## SFDIPOT — product elements');
    await expect(md).toContainText('## HICCUPPS(F) — consistency oracles');
    await expect(md).toContainText('- [ ] idea for sf-data');
    expect(((await md.textContent())!.match(/^- \[ \] /gm) || []).length).toBe(15);
    expect(((await md.textContent())!.match(/\(no ideas yet\)/g) || []).length).toBe(1);
  });
});
