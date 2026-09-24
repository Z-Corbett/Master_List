import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/081-test-report-explorer.html';
const count = async (page: Page, key: string) => Number(await page.getByTestId('tile-' + key).getAttribute('data-count'));
const rows = (page: Page) => page.getByTestId('test-row');

test.describe('Test Report Explorer', () => {
  test('summary tiles add up and each one filters the tree to exactly its count', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    const all = await count(page, 'all');
    const parts = await Promise.all(['passed', 'failed', 'flaky', 'skipped'].map((k) => count(page, k)));
    expect(all).toBe(66);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(all);
    await expect(rows(page)).toHaveCount(all);
    for (const k of ['passed', 'failed', 'flaky', 'skipped']) {
      await page.getByTestId('tile-' + k).click();
      await expect(page.getByTestId('tile-' + k)).toHaveAttribute('aria-pressed', 'true');
      const n = await count(page, k);
      await expect(rows(page)).toHaveCount(n);
      const statuses = await rows(page).evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-status')))]);
      expect(statuses).toEqual(n ? [k] : []);
    }
    await page.getByTestId('tile-skipped').click(); // pressing the active tile again clears it
    await expect(rows(page)).toHaveCount(all);
    await expect(page.getByTestId('shown')).toHaveText(`${all} of ${all} shown`);
  });

  test('project, tag and search filters combine', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('project').selectOption('webkit');
    await expect(rows(page)).toHaveCount(22);
    expect(await rows(page).evaluateAll((els) => els.every((e) => e.getAttribute('data-project') === 'webkit'))).toBe(true);
    await page.getByTestId('tag').selectOption('@payments');
    await expect(rows(page)).toHaveCount(4);
    await page.getByTestId('search').fill('card');
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByTestId('file')).toHaveCount(1);
    await expect(page.getByTestId('file')).toHaveAttribute('data-file', 'checkout/cart.spec.ts');
    await page.getByTestId('search').fill('no such test');
    await expect(page.getByTestId('empty')).toBeVisible();
    await expect(page.getByTestId('shown')).toHaveText('0 of 66 shown');
  });

  test('a failed test shows three failing attempts, an expected/received diff and a trace', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    await page.getByTestId('chip-failed').click();
    await rows(page).first().click();
    await expect(page.getByTestId('detail-status')).toHaveText('failed');
    const tabs = page.getByTestId('attempt-tab');
    await expect(tabs).toHaveCount(3); // run + 2 retries
    expect(await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-status')))).toEqual(['failed', 'failed', 'failed']);
    await expect(page.getByTestId('error')).toHaveAttribute('data-kind', 'assert');
    await expect(page.getByTestId('diff-exp').locator('mark')).toHaveCount(1);
    await expect(page.getByTestId('diff-rec').locator('mark')).toHaveCount(1);
    await expect(page.locator('[data-testid="step"][data-error="true"]')).toHaveCount(1);
    // the trace opens on the failing action; picking another frame moves the snapshot
    const frames = page.getByTestId('trace-action');
    await expect(frames.last()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('snapshot-caption')).toContainText('failed here');
    await frames.first().click();
    await expect(page.getByTestId('snapshot-caption')).toContainText('page.goto');
    await expect(page.getByTestId('snapshot-caption')).toContainText('action 1 of');
    await tabs.nth(2).click();
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('error')).toBeVisible();
  });

  test('flaky tests fail first, pass on a retry, and step durations add up', async ({ page }) => {
    await page.goto(URL + '?seed=7');
    await page.getByTestId('tile-flaky').click();
    await rows(page).first().click();
    await expect(page.getByTestId('flaky-marker')).toBeVisible();
    await expect(page.getByTestId('flaky-note')).toContainText('then passed on retry');
    const st = await page.getByTestId('attempt-tab').evaluateAll((els) => els.map((e) => e.getAttribute('data-status')));
    expect(st.length).toBeGreaterThan(1);
    expect(st[st.length - 1]).toBe('passed');
    expect(st.slice(0, -1).every((s) => s === 'failed')).toBe(true);
    await page.getByTestId('attempt-tab').last().click();
    await expect(page.getByTestId('attempt')).toHaveAttribute('data-status', 'passed');
    await expect(page.getByTestId('error')).toHaveCount(0);
    const total = Number(await page.getByTestId('attempt').getAttribute('data-dur'));
    const top = await page.locator('[data-testid="step"][data-depth="0"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-dur'))));
    expect(top.reduce((a, b) => a + b, 0)).toBe(total);
    // hooks start collapsed; expanding shows the fixtures
    await expect(page.locator('[data-testid="step"][data-kind="fixture"]')).toHaveCount(0);
    await page.getByTestId('step-toggle').first().click();
    await expect(page.locator('[data-testid="step"][data-kind="fixture"]')).toHaveCount(3);
    await expect(page.getByTestId('step-toggle').first()).toHaveAttribute('aria-expanded', 'true');
  });

  test('the seed makes runs reproducible and different seeds differ; the tree is keyboard navigable', async ({ page }) => {
    await page.goto(URL + '?seed=42');
    const snap = async () => Promise.all(['passed', 'failed', 'flaky', 'skipped'].map((k) => count(page, k)));
    const a = await snap();
    const dur = await page.getByTestId('tile-duration').textContent();
    await page.reload();
    expect(await snap()).toEqual(a);
    await expect(page.getByTestId('tile-duration')).toHaveText(dur!);
    await page.getByTestId('seed').fill('43');
    await page.getByTestId('regen').click();
    await expect(page.getByTestId('runmeta')).toContainText('seed 43');
    expect(await page.getByTestId('tile-duration').textContent()).not.toBe(dur);

    await page.getByTestId('file-toggle').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows(page).first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(rows(page).nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
    await page.getByTestId('file-toggle').first().click();
    await expect(page.getByTestId('file-toggle').first()).toHaveAttribute('aria-expanded', 'false');
  });
});
