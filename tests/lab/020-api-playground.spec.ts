import { test, expect, type Page } from '@playwright/test';

const BASE = 'https://api.marginalia.test/v1';

async function call(page: Page, method: string, path: string, opts: { auth?: boolean; body?: string } = {}) {
  await page.getByTestId('method').selectOption(method);
  await page.getByTestId('url').fill(BASE + path);
  await page.getByTestId('tab-headers').click();
  const auth = page.getByTestId('hdr-on-2');
  if (opts.auth) await auth.check(); else await auth.uncheck();
  if (opts.body !== undefined) {
    await page.getByTestId('tab-body').click();
    await page.getByTestId('body').fill(opts.body);
  }
  await page.getByTestId('send').click();
  await expect(page.getByTestId('send')).toBeEnabled();
  return page.getByTestId('status');
}
const body = async (page: Page) => JSON.parse((await page.getByTestId('response-body').textContent())!);

test.describe('Mock API Playground', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lab/020-api-playground.html?seed=7');
  });

  test('pagination: page 2 of 23 books with total header and Link', async ({ page }) => {
    const status = await call(page, 'GET', '/books?page=2&limit=5');
    await expect(status).toHaveText('200 OK');
    const b = await body(page);
    expect(b.page).toBe(2);
    expect(b.data).toHaveLength(5);
    expect(b.data[0].id).toBe(6);
    expect(b.totalPages).toBe(5);
    await page.getByTestId('tab-rheaders').click();
    await expect(page.getByTestId('rh-x-total-count')).toHaveText('23');
    await expect(page.getByTestId('rh-link')).toContainText('page=3&limit=5>; rel="next"');
    await expect(page.getByTestId('rh-link')).toContainText('page=1&limit=5>; rel="prev"');
  });

  test('auth and validation: 401, 422, then 201 and the new book is retrievable', async ({ page }) => {
    const valid = JSON.stringify({ title: 'Test Plan for a Lighthouse', author: 'Zac', year: 2026, price: 9.99 });
    let status = await call(page, 'POST', '/books', { body: valid });
    await expect(status).toHaveText('401 Unauthorized');
    expect((await body(page)).error.code).toBe('unauthorized');

    status = await call(page, 'POST', '/books', { auth: true, body: '{"title":"","year":"soon","price":-1}' });
    await expect(status).toHaveText('422 Unprocessable Content');
    const errs = (await body(page)).errors.map((e: { field: string }) => e.field);
    expect(errs).toEqual(['title', 'author', 'year', 'price']);

    status = await call(page, 'POST', '/books', { auth: true, body: '{ not json' });
    await expect(status).toHaveText('400 Bad Request');

    status = await call(page, 'POST', '/books', { auth: true, body: valid });
    await expect(status).toHaveText('201 Created');
    const created = await body(page);
    expect(created.id).toBe(24);
    await page.getByTestId('tab-rheaders').click();
    await expect(page.getByTestId('rh-location')).toHaveText('/v1/books/24');

    status = await call(page, 'GET', '/books/24');
    await expect(status).toHaveText('200 OK');
    expect((await body(page)).title).toBe('Test Plan for a Lighthouse');
  });

  test('delete then 404; wrong method 405; foreign host blocked', async ({ page }) => {
    let status = await call(page, 'DELETE', '/books/5', { auth: true });
    await expect(status).toHaveText('204 No Content');
    status = await call(page, 'GET', '/books/5');
    await expect(status).toHaveText('404 Not Found');
    status = await call(page, 'PATCH', '/books/1', { auth: true, body: '{}' });
    await expect(status).toHaveText('405 Method Not Allowed');
    await page.getByTestId('tab-rheaders').click();
    await expect(page.getByTestId('rh-allow')).toHaveText('GET, PUT, DELETE');
    await page.getByTestId('url').fill('https://example.com/books');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('status')).toHaveText('0 Blocked');
  });

  test('assertions pass and fail against the response', async ({ page }) => {
    await page.getByTestId('send').click();
    await expect(page.getByTestId('status')).toHaveText('200 OK');
    await expect(page.getByTestId('test-count')).toHaveText('4/4');
    // edit: expect a title that isn't there, and a header that doesn't exist
    await page.getByTestId('tab-asserts').click();
    await page.getByTestId('asr-a-1').fill('$.data[0].title');
    await page.getByTestId('asr-b-1').fill('Not This Book');
    await page.getByTestId('asr-a-2').fill('X-Nope');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('test-count')).toHaveText('2/4');
    await expect(page.getByTestId('asr-res-1')).toHaveAttribute('aria-label', 'failed');
    await page.getByTestId('tab-tests').click();
    await expect(page.getByTestId('tres-1')).toContainText('$.data[0].title is "The Quiet Archive", expected Not This Book');
    await expect(page.getByTestId('tres-2')).toContainText('header X-Nope missing');
  });

  test('rate limit: the 11th request in 10 s is a 429 with Retry-After', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-01T10:00:00Z') });
    await page.reload();
    await page.clock.pauseAt(new Date('2026-09-01T10:00:01Z'));
    for (let i = 0; i < 10; i++) {
      await page.getByTestId('send').click();
      await page.clock.runFor(300);
      await expect(page.getByTestId('status')).toHaveText('200 OK');
    }
    await page.getByTestId('send').click();
    await page.clock.runFor(300);
    await expect(page.getByTestId('status')).toHaveText('429 Too Many Requests');
    await page.getByTestId('tab-rheaders').click();
    await expect(page.getByTestId('rh-retry-after')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('rh-x-ratelimit-remaining')).toHaveText('0');
    await page.clock.fastForward(10_000);
    await page.getByTestId('send').click();
    await page.clock.runFor(300);
    await expect(page.getByTestId('status')).toHaveText('200 OK');
  });

  test('saved requests persist across reloads', async ({ page }) => {
    await page.getByTestId('ex-2').click(); // Get a missing book
    await expect(page.getByTestId('url')).toHaveValue(`${BASE}/books/999`);
    await page.getByTestId('save-name').fill('Missing book check');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('saved-0')).toContainText('Missing book check');
    await page.reload();
    await expect(page.getByTestId('saved-0')).toContainText('Missing book check');
    await page.getByTestId('ex-0').click();
    await page.getByTestId('saved-0').click();
    await expect(page.getByTestId('url')).toHaveValue(`${BASE}/books/999`);
    await page.getByTestId('saved-rm-0').click();
    await expect(page.getByTestId('saved')).toContainText('Nothing saved yet');
  });
});
