import { test, expect, type Page } from '@playwright/test';

const VERS = ['1.2.2', '1.2.3', '1.2.7', '1.2.8', '1.2.9', '1.4.6', '1.9.9', '2.0.0-rc.1', '2.0.0', '2.3.9', '0.2.5', '0.3.0', '0.0.3', '0.0.4', '1.2.3-alpha.7', '3.4.5-alpha.9', '1.1.9+build.5'];
// versions satisfying a range, read from the truth table column
async function matches(page: Page, col: number) {
  const out: string[] = [];
  for (let i = 0; i < VERS.length; i++) if ((await page.getByTestId(`cell-${i}-${col}`).getAttribute('data-ok')) === 'true') out.push(VERS[i]);
  return out;
}
const next = (page: Page) => page.getByTestId('next-version');

test.describe('SemVer Lab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/054-semver-lab.html');
  });

  test('a feature release bumps the minor and groups the changelog', async ({ page }) => {
    await page.getByTestId('preset-feature').click();
    await expect(next(page)).toHaveAttribute('data-v', '1.5.0');
    await expect(page.getByTestId('bump')).toHaveText('minor');
    await expect(page.getByTestId('commit')).toHaveCount(6);
    await expect(page.locator('[data-testid="commit"][data-valid="false"]')).toContainText('Update README');
    const md = (await page.getByTestId('changelog-raw').textContent())!;
    expect(md).toMatch(/^## 1\.5\.0 \(\d{4}-\d\d-\d\d\)/);
    expect(md).toContain('### Features\n\n* **search:** add fuzzy matching for product names');
    expect(md).toContain('### Bug Fixes\n\n* **cart:** keep quantity when a variant changes');
    expect(md).toContain('### Performance Improvements\n\n* **images:** lazy-decode thumbnails');
    expect(md).toContain('_Not in changelog: 1 docs, 1 chore._');
    expect(md).not.toContain('BREAKING');
  });

  test('breaking changes via ! and footer; 0.x bumps the minor unless opted out', async ({ page }) => {
    await page.getByTestId('preset-breaking').click();
    await expect(next(page)).toHaveAttribute('data-v', '2.0.0');
    await expect(page.getByTestId('bump')).toHaveText('major');
    await expect(page.locator('[data-testid="commit"][data-breaking="true"]')).toHaveCount(2);
    const md = (await page.getByTestId('changelog-raw').textContent())!;
    expect(md).toContain('### ⚠ BREAKING CHANGES\n\n* **api:** remove the v1 /orders endpoints\n* **auth:** `auth.refresh()` now returns a Promise.');

    await page.getByTestId('current').fill('0.3.1');
    await expect(next(page)).toHaveAttribute('data-v', '0.4.0');
    await expect(page.getByTestId('reason')).toContainText('0.x: breaking change bumps the minor');
    await page.getByTestId('zero-minor').uncheck();
    await expect(next(page)).toHaveAttribute('data-v', '1.0.0');

    // lowercase footer is not a breaking change marker (the token is case-sensitive)
    await page.getByTestId('current').fill('1.0.0');
    await page.getByTestId('commits').fill('fix: tidy\n\nbreaking change: not really\n---\ndocs: notes');
    await expect(next(page)).toHaveAttribute('data-v', '1.0.1');
  });

  test('pre-release channels: start, continue, escalate and graduate', async ({ page }) => {
    await page.getByTestId('preset-feature').click();
    await page.getByTestId('channel').selectOption('rc');
    await expect(next(page)).toHaveAttribute('data-v', '1.5.0-rc.0');
    await page.getByTestId('current').fill('1.5.0-rc.0');
    await page.getByTestId('preset-patch').click();
    await expect(next(page)).toHaveAttribute('data-v', '1.5.0-rc.1');
    await page.getByTestId('channel').selectOption('beta');
    await expect(next(page)).toHaveAttribute('data-v', '1.5.0-beta.0');
    await page.getByTestId('channel').selectOption('rc');
    await page.getByTestId('preset-breaking').click();
    await expect(next(page)).toHaveAttribute('data-v', '2.0.0-rc.0');
    await expect(page.getByTestId('reason')).toContainText('only promises a minor bump');
    await page.getByTestId('preset-patch').click();
    await page.getByTestId('channel').selectOption('');
    await expect(next(page)).toHaveAttribute('data-v', '1.5.0');
    await expect(page.getByTestId('bump')).toHaveText('graduate');
  });

  test('no releasable commits, and an invalid current version', async ({ page }) => {
    await page.getByTestId('preset-chores').click();
    await expect(next(page)).toHaveAttribute('data-v', '');
    await expect(page.getByTestId('bump')).toHaveText('no release');
    await page.getByTestId('preset-patch').click();
    await expect(next(page)).toHaveAttribute('data-v', '1.4.3');
    await page.getByTestId('current').fill('1.4');
    await expect(page.getByTestId('bump')).toHaveText('invalid');
    await expect(page.getByTestId('reason')).toContainText('not valid SemVer');
    await page.getByTestId('current').fill('v1.4.2');
    await expect(next(page)).toHaveAttribute('data-v', '1.4.3');
  });

  test('range resolver follows node-semver: documented examples and desugaring', async ({ page }) => {
    await page.getByTestId('tab-ranges').click();
    await expect(page.getByTestId('tab-ranges')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('truth-table')).toBeVisible();
    // from the node-semver README
    expect(await matches(page, 3)).toEqual(['1.2.7', '1.2.9', '1.4.6', '1.9.9']);
    // releases above it match; of the pre-releases only the same-tuple 1.2.3-alpha.7 does (not 3.4.5-alpha.9 or 2.0.0-rc.1)
    expect(await matches(page, 8)).toEqual(['1.2.3', '1.2.7', '1.2.8', '1.2.9', '1.4.6', '1.9.9', '2.0.0', '2.3.9', '1.2.3-alpha.7']);
    expect(await matches(page, 0)).toEqual(['1.2.3', '1.2.7', '1.2.8', '1.2.9', '1.4.6', '1.9.9']);
    expect(await matches(page, 6)).toEqual(['0.2.5']);
    expect(await matches(page, 7)).toEqual(['0.0.3']);
    expect(await matches(page, 9)).toEqual(['0.2.5', '0.3.0', '0.0.3', '0.0.4', '1.1.9+build.5']); // build metadata ignored
    await expect(page.getByTestId('desugar-6')).toContainText('>=0.2.3 <0.3.0-0');
    await expect(page.getByTestId('desugar-4')).toContainText('>=1.2.3 <2.4.0-0');
    await expect(page.getByTestId('desugar-9')).toContainText('<1.2.0-0');
    await expect(page.getByTestId('max-4')).toHaveText('2.3.9');

    // why is 2.0.0-rc.1 outside ^1.2.3 but 1.2.3-alpha.7 inside >1.2.3-alpha.3?
    await page.getByTestId('cell-7-0').click();
    await expect(page.getByTestId('explain')).toContainText('fails <2.0.0-0');
    await page.getByTestId('cell-15-8').click();
    await expect(page.getByTestId('explain')).toContainText('is a pre-release and no comparator here names a pre-release of 3.4.5');
  });

  test('edit ranges live; keyboard tabs; state persists', async ({ page }) => {
    await page.getByTestId('tab-release').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-ranges')).toBeFocused();
    await expect(page.getByTestId('tab-ranges')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('ranges').fill('~1.2\n>=2.0.0-rc.0 <2.0.0\nnot a range');
    await expect(page.getByTestId('desugar-0')).toContainText('>=1.2.0 <1.3.0-0');
    await expect(page.getByTestId('desugar-2')).toContainText("can't parse");
    expect(await matches(page, 1)).toEqual(['2.0.0-rc.1']);
    await page.reload();
    await expect(page.getByTestId('tab-ranges')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('ranges')).toHaveValue('~1.2\n>=2.0.0-rc.0 <2.0.0\nnot a range');
  });
});
