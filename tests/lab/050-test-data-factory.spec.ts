import { test, expect, type Page } from '@playwright/test';

// Independent Luhn oracle and the documented sandbox numbers the page is allowed to emit.
function luhn(s: string) {
  let sum = 0, alt = false;
  for (let i = s.length - 1; i >= 0; i--) { let d = Number(s[i]); if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; }
  return sum % 10 === 0;
}
const TEST_CARDS = new Set(['4242424242424242', '4000056655665556', '5555555555554444', '2223003122003222', '5200828282828210',
  '378282246310005', '371449635398431', '6011111111111117', '3056930009020004', '3566002020360505', '6200000000000005']);

const exported = async (page: Page) => JSON.parse((await page.getByTestId('export').textContent())!);
// the export pane truncates very long output, so bulk checks read the same generator the export uses
const data = (page: Page) => page.evaluate(() => (window as any).__tdf.generate({}).data);

test.describe('Test Data Factory', () => {
  test('same seed gives the same data; a different seed changes it; ?seed= is honoured', async ({ page }) => {
    await page.goto('/lab/050-test-data-factory.html?seed=777');
    await expect(page.getByTestId('seed')).toHaveValue('777');
    const a = await exported(page);
    expect(a).toHaveLength(25);

    await page.getByTestId('seed').fill('778');
    const b = await exported(page);
    expect(b).not.toEqual(a);

    await page.getByTestId('seed').fill('777');
    expect(await exported(page)).toEqual(a);

    // a fresh page with the same seed reproduces the crate byte for byte
    await page.goto('/lab/050-test-data-factory.html?seed=777');
    expect(await exported(page)).toEqual(a);
  });

  test('emails use only reserved example domains and phones stay in 555-0100..0199', async ({ page }) => {
    await page.goto('/lab/050-test-data-factory.html?seed=31');
    await page.getByTestId('rows').fill('300');
    await expect(page.getByTestId('preview-meta')).toContainText('of 300 rows');
    const rows = await data(page);
    expect(rows).toHaveLength(300);
    for (const r of rows) {
      expect(r.email).toMatch(/^[a-z0-9.+']+@example\.(com|org|net)$/);
      expect(r.phone).toMatch(/^\+1 \(\d{3}\) 555-01\d\d$/);
      expect(r.signed_up).toMatch(/^202[0-6]-\d\d-\d\d$/);
      expect(Number.isNaN(Date.parse(r.signed_up))).toBe(false);
    }
    // name and email come from the same fictional person
    for (const r of rows.slice(0, 20)) {
      const local = r.email.split('@')[0], f = r.first_name.toLowerCase(), l = r.last_name.toLowerCase();
      expect(local === `${f}.${l}` || local.startsWith(f[0] + l) || local.startsWith(`${f}+test`)).toBe(true);
    }
  });

  test('payment preset emits only documented test card numbers, all Luhn-valid', async ({ page }) => {
    await page.goto('/lab/050-test-data-factory.html?seed=5');
    await page.getByTestId('preset-payments').click();
    await expect(page.getByTestId('field')).toHaveCount(9);
    await page.getByTestId('rows').fill('120');
    await expect(page.getByTestId('preview-meta')).toContainText('of 120 rows');
    const rows = await data(page);
    expect(rows).toHaveLength(120);
    const seen = new Set<string>();
    for (const r of rows) {
      expect(TEST_CARDS.has(r.card_number)).toBe(true);
      expect(luhn(r.card_number)).toBe(true);
      seen.add(r.card_number);
      expect(r.cvc).toHaveLength(r.brand === 'American Express' ? 4 : 3);
      expect(r.expiry).toMatch(/^(0[1-9]|1[0-2])\/(29|3[0-3])$/);
      expect(r.payment_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(typeof r.captured).toBe('boolean');
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  test('edge-case pack covers every kind, is rendered safely and survives CSV quoting', async ({ page }) => {
    await page.goto('/lab/050-test-data-factory.html?seed=99');
    await page.getByTestId('preset-signup').click();
    await page.getByTestId('edge-toggle').click();
    await expect(page.getByTestId('edge-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('edge-rate').fill('60');
    await page.getByTestId('rows').fill('40');
    await expect(page.getByTestId('edge-kinds')).toHaveAttribute('data-hit', 'unicode rtl emoji long whitespace quotes zerowidth markup empty leapday');
    await expect(page.getByTestId('edge-rate-out')).toContainText('10/10 kinds present');

    const rows = await data(page);
    const all = rows.flatMap((r: Record<string, unknown>) => Object.values(r)).filter((v: unknown) => typeof v === 'string') as string[];
    expect(all).toContain("O'Brien");
    expect(all.some((v) => /​|‌|‍|﻿/.test(v))).toBe(true);
    expect(all.some((v) => v.length === 255)).toBe(true);
    expect(all.some((v) => /^\s|\s$/.test(v) && v.trim().length > 0)).toBe(true);
    expect(rows.some((r: { birth_date: string }) => /-02-29$/.test(r.birth_date))).toBe(true);

    // markup is shown as text, never parsed into the preview
    await expect(page.getByTestId('preview').locator('img')).toHaveCount(0);
    await expect(page.getByTestId('preview').locator('td[data-edge="zerowidth"]').first()).toContainText('⟨ZW⟩');

    // CSV: embedded quotes doubled, whitespace-edged values quoted, header first, CRLF line endings
    await page.getByTestId('fmt-csv').click();
    await expect(page.getByTestId('fmt-csv')).toHaveAttribute('aria-pressed', 'true');
    const csv = await page.evaluate(() => { const t = (window as any).__tdf; return t.toCSV(t.state.fields, t.generate({}).data); });
    expect(csv.startsWith('username,display_name,email,birth_date,company,bio,newsletter\r\n')).toBe(true);
    const q = await page.evaluate(() => (window as any).__tdf.toCSV([{ name: 'n' }], [{ n: 'Pat "Sparky" O\'Neil' }, { n: '  Ana Lima' }, { n: "D'Angelo, Jr." }]));
    expect(q).toBe('n\r\n"Pat ""Sparky"" O\'Neil"\r\n"  Ana Lima"\r\n"D\'Angelo, Jr."\r\n');
  });

  test('schema builder: add, rename, retype, reorder, remove, persist and download', async ({ page }) => {
    await page.goto('/lab/050-test-data-factory.html?seed=12');
    await page.getByTestId('preset-customers').click();
    const firstBefore = (await exported(page))[0];
    await page.getByTestId('add-field').click();
    await expect(page.getByTestId('field')).toHaveCount(11);
    await expect(page.getByTestId('field-name-10')).toBeFocused();
    await page.getByTestId('field-name-10').fill('employer');
    await page.getByTestId('field-type-10').selectOption('company');
    let first = (await exported(page))[0];
    expect(first.employer).toMatch(/^\w+ \w+ (LLC|Inc\.|Co\.|Ltd\.|Group)$/);
    // adding a column does not reshuffle the others
    const { employer, ...rest } = first;
    expect(rest).toEqual(firstBefore);

    await page.getByTestId('field-del-0').click();
    await expect(page.getByTestId('field')).toHaveCount(10);
    await page.getByRole('button', { name: 'Move employer up' }).click();
    first = (await exported(page))[0];
    expect(Object.keys(first).slice(-2)).toEqual(['employer', 'signed_up']);

    await page.reload();
    await expect(page.getByTestId('field')).toHaveCount(10);
    await expect(page.getByTestId('field-name-8')).toHaveValue('employer');

    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    expect(dl.suggestedFilename()).toBe('test-data-seed12-25rows.json');
    await expect(page.getByTestId('status')).toContainText('Downloaded');
  });
});
