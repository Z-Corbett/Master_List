import { test, expect, type Page } from '@playwright/test';

type Cur = { cat: string; best: string; id: string } | null;
const current = (page: Page) => page.evaluate(() => (window as any).__gauntlet.current() as Cur);
const CATS = ['safe', 'injection', 'exfiltration', 'jailbreak'];

async function answer(page: Page, right: boolean) {
  const c = (await current(page))!;
  const cat = right ? c.cat : CATS.find((x) => x !== c.cat)!;
  await page.getByTestId(`cat-${cat}`).click();
  if (right) await page.getByTestId(`mit-${c.best}`).click();
  else await page.locator('[data-mit]:not([data-mit="' + c.best + '"])').first().click();
  await page.getByTestId('next').click();
  return c;
}

test.describe('Guardrail Gauntlet', () => {
  test('a perfect run scores every point and earns the top rank; best score persists', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/lab/038-guardrail-gauntlet.html?seed=5');
    for (let r = 0; r < 3; r++) {
      await expect(page.getByTestId('round-intro')).toContainText(`Round ${r + 1} of 3`);
      await page.getByTestId('start-round').click();
      for (let i = 0; i < 4; i++) await answer(page, true);
    }
    // 12 × (100 + 50) + streak bonus 20 × (0 + 1 + … + 11) = 1800 + 1320
    await expect(page.getByTestId('final-score')).toHaveText('3120');
    await expect(page.getByTestId('rank')).toHaveText('Gatekeeper');
    await expect(page.getByTestId('best-streak')).toHaveText('12');
    await expect(page.getByTestId('acc-safe')).toContainText('4 / 4');
    await expect(page.getByTestId('acc-jailbreak')).toContainText('2 / 2');
    await expect(page.getByTestId('best')).toHaveText('3120');

    await page.reload();
    await expect(page.getByTestId('best')).toHaveText('3120');
  });

  test('feedback explains the right answer, highlights red flags and breaks the streak', async ({ page }) => {
    await page.goto('/lab/038-guardrail-gauntlet.html?seed=5');
    await page.getByTestId('start-round').click();
    let c = (await current(page))!;
    await page.getByTestId(`cat-${c.cat}`).click();
    await page.getByTestId(`mit-${c.best}`).click();
    await expect(page.getByTestId('points')).toHaveText('+150 points');
    await expect(page.getByTestId('streak')).toHaveText('1');
    await page.getByTestId('next').click();

    c = (await current(page))!;
    await page.getByTestId(`cat-${c.cat}`).click();
    await page.getByTestId(`mit-${c.best}`).click();
    await expect(page.getByTestId('points')).toHaveText('+170 points (incl. streak bonus +20)');
    await expect(page.getByTestId('streak')).toHaveText('2');
    await page.getByTestId('next').click();

    // find a non-safe message so there are flags to highlight, answering the safe ones correctly on the way
    c = (await current(page))!;
    while (c.cat === 'safe') { await answer(page, true); c = (await current(page))!; }
    const wrong = c.cat === 'jailbreak' ? 'safe' : 'jailbreak';
    await page.getByTestId(`cat-${wrong}`).click();
    await expect(page.getByTestId('cls-feedback')).toContainText('Not quite');
    await expect(page.getByTestId(`cat-${c.cat}`)).toHaveClass(/right/);
    await expect(page.getByTestId(`cat-${wrong}`)).toHaveClass(/wrong/);
    await expect(page.getByTestId('stamp')).toBeVisible();
    expect(await page.getByTestId('message-text').locator('mark').count()).toBeGreaterThan(0);
    await expect(page.getByTestId('cat-safe')).toBeDisabled();
    await page.getByTestId(`mit-${c.best}`).click();
    await expect(page.getByTestId('points')).toHaveText('+50 points');
    await expect(page.getByTestId('streak')).toHaveText('0');
  });

  test('keys 1–4 classify and pick a defence', async ({ page }) => {
    await page.goto('/lab/038-guardrail-gauntlet.html?seed=9');
    await page.getByTestId('start-round').click();
    const c = (await current(page))!;
    await page.keyboard.press(String(CATS.indexOf(c.cat) + 1));
    await expect(page.getByTestId('cls-feedback')).toContainText('Correct');
    const opts = await page.locator('[data-mit]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.mit));
    await page.keyboard.press(String(opts.indexOf(c.best) + 1));
    await expect(page.getByTestId('mit-feedback')).toContainText('Good defence');
    await expect(page.getByTestId('next')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('cls-feedback')).toHaveCount(0);
    await expect(page.getByTestId('cat-safe')).toBeFocused();
  });

  test('the seed fixes the order; a different seed reshuffles it', async ({ page }) => {
    const firstIds = async (seed: number) => {
      await page.goto(`/lab/038-guardrail-gauntlet.html?seed=${seed}`);
      await page.getByTestId('start-round').click();
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) ids.push((await answer(page, true)).id);
      return ids;
    };
    const a = await firstIds(5);
    const b = await firstIds(5);
    expect(b).toEqual(a);
    let differs = false;
    for (const s of [6, 7, 8]) if ((await firstIds(s)).join() !== a.join()) { differs = true; break; }
    expect(differs).toBe(true);
  });

  test('all attack examples are harmless: only reserved .example domains, fictional brand', async ({ page }) => {
    await page.goto('/lab/038-guardrail-gauntlet.html');
    const texts: string[] = await page.evaluate(() => (window as any).__gauntlet.all());
    expect(texts).toHaveLength(12);
    for (const t of texts) {
      const domains = t.match(/\b[a-z0-9-]+\.(?:[a-z]{2,})(?=[/?\s]|$)/gi) || [];
      for (const d of domains) expect(d.endsWith('.example'), `unexpected domain ${d}`).toBe(true);
      expect(t).not.toMatch(/https?:\/\//);
    }
  });
});
