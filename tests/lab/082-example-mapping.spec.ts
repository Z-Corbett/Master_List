import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/082-example-mapping.html';
const col = (page: Page, i: number) => page.getByTestId('rule-col').nth(i);
const exCount = (page: Page, i: number) => col(page, i).getByTestId('example');

test.describe('Example Mapping', () => {
  test('the sample story loads with a verdict; adding cards updates counts, Gherkin and survives a reload', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('rule')).toHaveCount(3);
    await expect(page.getByTestId('n-examples')).toHaveText('4');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'ready');

    await page.getByTestId('add-rule').click();
    await expect(page.getByTestId('rule-text').nth(3)).toBeFocused();
    await page.getByTestId('rule-text').nth(3).fill('Gift cards cannot buy other gift cards');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'examples'); // the new rule has no example
    await expect(page.getByTestId('verdict-title')).toHaveText('1 rule without an example');
    await col(page, 3).getByTestId('add-example').click();
    await col(page, 3).getByTestId('example-text').fill('The one where a gift card is in the basket\nGiven a gift card in my basket\nWhen I pay with a gift card\nThen I am asked to use another payment method');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'ready');

    const g = page.getByTestId('gherkin');
    await expect(g).toContainText('Feature: Pay with a gift card');
    await expect(g).toContainText('# Open question: Can a gift card pay for shipping?');
    await expect(g).toContainText('Rule: Gift cards cannot buy other gift cards');
    await expect(g).toContainText('Example: The one where a gift card is in the basket');
    await expect(g).toContainText('Then I am asked to use another payment method');
    expect(((await g.textContent())!.match(/^\s*Rule:/gm) || []).length).toBe(4);
    expect(((await g.textContent())!.match(/^\s*Example:/gm) || []).length).toBe(5);

    await page.reload();
    await expect(page.getByTestId('rule')).toHaveCount(4);
    await expect(page.getByTestId('rule-text').nth(3)).toHaveValue('Gift cards cannot buy other gift cards');
    await expect(page.getByTestId('n-examples')).toHaveText('5');
  });

  test('keyboard moves an example between rules and reorders it', async ({ page }) => {
    await page.goto(URL);
    const moving = col(page, 0).getByTestId('example').nth(1);
    const id = await moving.getAttribute('data-id');
    await col(page, 0).getByTestId('grip').nth(1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(exCount(page, 0)).toHaveCount(1);
    await expect(exCount(page, 1)).toHaveCount(2);
    await expect(page.getByTestId('announce')).toContainText('rule 2');
    await expect(page.locator(`[data-grip="${id}"]`)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(exCount(page, 1).first()).toHaveAttribute('data-id', id!);
    await page.keyboard.press('ArrowRight');
    await expect(exCount(page, 2)).toHaveCount(2);
    await page.keyboard.press('ArrowRight'); // nowhere further right
    await expect(page.getByTestId('announce')).toContainText('No rule further right');
    await expect(exCount(page, 2)).toHaveCount(2);
  });

  test('pointer drag drops an example into another rule', async ({ page }) => {
    await page.goto(URL);
    const grip = col(page, 0).getByTestId('grip').nth(1);
    const target = col(page, 1).getByTestId('add-example');
    // centre the gap between grip and drop zone so both are on screen (phones stack the rules vertically)
    const mid = async () => ((await grip.boundingBox())!.y + (await target.boundingBox())!.y) / 2;
    await page.evaluate((y) => window.scrollBy(0, y - window.innerHeight / 2), await mid());
    const from = (await grip.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 20, to.y - 10, { steps: 8 });
    await page.mouse.move(to.x + 24, to.y - 6, { steps: 2 });
    await page.mouse.up();
    await expect(exCount(page, 0)).toHaveCount(1);
    await expect(exCount(page, 1)).toHaveCount(2);
    await expect(exCount(page, 1).last().getByTestId('example-text')).toHaveValue(/balance runs out/);
    const txt = (await page.getByTestId('gherkin').textContent())!;
    expect(txt.indexOf('balance runs out')).toBeGreaterThan(txt.indexOf('Rule: Expired gift cards are refused'));
  });

  test('readiness: too many questions, then too many rules means split', async ({ page }) => {
    await page.goto(URL);
    for (let i = 0; i < 2; i++) {
      await page.getByTestId('add-question').click();
      await page.getByTestId('question-text').last().fill('Open question ' + (i + 2));
    }
    await expect(page.getByTestId('n-questions')).toHaveText('3');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'questions');
    await expect(page.getByTestId('stamp')).toHaveText('Not ready');
    await page.getByTestId('max-questions').fill('3'); // the team decides three is fine
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'ready');
    await page.getByTestId('del-question').last().click();
    await page.getByTestId('max-questions').fill('2');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'ready');

    for (let i = 0; i < 2; i++) await page.getByTestId('add-rule').click();
    await expect(page.getByTestId('n-rules')).toHaveText('5');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'split');
    await expect(page.getByTestId('verdict-title')).toContainText('split the story');
    await page.getByTestId('del-rule').last().click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'examples');
  });

  test('the 25-minute timebox counts down, pauses, and calls time with the verdict', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-03-02T10:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-03-02T10:00:01Z'));
    await expect(page.getByTestId('clock')).toHaveText('25:00');
    await page.getByTestId('timer-toggle').click();
    await page.clock.fastForward('05:00');
    await expect(page.getByTestId('clock')).toHaveText('20:00');
    await page.getByTestId('timer-toggle').click();
    await expect(page.getByTestId('timer-toggle')).toHaveText('Resume');
    await page.clock.fastForward('10:00'); // paused: nothing moves
    await expect(page.getByTestId('clock')).toHaveText('20:00');
    await page.getByTestId('timer-toggle').click();
    await page.clock.fastForward('20:01');
    await expect(page.getByTestId('clock')).toHaveText('00:00');
    await expect(page.getByTestId('timer')).toHaveAttribute('data-state', 'over');
    await expect(page.getByTestId('timer-status')).toHaveText("Time's up. Verdict: Ready, with a question parked.");
    await page.getByTestId('timer-reset').click();
    await expect(page.getByTestId('clock')).toHaveText('25:00');
  });
});
