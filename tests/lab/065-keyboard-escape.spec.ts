import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/065-keyboard-escape.html';
const stage = (page: Page) => page.getByTestId('stage');

// Keys go to the focused stage; the game captures Tab, so the browser never moves real focus.
async function keys(page: Page, ...seq: string[]) {
  await stage(page).focus();
  for (const k of seq) await page.keyboard.press(k);
}
async function diagnoseAndFix(page: Page, flaw: string) {
  await page.getByTestId('diag-' + flaw).click();
  await page.getByTestId('fix-toggle').click();
  await expect(page.getByTestId('fix-toggle')).toHaveAttribute('aria-checked', 'true');
}

test.describe('Keyboard Escape Room', () => {
  test('room I: the newsletter dialog traps Tab and ignores Esc until fixed', async ({ page }) => {
    await page.goto(URL);
    await keys(page, 'Tab');
    await expect(stage(page)).toHaveAttribute('data-focus', 'email');
    await keys(page, 'Tab', 'Tab');
    await expect(stage(page)).toHaveAttribute('data-focus', 'email'); // wrapped: only two stops, both inside the dialog
    await expect(page.getByTestId('log')).toContainText('Still inside the dialog');
    await keys(page, 'Escape');
    await expect(page.getByTestId('log').locator('li').first()).toContainText('doesn’t listen for Escape');

    await page.getByTestId('diag-order').click();
    await expect(page.getByTestId('diag-result')).toContainText('Not that');
    await expect(page.getByTestId('explain')).toBeHidden();
    await page.getByTestId('diag-trap').click();
    await expect(page.getByTestId('wcag').locator('[data-sc="2.1.2"]')).toContainText('No Keyboard Trap');
    await expect(page.getByTestId('wcag').locator('[data-sc="2.1.2"]')).toContainText('A');
    await page.getByTestId('fix-toggle').click();

    await keys(page, 'Escape');
    await expect(stage(page)).toHaveAttribute('data-focus', 'new');
    await keys(page, 'Tab', 'Tab');
    await expect(stage(page)).toHaveAttribute('data-focus', 'exit');
    await expect(page.getByTestId('announce')).toContainText('“Exit door”, button');
    await keys(page, 'Enter');
    await expect(page.getByTestId('escaped')).toBeVisible();
    await expect(page.getByTestId('door-1')).toHaveAttribute('data-escaped', 'true');
  });

  test('room III on the touch key pad: a div "button" ignores Enter and Space; pointer shows a note', async ({ page }) => {
    await page.goto(URL + '?room=3');
    await expect(page.getByTestId('room-name')).toHaveText('The Stubborn Door');
    await stage(page).click();
    await expect(page.getByTestId('mouse-note')).toBeVisible();
    for (let i = 0; i < 4; i++) await page.getByTestId('pad-tab').click();
    await expect(stage(page)).toHaveAttribute('data-focus', 'exit');
    await expect(page.getByTestId('announce')).toContainText('(no role)');
    await page.getByTestId('pad-enter').click();
    await expect(page.getByTestId('log').locator('li').first()).toContainText('only listens for click');
    await page.getByTestId('pad-shift-tab').click();
    await page.getByTestId('pad-shift-tab').click();
    await expect(stage(page)).toHaveAttribute('data-focus', 'remember');
    await page.getByTestId('pad-space').click();
    await expect(page.getByTestId('announce')).toContainText('checked');
    await expect(page.getByTestId('announce')).not.toContainText('not checked');

    await diagnoseAndFix(page, 'divbutton');
    await expect(page.getByTestId('wcag')).toContainText('4.1.2 Name, Role, Value');
    await page.getByTestId('pad-tab').click();
    await page.getByTestId('pad-tab').click();
    await expect(page.getByTestId('announce')).toContainText('“Exit door”, button');
    await page.getByTestId('pad-space').click();
    await expect(page.getByTestId('escaped')).toBeVisible();
    await expect(page.getByTestId('escaped-msg')).toContainText('keystrokes');
  });

  test('room IV: positive tabindex reorders focus and tabindex=-1 hides the door', async ({ page }) => {
    await page.goto(URL + '?room=4');
    const order: string[] = [];
    await stage(page).focus();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      order.push((await stage(page).getAttribute('data-focus'))!);
    }
    expect(order).toEqual(['privacy', 'help', 'fname', 'femail', 'fmsg', 'privacy']);
    await diagnoseAndFix(page, 'order');
    await expect(page.getByTestId('wcag')).toContainText('2.4.3 Focus Order');
    await stage(page).focus();
    await page.keyboard.press('Shift+Tab'); // from privacy back to the now-reachable door
    await expect(stage(page)).toHaveAttribute('data-focus', 'exit');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('door-4')).toHaveAttribute('data-escaped', 'true');
  });

  test('rooms II and V: invisible ring, arrow-key radios, focus sent off-screen', async ({ page }) => {
    await page.goto(URL + '?room=2');
    await keys(page, 'Tab', 'Tab', 'Tab');
    await expect(stage(page)).toHaveAttribute('data-focus', 'th-light');
    await expect(stage(page)).toHaveAttribute('data-ring', 'hidden');
    await expect(page.locator('#app .vf')).toHaveCount(0);
    await keys(page, 'ArrowRight');
    await expect(stage(page)).toHaveAttribute('data-focus', 'th-dark');
    await expect(page.locator('#app')).toHaveClass(/dark/);
    await keys(page, 'Tab');
    await expect(stage(page)).toHaveAttribute('data-focus', 'del'); // one tab stop for the whole radio group
    await diagnoseAndFix(page, 'invisible');
    await expect(stage(page)).toHaveAttribute('data-ring', 'visible');
    await expect(page.locator('#app .vf')).toHaveText('Delete all notes');

    await page.getByTestId('door-5').click();
    await expect(page.getByTestId('room-name')).toHaveText('The Vanishing Drawer');
    await keys(page, 'Tab', 'Tab');
    await expect(stage(page)).toHaveAttribute('data-focus', 'd-inbox');
    await expect(stage(page)).toHaveAttribute('data-ring', 'offscreen');
    await keys(page, 'Tab', 'Tab', 'Tab', 'Enter');
    await expect(page.getByTestId('log').locator('li').first()).toContainText('couldn’t see');
    await diagnoseAndFix(page, 'offscreen');
    await expect(page.getByTestId('explain')).toContainText('2.4.11 Focus Not Obscured (Minimum)');
    await keys(page, 'Tab'); // focus was orphaned in the now-inert drawer, so Tab restarts at Menu
    await expect(stage(page)).toHaveAttribute('data-focus', 'menu');
    await keys(page, 'Enter', 'Tab');
    await expect(stage(page)).toHaveAttribute('data-focus', 'd-inbox'); // open drawer: visible and reachable
    await expect(stage(page)).toHaveAttribute('data-ring', 'visible');
    await keys(page, 'Escape');
    await expect(stage(page)).toHaveAttribute('data-focus', 'menu');
    await keys(page, 'Tab', 'Tab', 'Enter');
    await expect(page.getByTestId('door-5')).toHaveAttribute('data-escaped', 'true');
  });

  test('escaping all five rooms persists and awards the certificate', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(URL);
    const plan: [number, string, string[]][] = [
      [1, 'trap', ['Escape', 'Tab', 'Tab', 'Enter']],
      [2, 'invisible', ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Enter']],
      [3, 'divbutton', ['Tab', 'Tab', 'Tab', 'Tab', 'Enter']],
      [4, 'order', ['Tab', 'Tab', 'Tab', 'Tab', 'Enter']],
    ];
    for (const [n, flaw, seq] of plan) {
      await page.getByTestId('door-' + n).click();
      await diagnoseAndFix(page, flaw);
      await keys(page, ...seq);
      await expect(page.getByTestId('door-' + n)).toHaveAttribute('data-escaped', 'true');
    }
    await expect(page.getByTestId('certificate')).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('door-4')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('door-2')).toHaveAttribute('data-escaped', 'true');
    await page.getByTestId('door-5').click();
    await diagnoseAndFix(page, 'offscreen');
    await keys(page, 'Tab', 'Tab', 'Tab', 'Enter');
    await expect(page.getByTestId('certificate')).toBeVisible();
    await expect(page.getByTestId('next-room')).toHaveText(/certificate/);
    await page.getByTestId('reset').click();
    await expect(page.getByTestId('certificate')).toBeHidden();
    await expect(page.getByTestId('door-1')).toHaveAttribute('data-escaped', 'false');
  });
});
