import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/070-agent-permissions.html';
const call = (page: Page, text: string) => page.getByTestId('call').filter({ hasText: text });
const rule = (page: Page, text: string) => page.locator(`[data-testid="rule"][data-rule="${text}"]`);

async function addCall(page: Page, tool: string, arg: string) {
  await page.getByTestId('call-tool').selectOption(tool);
  await page.getByTestId('call-arg').fill(arg);
  await page.getByTestId('add-call').click();
}

test.describe('Agent Permission Designer', () => {
  test('balanced preset: every sample call gets the right verdict and deciding rule', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('preset-balanced')).toHaveAttribute('aria-pressed', 'true');
    const got = await page.getByTestId('call').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-decision')} ${e.getAttribute('data-rule')}`.trim()));
    expect(got).toEqual([
      'run Read(**)', 'block Read(**/.env)', 'run Edit(src/**)', 'block Edit(**/*.env)', 'run Bash(npm test:*)', 'block Bash(curl:*)',
      'prompt Bash(git push:*)', 'block Bash(rm -rf:*)', 'prompt', 'prompt', 'prompt', 'prompt',
    ]);
    await expect(page.getByTestId('n-run')).toHaveText('3');
    await expect(page.getByTestId('n-prompt')).toHaveText('5');
    await expect(page.getByTestId('n-block')).toHaveText('4');
  });

  test('deny beats allow regardless of order, and the deciding rule is highlighted', async ({ page }) => {
    await page.goto(URL);
    await call(page, 'Read(.env)').click();
    await expect(rule(page, 'Read(**/.env)')).toHaveAttribute('data-deciding', 'true');
    await expect(rule(page, 'Read(**)')).toHaveAttribute('data-hit', 'true');
    await expect(rule(page, 'Read(**)')).toHaveAttribute('data-deciding', 'false');
    await expect(page.getByTestId('explain')).toContainText('Deny beats ask beats allow');

    // turning the deny into an ask: now ask beats the allow
    await rule(page, 'Read(**/.env)').locator('select').selectOption('ask');
    await expect(call(page, 'Read(.env)')).toHaveAttribute('data-decision', 'prompt');
    // deleting it leaves only the allow
    await rule(page, 'Read(**/.env)').getByRole('button', { name: /Delete rule/ }).click();
    await expect(call(page, 'Read(.env)')).toHaveAttribute('data-decision', 'run');
    await expect(page.getByTestId('preset-balanced')).toHaveAttribute('aria-pressed', 'false');
  });

  test('compound commands, prefixes and command substitution', async ({ page }) => {
    await page.goto(URL);
    await call(page, 'curl -s').click();
    await expect(page.getByTestId('explain')).toContainText('npm test: matches');
    await expect(page.getByTestId('explain')).toContainText('Compound command');
    await addCall(page, 'Bash', 'npm testify --all'); // not a whole-word prefix of "npm test"
    await expect(call(page, 'npm testify')).toHaveAttribute('data-decision', 'prompt');
    await addCall(page, 'Bash', 'git status; git push origin dev');
    await expect(call(page, 'git status; git push')).toHaveAttribute('data-decision', 'prompt');
    await expect(call(page, 'git status; git push')).toHaveAttribute('data-rule', 'Bash(git push:*)');
    await page.getByTestId('preset-permissive').click();
    await expect(call(page, 'echo $(cat')).toHaveAttribute('data-decision', 'prompt'); // allowed Bash, but substitution asks
    await expect(call(page, 'rm -rf node_modules')).toHaveAttribute('data-decision', 'run');
  });

  test('paths outside the project and the default for unmatched calls', async ({ page }) => {
    await page.goto(URL);
    const outside = call(page, 'Read(../other-project');
    await expect(outside).toHaveAttribute('data-decision', 'prompt');
    await expect(outside).toContainText('no rule matches: default ask');
    await outside.click();
    await expect(page.getByTestId('explain')).toContainText('outside the project');
    await page.getByTestId('default-deny').check();
    await expect(outside).toHaveAttribute('data-decision', 'block');
    await expect(call(page, 'WebFetch(https://docs')).toHaveAttribute('data-decision', 'block');
    await page.getByTestId('add-rule').click();
    const added = page.getByTestId('rule').last();
    await added.locator('select').selectOption('allow');
    await added.locator('input').fill('WebFetch(domain:example.com)');
    await expect(call(page, 'WebFetch(https://docs')).toHaveAttribute('data-decision', 'run'); // subdomain matches
    await added.locator('input').fill('Webfetch(docs)');
    await expect(page.getByTestId('rule-error')).toContainText('case-sensitive');
    await expect(added.locator('input')).toHaveAttribute('aria-invalid', 'true');
    await expect(call(page, 'WebFetch(https://docs')).toHaveAttribute('data-decision', 'block'); // invalid rule ignored
  });

  test('presets trade risk against friction, and the design persists', async ({ page }) => {
    await page.goto(URL);
    const score = async () => [Number(await page.getByTestId('risk').textContent()), Number(await page.getByTestId('friction').textContent())];
    await page.getByTestId('preset-permissive').click();
    const [pr, pf] = await score();
    await page.getByTestId('preset-balanced').click();
    const [br, bf] = await score();
    await page.getByTestId('preset-locked').click();
    const [lr, lf] = await score();
    expect(pr).toBeGreaterThan(br);
    expect(br).toBeGreaterThanOrEqual(lr);
    expect(lf).toBeGreaterThan(bf);
    expect(pf).toBe(0);
    expect(lr).toBe(0);
    await expect(call(page, 'Read(src/app.ts)')).toHaveAttribute('data-decision', 'prompt');
    await expect(page.getByTestId('default-deny')).toBeChecked();

    await page.reload();
    await expect(page.getByTestId('preset-locked')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('rule')).toHaveCount(5);
    await expect(page.getByTestId('friction')).toHaveText(String(lf));
  });
});
