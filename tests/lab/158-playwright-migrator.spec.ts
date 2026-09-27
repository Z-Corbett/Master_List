import { test, expect, Page, Browser, selectors } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PAGE = '/lab/158-playwright-migrator.html';

type Result = { code: string; rows: { status: string; input: string; out: string[]; notes: string[] }[]; report: Record<string, any>; maps: { from: string; to: string; why: string }[] };
const convert = (page: Page, src: string, lang: string): Promise<Result> =>
  page.evaluate(([s, l]) => (window as any).__migrator.convert(s, l), [src, lang]);

/** Wraps one snippet in a test, converts it, and returns the converted body lines (trimmed). */
async function body(page: Page, snippet: string, lang: 'cy' | 'wd' | 'py') {
  const src = lang === 'py'
    ? 'def test_x(driver):\n' + snippet.split('\n').map((l) => '    ' + l).join('\n') + '\n'
    : "it('x', async () => {\n" + snippet.split('\n').map((l) => '  ' + l).join('\n') + '\n});\n';
  const r = await convert(page, src, lang);
  const lines = r.code.split('\n');
  const a = lines.findIndex((l) => l.startsWith('test('));
  const b = lines.lastIndexOf('});');
  return lines.slice(a + 1, b).map((l) => l.trim()).filter(Boolean);
}

// Input → exact expected output. Written from the Playwright docs' mapping of each command, not from the page.
const CY_CASES: [string, string[]][] = [
  ["cy.visit('/cart')", ["await page.goto('/cart');"]],
  ["cy.get('#save').click()", ["await page.locator('#save').click();"]],
  ["cy.get('[data-testid=\"save\"]').dblclick()", ["await page.getByTestId('save').dblclick();"]],
  ["cy.get('[aria-label=\"Close\"]').click()", ["await page.getByLabel('Close').click();"]],
  ["cy.get('[placeholder=\"Search\"]').type('tacos{enter}')", ["await page.getByPlaceholder('Search').fill('tacos');", "await page.getByPlaceholder('Search').press('Enter');"]],
  ["cy.get('.todo').should('have.length', 3)", ["await expect(page.locator('.todo')).toHaveCount(3);"]],
  ["cy.get('.todo').eq(1).should('have.class', 'done')", ["await expect(page.locator('.todo').nth(1)).toContainClass('done');"]],
  ["cy.get('#agree').check().should('be.checked')", ["await page.locator('#agree').check();", "await expect(page.locator('#agree')).toBeChecked();"]],
  ["cy.get('select#size').select('Large')", ["await page.locator('select#size').selectOption('Large');"]],
  ["cy.get('.toast').should('not.exist')", ["await expect(page.locator('.toast')).toHaveCount(0);"]],
  ["cy.title().should('eq', 'Home')", ["await expect(page).toHaveTitle('Home');"]],
  ["cy.url().should('include', '/orders/')", ["await expect(page).toHaveURL(/\\/orders\\//);"]],
  ["cy.contains('Welcome')", ["await expect(page.getByText('Welcome')).toBeAttached();"]],
  ["cy.contains('a', 'Pricing').click()", ["await page.getByRole('link', { name: 'Pricing' }).click();"]],
  ["cy.get('a').should('have.attr', 'href', '/cart')", ["await expect(page.locator('a')).toHaveAttribute('href', '/cart');"]],
  ["cy.get('.menu').trigger('mouseover')", ["await page.locator('.menu').hover();"]],
  ["cy.get('input').clear().type('new')", ["await page.locator('input').fill('new');"]],
  ["cy.get('button').as('btn')\ncy.get('@btn').click()", ["const btn = page.locator('button');", 'await btn.click();']],
  ["cy.get('[data-cy=list] li').first().should('contain', 'Milk')", ["await expect(page.getByTestId('list').locator('li').first()).toContainText('Milk');"]],
  ["cy.get('[data-cy=card]').within(() => {\n  cy.get('h3').should('be.visible')\n})", ["const card = page.getByTestId('card');", "await expect(card.locator('h3')).toBeVisible();"]],
  ["cy.intercept('GET', '/api/items').as('items')\ncy.visit('/')\ncy.wait('@items')", [
    "const itemsResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/items' && r.request().method() === 'GET');",
    "await page.goto('/');",
    'await itemsResponse;',
  ]],
];
const WD_CASES: [string, string[]][] = [
  ["await driver.get('https://shop.example.test/')", ["await page.goto('https://shop.example.test/');"]],
  ["await driver.findElement(By.id('go')).click()", ["await page.locator('#go').click();"]],
  ["await driver.findElement(By.className('field')).clear()", ["await page.locator('.field').fill('');"]],
  ["await driver.findElement(By.css('[data-testid=\"q\"]')).sendKeys('boots', Key.ENTER)", ["await page.getByTestId('q').fill('boots');", "await page.getByTestId('q').press('Enter');"]],
  ["await driver.findElement(By.linkText('Help')).click()", ["await page.getByRole('link', { name: 'Help', exact: true }).click();"]],
  ["await driver.wait(until.elementIsVisible(driver.findElement(By.css('.modal'))), 3000)", ["await expect(page.locator('.modal')).toBeVisible();"]],
  ["await driver.wait(until.urlContains('/done'), 3000)", ["await expect(page).toHaveURL(/\\/done/);"]],
  ["assert.strictEqual(await driver.getTitle(), 'Cart')", ["await expect(page).toHaveTitle('Cart');"]],
  ["assert.equal(await driver.findElement(By.css('h1')).getText(), 'Hi')", ["await expect(page.locator('h1')).toHaveText('Hi');"]],
  ["await driver.navigate().refresh()", ['await page.reload();']],
];
const PY_CASES: [string, string[]][] = [
  ['driver.get("https://shop.example.test/")', ["await page.goto('https://shop.example.test/');"]],
  ['driver.find_element(By.NAME, "q").send_keys("x", Keys.ENTER)', ["await page.locator('[name=\"q\"]').fill('x');", "await page.locator('[name=\"q\"]').press('Enter');"]],
  ['assert driver.title == "Cart"', ["await expect(page).toHaveTitle('Cart');"]],
  ['assert len(driver.find_elements(By.CSS_SELECTOR, "li")) == 3', ["await expect(page.locator('li')).toHaveCount(3);"]],
  ['assert "Saved" in driver.find_element(By.ID, "msg").text', ["await expect(page.locator('#msg')).toContainText('Saved');"]],
  ['WebDriverWait(driver, 10).until(EC.invisibility_of_element_located((By.CLASS_NAME, "spinner")))', ["await expect(page.locator('.spinner')).toBeHidden();"]],
];

/** Braces, brackets and parens balance once strings, regex literals and comments are removed. */
function balanced(code: string) {
  const stripped = code
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n') // the converter only writes whole-line comments
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
    .replace(/\/(?:[^/\\\n]|\\.)+\/[a-z]*/g, '/r/');
  const stack: string[] = [];
  const pair: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const c of stripped) {
    if ('([{'.includes(c)) stack.push(c);
    else if (c in pair) { if (stack.pop() !== pair[c]) return false; }
  }
  return stack.length === 0;
}

test.describe('158 Playwright Migrator', () => {
  test('Cypress commands convert to the exact expected Playwright lines', async ({ page }) => {
    await page.goto(PAGE);
    for (const [input, expected] of CY_CASES) expect(await body(page, input, 'cy'), input).toEqual(expected);
  });

  test('Selenium WebDriver (JavaScript and Python) converts to the exact expected lines', async ({ page }) => {
    await page.goto(PAGE);
    for (const [input, expected] of WD_CASES) expect(await body(page, input, 'wd'), input).toEqual(expected);
    for (const [input, expected] of PY_CASES) expect(await body(page, input, 'py'), input).toEqual(expected);
  });

  test('fixed sleeps are removed, flagged and counted, and never become waitForTimeout', async ({ page }) => {
    await page.goto(PAGE);
    for (const [src, lang] of [["it('a', () => {\n  cy.wait(1500);\n  cy.get('#x').should('be.visible');\n});", 'cy'], ["it('a', async () => {\n  await driver.sleep(2000);\n});", 'wd'], ['def test_a(driver):\n    time.sleep(2)\n', 'py']] as const) {
      const r = await convert(page, src, lang);
      const live = r.code.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(live, src).not.toMatch(/waitForTimeout|sleep\(|cy\.wait\(/);
      expect(r.report.sleeps, src).toBe(1);
      expect(r.rows.filter((x) => x.status === 'sleep')).toHaveLength(1);
      expect(r.code).toMatch(/\/\/ removed .*: the next web-first assertion waits for the real condition/);
    }
    // In the login example the removed wait is followed by the web-first URL assertion that replaces it.
    const code = (await page.evaluate(() => (window as any).__migrator.state.code)) as string;
    const lines = code.split('\n').map((l) => l.trim());
    const i = lines.findIndex((l) => l.startsWith('// removed cy.wait(1000)'));
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toBe('await expect(page).toHaveURL(/\\/dashboard/);');
  });

  test('unsupported constructs are commented out and flagged, never silently dropped', async ({ page }) => {
    await page.goto(PAGE);
    const cases: [string, 'cy' | 'wd' | 'py', string][] = [
      ["cy.login('ada', 'pw')", 'cy', 'custom command cy.login()'],
      ["cy.get('.x').then(($x) => {\n  doThing($x)\n})", 'cy', '.then()'],
      ["cy.get('.total').invoke('text').should('eq', '$4')", 'cy', '.invoke()'],
      ["cy.get('.x').should(($x) => {\n  expect($x).to.have.length(2)\n})", 'cy', '.should(callback)'],
      ["cy.wait('@neverRegistered')", 'cy', 'alias was not registered'],
      ['await driver.switchTo().frame(0)', 'wd', 'driver.switchTo()'],
      ['await driver.actions().move({ x: 5 }).perform()', 'wd', 'driver.actions()'],
      ['for el in driver.find_elements(By.CSS_SELECTOR, "li"):\n    el.click()', 'py', 'control flow'],
    ];
    for (const [snippet, lang, reason] of cases) {
      const lines = await body(page, snippet, lang);
      const migrate = lines.filter((l) => l.startsWith('// MIGRATE:'));
      expect(migrate, snippet).toHaveLength(1);
      expect(migrate[0], snippet).toContain(reason);
      // every original line survives, commented out
      for (const l of snippet.split('\n')) expect(lines, `${snippet} keeps "${l}"`).toContain('// ' + l.trim());
    }
    // the report counts each flagged statement once, and the file has one MIGRATE marker per flag
    const r = await convert(page, "it('a', () => {\n  cy.login('a', 'b');\n  cy.get('#x').click();\n  cy.get('#y').invoke('val');\n});", 'cy');
    expect(r.report.flagged).toBe(2);
    expect(r.report.converted).toBe(1);
    expect(r.code.match(/\/\/ MIGRATE:/g)).toHaveLength(2);
  });

  test('every bundled example converts to syntactically plausible code with one test( per input test', async ({ page }) => {
    await page.goto(PAGE);
    const examples = (await page.evaluate(() => (window as any).__migrator.examples)) as Record<string, { code: string; lang: string }>;
    expect(Object.keys(examples)).toHaveLength(4);
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    for (const [key, ex] of Object.entries(examples)) {
      const r = await convert(page, ex.code, ex.lang);
      const inputTests = (ex.code.match(/^\s*(it|specify)(\.only|\.skip)?\(\s*['"`]|^\s*def test_\w*\s*\(/gm) || []).length;
      const outputTests = (r.code.match(/^\s*test(\.only|\.skip)?\(\s*['"`]/gm) || []).length;
      expect(inputTests, key).toBeGreaterThan(0);
      expect(outputTests, key).toBe(inputTests);
      expect(balanced(r.code), `${key} brackets balance`).toBe(true);
      expect(r.code.startsWith("import { test, expect } from '@playwright/test';"), key).toBe(true);
      // it parses as JavaScript once the imports and the one type annotation are removed
      const js = r.code.replace(/^import .*$/gm, '').replace(/\(name: string\)/g, '(name)');
      expect(() => new AsyncFunction('test', 'expect', js), key).not.toThrow();
      // nothing from the old frameworks survives outside comments
      const live = r.code.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(live, key).not.toMatch(/\bcy\.|\bdriver\.|\bBy\.|\buntil\.|find_element|send_keys/);
    }
  });

  test('the report counts match an independent tally for each example, in the tiles and the summary', async ({ page }) => {
    // tests and sleeps are counted from the source by regex; flagged and dropped are what each example was written to contain
    const EXPECT: Record<string, { flagged: number; removed: number; name: string }> = {
      'cy-login': { flagged: 0, removed: 0, name: 'Cypress' },
      'cy-shop': { flagged: 3, removed: 0, name: 'Cypress' }, // cy.login custom command, .each loop body, .invoke().then()
      'wd-js': { flagged: 0, removed: 5, name: 'Selenium WebDriver (JavaScript)' }, // 2 requires, let driver, before(), after()
      'wd-py': { flagged: 1, removed: 8, name: 'Selenium WebDriver (Python)' }, // the for loop; 7 imports and the driver fixture
    };
    await page.goto(PAGE);
    for (const [key, want] of Object.entries(EXPECT)) {
      await page.getByTestId('example').selectOption(key);
      const src = await page.getByTestId('source').inputValue();
      const tests = (src.match(/^\s*it\(|^\s*def test_/gm) || []).length;
      const sleeps = (src.match(/cy\.wait\(\d+\)|driver\.sleep\(|time\.sleep\(/g) || []).length;
      await expect(page.getByTestId('n-tests')).toHaveText(String(tests));
      await expect(page.getByTestId('n-sleeps')).toHaveText(String(sleeps));
      await expect(page.getByTestId('n-flagged')).toHaveText(String(want.flagged));
      await expect(page.getByTestId('n-removed')).toHaveText(String(want.removed));
      const rep = (await page.evaluate(() => (window as any).__migrator.state)) as Result;
      await expect(page.getByTestId('n-converted')).toHaveText(String(rep.rows.filter((r) => r.status === 'converted').length));
      expect(rep.code.match(/\/\/ MIGRATE:/g)?.length ?? 0).toBe(want.flagged);
      await expect(page.getByTestId('summary')).toContainText(`from ${want.name}:`);
      await expect(page.getByTestId('summary')).toContainText(`${want.flagged} flagged for manual review`);
      await expect(page.getByTestId('detected')).toHaveText('from ' + want.name);
    }
  });

  test('selectors map to recommended locators, and each mapping is explained', async ({ page }) => {
    await page.goto(PAGE); // opens on the Cypress login example, which uses data-cy
    const rows = page.getByTestId('mapping');
    await expect(rows.filter({ hasText: '[data-cy=email]' })).toContainText("getByTestId('email')");
    await expect(rows.filter({ hasText: '[data-cy=email]' })).toContainText("set testIdAttribute: 'data-cy'");
    await expect(rows.filter({ hasText: "contains('h1'" })).toContainText("getByRole('heading', { name: 'Welcome back' })");
    await expect(rows.filter({ hasText: '[role=alert]' })).toContainText("getByRole('alert')");
    await expect(rows.filter({ hasText: 'button[type=submit]' })).toContainText('CSS kept');
    await expect(page.getByTestId('config-note')).toHaveText("playwright.config.ts needs: use: { baseURL: 'http://localhost:3000', testIdAttribute: 'data-cy' }");
    // the Selenium example: XPath is kept but called out as weak
    await page.getByTestId('example').selectOption('wd-js');
    await expect(rows.filter({ hasText: "By.xpath('//article/h1')" })).toContainText('brittle');
    await expect(rows.filter({ hasText: "By.linkText('Smoked Brisket')" })).toContainText("getByRole('link', { name: 'Smoked Brisket', exact: true })");
    await expect(page.getByTestId('config-note')).toBeHidden();
  });

  test('side-by-side rows carry a note, and the review filter shows only flagged rows and removed sleeps', async ({ page }) => {
    await page.goto(PAGE);
    await page.getByTestId('example').selectOption('cy-shop');
    const rows = page.getByTestId('row');
    const all = await rows.count();
    expect(all).toBeGreaterThan(15);
    for (const s of ['converted', 'flagged']) {
      const r = page.locator(`[data-testid=row][data-status=${s}]`);
      const n = await r.count();
      expect(n, s).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) await expect(r.nth(i).locator('.notes li').first()).not.toBeEmpty();
    }
    await page.getByTestId('only-review').check();
    await expect(page.locator('[data-testid=row]:visible')).toHaveCount(3);
    await expect(page.locator('[data-testid=row][data-status=converted]:visible')).toHaveCount(0);
    await page.getByTestId('only-review').uncheck();
    await expect(page.locator('[data-testid=row]:visible')).toHaveCount(all);
    // a pasted input converts on demand, with the language auto-detected
    await page.getByTestId('lang').selectOption('auto');
    await page.getByTestId('source').fill("it('t', () => {\n  cy.get('#a').click()\n})\n");
    await page.getByTestId('convert').click();
    await expect(page.getByTestId('output')).toContainText("await page.locator('#a').click();");
    await expect(page.getByTestId('detected')).toHaveText('from Cypress');
  });

  test('copy and download hand over exactly the converted file and a Markdown report', async ({ page, context, browserName }) => {
    await page.goto(PAGE);
    const code = (await page.evaluate(() => (window as any).__migrator.state.code)) as string;
    expect(((await page.getByTestId('output').textContent()) || '').trim()).toBe(code.trim());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    expect(dl.suggestedFilename()).toBe('migrated.spec.ts');
    expect(readFileSync((await dl.path())!, 'utf8')).toBe(code);
    const [rep] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-report').click()]);
    expect(rep.suggestedFilename()).toBe('migration-report.md');
    const md = readFileSync((await rep.path())!, 'utf8');
    expect(md).toContain('| Tests | 3 |');
    expect(md).toContain('| Fixed sleeps removed | 1 |');
    expect(md).toContain('| Flagged for manual review | 0 |');
    expect(md).toContain('- Line 9: `cy.wait(1000);`');
    expect(md).toContain("| `[data-cy=email]` | `getByTestId('email')` |");
    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByTestId('copy').click();
      await expect(page.getByTestId('copy-status')).toHaveText('Copied migrated.spec.ts to the clipboard.');
      // the OS clipboard may hand back Windows line endings
      expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(code);
    }
  });

  test('the converted login example actually runs and passes against a stub app, and catches a regression', async ({ page, browser }) => {
    await page.goto(PAGE);
    const code = (await page.evaluate(() => (window as any).__migrator.state.code)) as string;
    const good = await runConverted(browser, code, stubApp(true));
    expect(good.names).toEqual(['signs in with valid details', 'shows an error for a wrong password', 'keeps the button disabled until both fields are filled']);
    expect(good.failed).toEqual([]);
    const broken = await runConverted(browser, code, stubApp(false)); // the submit button is never disabled
    expect(broken.failed).toEqual(['keeps the button disabled until both fields are filled']);
  });

  test('the CTA links to the services section, and the controls are keyboard reachable', async ({ page, isMobile }) => {
    await page.goto(PAGE);
    const cta = page.getByTestId('cta-link');
    await expect(cta).toHaveAttribute('href', '../index.html#services');
    await expect(page.getByTestId('cta')).toContainText('Hourly ($65/hr)');
    await expect(page.getByTestId('cta')).toContainText('Playwright Starter Suite ($1,500)');
    test.skip(isMobile, 'keyboard traversal is checked on desktop');
    await page.getByTestId('example').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('lang')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('convert')).toBeFocused();
    await page.getByTestId('source').fill("it('t', () => {\n  cy.visit('/')\n})\n");
    await page.getByTestId('convert').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('output')).toContainText("await page.goto('/');");
  });
});

/** A tiny login app matching the Cypress login example. `disables` controls whether the button starts disabled. */
function stubApp(disables: boolean) {
  const login = `<!doctype html><html lang="en"><title>Sign in</title><form id="f">
    <label>Email <input data-cy="email" name="email"></label>
    <label>Password <input data-cy="password" name="password" type="password"></label>
    <button type="submit" ${disables ? 'disabled' : ''}>Sign in</button><p role="alert"></p></form>
    <script>
      const f = document.getElementById('f'), e = f.email, p = f.password, b = f.querySelector('button');
      const sync = () => { if (${disables}) b.disabled = !(e.value && p.value); };
      e.oninput = p.oninput = sync;
      f.onsubmit = (ev) => { ev.preventDefault(); if (p.value === 'correct horse') location.href = '/dashboard'; else { f.querySelector('[role=alert]').textContent = 'Email or password is incorrect.'; p.value = ''; } };
    </script></html>`;
  const dash = '<!doctype html><html lang="en"><title>Dashboard</title><h1>Welcome back</h1></html>';
  return (path: string) => (path.startsWith('/dashboard') ? dash : login);
}

/** Runs a converted spec for real: test()/describe()/beforeEach() are collected by stand-ins, and each test runs in a fresh context. */
async function runConverted(browser: Browser, code: string, app: (path: string) => string) {
  const collected: { name: string; fn: (a: { page: Page }) => Promise<void> }[] = [];
  const before: ((a: { page: Page }) => Promise<void>)[] = [];
  const t: any = (name: string, fn: any) => collected.push({ name, fn });
  t.describe = (_: string, fn: () => void) => fn();
  t.beforeEach = (fn: any) => before.push(fn);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction('test', 'expect', code.replace(/^import .*$/gm, ''))(t, expect.configure({ timeout: 2000 }));
  const failed: string[] = [];
  selectors.setTestIdAttribute('data-cy');
  try {
    for (const c of collected) {
      const ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
      const p = await ctx.newPage();
      await p.route('**/*', (route) => {
        const u = new URL(route.request().url());
        return u.host === 'localhost:3000' ? route.fulfill({ status: 200, contentType: 'text/html', body: app(u.pathname) }) : route.abort();
      });
      try { for (const b of before) await b({ page: p }); await c.fn({ page: p }); } catch { failed.push(c.name); }
      await ctx.close();
    }
  } finally {
    selectors.setTestIdAttribute('data-testid');
  }
  return { names: collected.map((c) => c.name), failed };
}
