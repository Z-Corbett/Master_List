import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';

// One shared contract for every page in the Lab. Page-specific behaviour lives in tests/lab/*.
const pages = readdirSync('lab/_meta')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`lab/_meta/${f}`, 'utf8')));

for (const meta of pages) {
  test.describe(`Lab ${meta.id} · ${meta.title}`, () => {
    test('loads clean: no console errors, no external requests', async ({ page, baseURL }) => {
      const errors: string[] = [];
      const external: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('request', (r) => {
        const u = r.url();
        if (!u.startsWith(baseURL!) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
      });
      await page.goto(`/${meta.file}`);
      await page.waitForLoadState('load');
      await page.waitForTimeout(500);
      expect(errors, 'console errors').toEqual([]);
      expect(external, 'external requests').toEqual([]);
    });

    test('has title, description, lang and a working back link', async ({ page }) => {
      await page.goto(`/${meta.file}`);
      await expect(page).toHaveTitle(/\S/);
      await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S{10,}/);
      const back = page.getByTestId('back-link');
      await expect(back).toBeVisible();
      await back.click();
      await expect(page).toHaveURL(/\/index\.html#lab$/);
      await expect(page.getByTestId('grid')).toBeVisible();
    });

    test('no horizontal page scroll', async ({ page }) => {
      await page.goto(`/${meta.file}`);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
}
