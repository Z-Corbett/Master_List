import { test, expect } from '@playwright/test';

const URL = '/lab/005-agent-loop.html';

test.describe('005 Agent Loop', () => {
  test('stepping walks the loop and drives tests from red to green', async ({ page }) => {
    await page.goto(URL);
    const summary = page.getByTestId('test-summary');
    await expect(page.getByTestId('step-count')).toHaveText('0/10');
    await expect(summary).toHaveAttribute('data-state', 'idle');

    const step = page.getByTestId('step');
    await step.click(); // plan
    await expect(page.getByTestId('loop-node-plan')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('phase-label')).toHaveText('Plan');

    await step.click(); // run tests -> red
    await expect(page.getByTestId('loop-node-run')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('loop-node-plan')).toHaveAttribute('data-active', 'false');
    await expect(summary).toHaveAttribute('data-state', 'fail');
    await expect(summary).toContainText('1 failed');
    await expect(page.getByTestId('terminal')).toContainText('Expected: 90');

    // Step to the end
    for (let i = 0; i < 8; i++) await step.click();
    await expect(page.getByTestId('step-count')).toHaveText('10/10');
    await expect(page.getByTestId('loop-node-done')).toHaveAttribute('data-active', 'true');
    await expect(summary).toHaveAttribute('data-state', 'pass');
    await expect(summary).toContainText('3 passed');
    await expect(step).toBeDisabled();
  });

  test('edit step shows a real diff with added and removed lines', async ({ page }) => {
    await page.goto(URL);
    const step = page.getByTestId('step');
    for (let i = 0; i < 7; i++) await step.click();
    await expect(page.getByTestId('phase-label')).toHaveText('Edit');
    await expect(page.getByTestId('diff-file')).toHaveText('src/cart.js');
    await expect(page.getByTestId('diff-del')).toHaveCount(1);
    await expect(page.getByTestId('diff-add')).toContainText('total = applyDiscount(total, code);');
  });

  test('token and tool-call counters accumulate and reset on restart', async ({ page }) => {
    await page.goto(URL);
    const tokens = page.getByTestId('tokens');
    const tools = page.getByTestId('tool-calls');
    await expect(tokens).toHaveText('0');

    await page.getByTestId('step').click(); // plan: 612 tokens, no tool
    await expect(tokens).toHaveText('612');
    await expect(tools).toHaveText('0');
    await page.getByTestId('step').click(); // run: +388, tool
    await expect(tokens).toHaveText('1,000');
    await expect(tools).toHaveText('1');

    await page.getByTestId('restart').click();
    await expect(tokens).toHaveText('0');
    await expect(tools).toHaveText('0');
    await expect(page.getByTestId('step-count')).toHaveText('0/10');
    await expect(page.getByTestId('test-summary')).toHaveAttribute('data-state', 'idle');
  });

  test('play auto-advances on a timer, respects speed, and pauses', async ({ page }) => {
    // install() alone leaves the fake clock ticking in real time; pauseAt() freezes it so
    // only runFor() moves time and step counts are exact even on a loaded CI box.
    await page.clock.install({ time: new Date('2026-09-01T20:00:00') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-01T20:01:00'));
    await page.getByTestId('speed').selectOption('2'); // 800ms per step
    const play = page.getByTestId('play');
    await play.click(); // executes step 1 immediately
    await expect(page.getByTestId('step-count')).toHaveText('1/10');
    await expect(play).toHaveAttribute('aria-label', 'Pause');

    await page.clock.runFor(1700); // two more steps at 2x
    await expect(page.getByTestId('step-count')).toHaveText('3/10');

    await play.click(); // pause
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await page.clock.runFor(5000);
    await expect(page.getByTestId('step-count')).toHaveText('3/10');

    await play.click();
    await page.clock.runFor(800 * 10);
    await expect(page.getByTestId('step-count')).toHaveText('10/10');
    await expect(page.getByTestId('test-summary')).toHaveAttribute('data-state', 'pass');
    await expect(play).toHaveAttribute('aria-label', 'Play');
  });

  test('switching scenario loads a different script and resets progress', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('step').click();
    await page.getByTestId('scenario-refactor').click();
    await expect(page.getByTestId('scenario-refactor')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('scenario-fix')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('step-count')).toHaveText('0/10');
    await expect(page.getByTestId('test-row')).toHaveCount(4);

    await page.getByTestId('scenario-feature').click();
    await expect(page.getByTestId('task')).toContainText('--json');
    const step = page.getByTestId('step');
    for (let i = 0; i < 4; i++) await step.click();
    // TDD: new tests are written first and fail
    await expect(page.getByTestId('test-summary')).toContainText('2 failed');
    await expect(page.getByTestId('test-row').filter({ hasText: '--json prints valid JSON' })).toHaveAttribute('data-status', 'fail');
  });
});
