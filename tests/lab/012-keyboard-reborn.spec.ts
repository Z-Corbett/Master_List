import { test, expect } from '@playwright/test';

const URL = '/lab/012-keyboard-reborn.html';

test.describe('Keyboard Reborn — CSS keyboard, synth and typing test', () => {
  test('physical key presses animate the matching CSS keys', async ({ page }) => {
    await page.goto(URL);
    const j = page.getByTestId('key-KeyJ');
    await expect(j).not.toHaveClass(/\bdown\b/);
    await page.keyboard.down('j');
    await expect(j).toHaveClass(/\bdown\b/);
    await expect(page.getByTestId('last-key')).toHaveText('KeyJ');
    await expect(page.getByTestId('last-char')).toHaveText('j');
    await page.keyboard.up('j');
    await expect(j).not.toHaveClass(/\bdown\b/);

    await page.keyboard.down('Shift');
    await expect(page.getByTestId('key-ShiftLeft')).toHaveClass(/\bdown\b/);
    await page.keyboard.up('Shift');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('last-key')).toHaveText('ArrowUp');
    await expect(page.getByTestId('presses')).toHaveText('3');
  });

  test('virtual keys are tappable and the finish toggle persists', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('key-KeyQ').click();
    await expect(page.getByTestId('last-key')).toHaveText('KeyQ');
    await expect(page.getByTestId('presses')).toHaveText('1');
    await expect(page.getByTestId('key-KeyQ')).not.toHaveClass(/\bdown\b/); // released after the tap

    await page.getByTestId('theme-toggle').click();
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('body')).toHaveClass(/graphite/);
  });

  test('synth mode starts audio only after a key gesture and maps keys to pitches', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('mode-synth').click();
    await expect(page.getByTestId('mode-synth')).toHaveAttribute('aria-selected', 'true');
    // choosing the mode is not enough to create an AudioContext
    expect(await page.evaluate(() => (window as any).__kb.audioState())).toBe('none');

    await page.keyboard.down('h');
    await expect(page.getByTestId('note-readout')).toHaveText('A4 · 440.0 Hz');
    expect(await page.evaluate(() => (window as any).__kb.audioState())).not.toBe('none');
    expect(await page.evaluate(() => (window as any).__kb.voices())).toBe(1);
    await page.keyboard.up('h');
    expect(await page.evaluate(() => (window as any).__kb.voices())).toBe(0);

    await page.getByTestId('oct-up').click();
    await expect(page.getByTestId('octave')).toHaveText('+1');
    await expect(page.getByTestId('key-KeyH')).toHaveAttribute('data-midi', '81');
    await page.getByTestId('key-KeyW').click(); // C#4 → C#5 after the octave shift, via a tap
    await expect(page.getByTestId('note-readout')).toHaveText('C♯5 · 554.4 Hz');
  });

  test('typing test measures WPM and accuracy against a controlled clock', async ({ page }) => {
    test.setTimeout(90_000); // ~110 real keystrokes; slow when other suites share the CPU
    await page.emulateMedia({ reducedMotion: 'reduce' }); // flat board, no caret blink: cheaper paints per keystroke
    await page.clock.install({ time: new Date('2026-09-22T09:00:00') });
    await page.goto(`${URL}?seed=0&mode=type`);
    // freeze time so only runFor() moves it — real typing latency must not count
    await page.clock.pauseAt(new Date('2026-09-22T09:05:00'));
    const passage = page.getByTestId('passage');
    const text = (await passage.getAttribute('data-text'))!;
    expect(text.length).toBeGreaterThan(50);

    await page.keyboard.type(text[0]);
    await page.clock.runFor(60_000); // exactly one minute passes between first and last keystroke
    await page.keyboard.type(text.slice(1));

    await expect(page.getByTestId('result')).toBeVisible();
    await expect(page.getByTestId('final-wpm')).toHaveText(`${Math.round(text.length / 5)} WPM`);
    await expect(page.getByTestId('accuracy')).toHaveText('100%');
    await expect(page.getByTestId('timer')).toHaveText('1:00');
  });

  test('mistakes are marked, backspace corrects them, Esc deals a new passage', async ({ page }) => {
    await page.goto(`${URL}?seed=1&mode=type`);
    const passage = page.getByTestId('passage');
    const text = (await passage.getAttribute('data-text'))!;
    const wrong = text[0] === 'x' ? 'z' : 'x';

    await expect(page.getByTestId(`key-Key${text[0].toUpperCase()}`)).toHaveClass(/\bnext\b/);
    await page.keyboard.type(wrong);
    await expect(passage.locator('.w')).toHaveCount(1);
    await expect(page.getByTestId('accuracy')).toHaveText('0%');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text[0]);
    await expect(passage.locator('.w')).toHaveCount(0);
    await expect(passage.locator('.c')).toHaveCount(1);
    await expect(page.getByTestId('accuracy')).toHaveText('50%');

    await page.keyboard.press('Escape');
    await expect(passage).not.toHaveAttribute('data-text', text);
    await expect(page.getByTestId('accuracy')).toHaveText('100%');
    await expect(passage.locator('.c')).toHaveCount(0);
  });
});
