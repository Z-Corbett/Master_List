import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/089-unicode-inspector.html';
const stat = (page: Page, k: string) => page.getByTestId('n-' + k);
// Independent encoders run in Node, not in the page.
const utf8Hex = (s: string) => [...Buffer.from(s, 'utf8')].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const utf16Hex = (s: string) => [...Array(s.length).keys()].map((i) => s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join(' ');

test.describe('Unicode Inspector', () => {
  test('a family emoji is one grapheme, seven code points, eleven UTF-16 units and 25 bytes', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('preset-0')).toHaveAttribute('aria-pressed', 'true');
    await expect(stat(page, 'graphemes')).toHaveText('1');
    await expect(stat(page, 'codepoints')).toHaveText('7');
    await expect(stat(page, 'utf16')).toHaveText('11');
    await expect(stat(page, 'utf8')).toHaveText('25');
    await expect(page.getByTestId('cp-row')).toHaveCount(7);
    await expect(page.getByTestId('cp-name')).toHaveText(['MAN', 'ZERO WIDTH JOINER', 'WOMAN', 'ZERO WIDTH JOINER', 'GIRL', 'ZERO WIDTH JOINER', 'BOY']);
    await expect(page.getByTestId('cp-utf8').first()).toHaveText('F0 9F 91 A8');
    await expect(page.getByTestId('cp-utf16').first()).toHaveText('D83D DC68');
    // the joiners are expected inside an emoji sequence, not flagged as hidden
    await expect(page.locator('[data-testid="flag"][data-kind="expected"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="flag"][data-kind="invisible"]')).toHaveCount(0);
  });

  test('encodings match Node for typed text, including astral characters', async ({ page }) => {
    await page.goto(URL);
    const text = 'a\u20AC\u{1D11E}\u00E9';
    await page.getByTestId('input').fill(text);
    await expect(stat(page, 'codepoints')).toHaveText(String([...text].length));
    await expect(stat(page, 'utf16')).toHaveText(String(text.length));
    await expect(stat(page, 'utf8')).toHaveText(String(Buffer.byteLength(text, 'utf8')));
    const clusters = page.getByTestId('cluster');
    await expect(clusters).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await clusters.nth(i).click();
      const ch = [...text][i];
      await expect(page.getByTestId('cp-utf8')).toHaveText(utf8Hex(ch));
      await expect(page.getByTestId('cp-utf16')).toHaveText(utf16Hex(ch));
    }
    await clusters.nth(2).click();
    await expect(page.getByTestId('cp-row')).toHaveAttribute('data-cp', 'U+1D11E');
    await expect(page.getByTestId('cp-name')).toHaveText('MUSICAL SYMBOL G CLEF');
    // keyboard: arrows walk the clusters
    await page.keyboard.press('ArrowLeft');
    await expect(clusters.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('cp-name')).toHaveText('EURO SIGN');
  });

  test('normalization: composed vs decomposed, and compatibility forms', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('input').fill('e\u0301');
    await expect(stat(page, 'graphemes')).toHaveText('1');
    await expect(stat(page, 'codepoints')).toHaveText('2');
    await expect(page.getByTestId('norm-NFC')).toHaveAttribute('data-cps', '1');
    await expect(page.getByTestId('norm-NFC')).toHaveAttribute('data-same', 'false');
    await expect(page.getByTestId('norm-NFC-seq')).toHaveText('00E9');
    await expect(page.getByTestId('norm-NFD')).toHaveAttribute('data-same', 'true');
    await page.getByTestId('input').fill('\uFB01 \u212B');
    await expect(page.getByTestId('norm-NFC-seq')).toHaveText('FB01 0020 00C5'); // the Angstrom sign is a singleton decomposition
    await expect(page.getByTestId('norm-NFKC-seq')).toHaveText('0066 0069 0020 00C5');
    await expect(page.getByTestId('norm-NFKD-seq')).toHaveText('0066 0069 0020 0041 030A');
    await page.getByTestId('input').fill('plain ascii');
    for (const f of ['NFC', 'NFD', 'NFKC', 'NFKD']) await expect(page.getByTestId('norm-' + f)).toHaveAttribute('data-same', 'true');
  });

  test('invisible characters and Trojan Source bidi controls are called out', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-6').click();
    const invisible = await page.locator('[data-testid="flag"][data-kind="invisible"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cp')));
    expect(invisible).toEqual(['U+200B', 'U+00AD', 'U+00A0', 'U+FEFF']);
    await expect(page.getByTestId('trojan')).toBeHidden();
    await page.getByTestId('preset-7').click();
    await expect(page.getByTestId('trojan')).toBeVisible();
    await expect(page.getByTestId('trojan')).toContainText('Trojan Source');
    const bidi = await page.locator('[data-testid="flag"][data-kind="bidi"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cp')));
    expect(bidi).toEqual(['U+202E', 'U+2066', 'U+2069', 'U+2067']);
    await expect(page.getByTestId('reveal')).toContainText('RLO');
    await page.getByTestId('input').fill('nothing hidden');
    await expect(page.getByTestId('no-flags')).toBeVisible();
  });

  test('look-alike letters are marked, mixed-script words flagged and a skeleton shown', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('input').fill('\u0430dmin and admin');
    await expect(page.getByTestId('conf-mark')).toHaveCount(1);
    await expect(page.getByTestId('conf')).toHaveAttribute('data-cp', 'U+0430');
    await expect(page.getByTestId('mixed')).toHaveCount(1);
    await expect(page.getByTestId('mixed')).toContainText('Cyrillic + Latin');
    await expect(page.getByTestId('skeleton-text')).toHaveText('admin and admin');
    await page.getByTestId('preset-8').click();
    await expect(page.getByTestId('mixed')).toHaveCount(3);
    await expect(page.getByTestId('skeleton-text')).toContainText('admin');
    await expect(page.getByTestId('skeleton-text')).toContainText('Hello world');
  });
});
