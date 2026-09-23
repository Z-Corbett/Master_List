import { test, expect } from '@playwright/test';

test.describe('Context Window', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab/022-context-window.html');
  });

  test('default scenario overflows by 400 tokens; each strategy makes it fit its own way', async ({ page }) => {
    // 56,400 input + 8,000 reserved output vs a 64,000 window
    await expect(page.getByTestId('overflow')).toContainText('Overflows by 400 tokens');
    await expect(page.getByTestId('sent-status')).toContainText('Still overflowing');

    await page.getByTestId('strat-drop').click();
    await expect(page.getByTestId('changes')).toHaveText('Dropped Turn 1 (2.1K)');
    await expect(page.getByTestId('sent-status')).toContainText('Fits');

    await page.getByTestId('strat-summarize').click();
    await expect(page.getByTestId('changes')).toContainText('Summarised 3 older turns: 7.1K → 852');
    await expect(page.getByTestId('sent-status')).toContainText('Fits');

    await page.getByTestId('strat-retrieve').click();
    await expect(page.getByTestId('changes')).toContainText('API reference: 18K → 2.7K');
    // the assembled bar is unchanged by any strategy
    await expect(page.getByTestId('overflow')).toContainText('Overflows by 400 tokens');
  });

  test('window size and output reserve change the budget', async ({ page }) => {
    await page.getByTestId('win-128k').click();
    await expect(page.getByTestId('window-size')).toHaveText('128K');
    await expect(page.getByTestId('overflow')).toContainText('Fits, with 63,600 tokens to spare');
    await page.getByTestId('win-8k').click();
    await page.getByTestId('strat-retrieve').click();
    await expect(page.getByTestId('sent-status')).toContainText('This strategy is not enough');
    await page.getByTestId('win-64k').click();
    await page.getByTestId('strat-none').click();
    await page.getByTestId('output-slider').fill('4000');
    await expect(page.getByTestId('output-reserve')).toHaveText('4K');
    await expect(page.getByTestId('overflow')).toContainText('Fits, with 3,600 tokens to spare');
  });

  test('prompt cache: write, hit, then a reorder above the breakpoint misses', async ({ page }) => {
    await page.getByTestId('win-128k').click();
    await expect(page.getByTestId('prefix-tokens')).toHaveText('31.7K');
    await page.getByTestId('send-turn').click();
    await expect(page.getByTestId('turn-0')).toContainText('cache write — 31.7K written');
    await page.getByTestId('send-turn').click();
    await expect(page.getByTestId('turn-1')).toContainText('HIT');
    await expect(page.getByTestId('turn-1')).toContainText('31.7K prefix tokens reused');
    // a new history turn was appended before the user message each time
    await expect(page.getByTestId('sequence').locator('li')).toHaveCount(13);

    await page.getByTestId('sequence').getByRole('button', { name: 'Move Codebase map down' }).click();
    await page.getByTestId('send-turn').click();
    await expect(page.getByTestId('turn-2')).toContainText('MISS');
    await expect(page.getByTestId('turn-2')).toContainText('prefix changed');
  });

  test('volatile content inside the cached prefix is flagged', async ({ page }) => {
    await expect(page.getByTestId('volatile-warning')).toBeHidden();
    await page.getByTestId('bp-6').click(); // pin after "Turn 3"
    await expect(page.getByTestId('bp-6')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('volatile-warning')).toBeVisible();
    await expect(page.getByTestId('volatile-warning')).toContainText('Turn 1, Turn 2, Turn 3 are inside the cached prefix');
    await expect(page.getByTestId('prefix-tokens')).toHaveText('38.8K');
  });

  test('adding blocks: tap from the palette and estimate your own text', async ({ page }) => {
    await page.getByTestId('add-5').click(); // Large source file, 40K
    const seq = page.getByTestId('sequence').locator('li');
    await expect(seq).toHaveCount(12);
    await expect(seq.nth(10)).toContainText('Large source file');
    await expect(seq.nth(11)).toContainText('User message');
    await expect(page.getByTestId('overflow')).toContainText('Overflows by 40,400 tokens');

    await page.getByTestId('est-text').fill('x'.repeat(400));
    await expect(page.getByTestId('est-result')).toContainText('≈ 100 tokens');
    await page.getByTestId('est-add').click();
    await expect(seq).toHaveCount(13);
    await expect(seq.nth(11)).toContainText('custom · 100');
  });

  test('drag a block onto the bar to insert it at that position', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse drag path; touch users tap to add (covered above)');
    // bring both the palette and the bar into the viewport
    await page.evaluate(() => window.scrollTo(0, 280));
    const src = page.getByTestId('add-0');
    const s = (await src.boundingBox())!;
    const bar = (await page.getByTestId('bar-assembled').boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + 3, bar.y + bar.height / 2, { steps: 10 });
    await expect(page.getByTestId('bar-assembled')).toHaveClass(/drop/);
    await page.mouse.up();
    const seq = page.getByTestId('sequence').locator('li');
    await expect(seq).toHaveCount(12);
    await expect(seq.nth(0)).toContainText('System prompt');
    await expect(seq.nth(1)).toContainText('System prompt');
  });
});
