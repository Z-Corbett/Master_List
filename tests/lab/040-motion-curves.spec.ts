import { test, expect, type Page } from '@playwright/test';

const bezierAt = (page: Page, bz: number[], x: number) => page.evaluate(([b, x]) => (window as any).__motion.bezierAt(...(b as number[]), x), [bz, x] as const);
const translateX = (page: Page, id: string) => page.getByTestId(id).evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);

async function plotPoint(page: Page, x: number, y: number) {
  const r = (await page.getByTestId('plot').boundingBox())!;
  return { x: r.x + (30 + x * 240) / 300 * r.width, y: r.y + (20 + (1.35 - y) * 240) / 390 * r.height };
}

test.describe('Motion Curves', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  test('presets set the bézier, export valid CSS and read correctly at 50%', async ({ page }) => {
    await page.goto('/lab/040-motion-curves.html');
    await page.getByTestId('preset-ease-in-out').click();
    await expect(page.getByTestId('preset-ease-in-out')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('x1')).toHaveValue('0.42');
    await expect(page.getByTestId('x2')).toHaveValue('0.58');
    await expect(page.getByTestId('mid-value')).toHaveText('0.500'); // symmetric curve
    const css = page.getByTestId('css');
    await expect(css).toContainText('--ease-custom: cubic-bezier(0.42, 0, 0.58, 1);');
    await expect(css).toContainText('--motion-duration: 250ms;');
    await expect(page.getByTestId('css-valid')).toContainText('parses');

    // ease-out is fast then slow: well past halfway at 50% time
    await page.getByTestId('preset-ease-out').click();
    const mid = Number(await page.getByTestId('mid-value').textContent());
    expect(mid).toBeCloseTo(await bezierAt(page, [0, 0, 0.58, 1], 0.5), 3);
    expect(mid).toBeGreaterThan(0.65);

    await page.getByTestId('duration').fill('600');
    await expect(page.getByTestId('guidance')).toContainText('Over 500 ms');
    await page.getByTestId('duration').fill('150');
    await expect(page.getByTestId('guidance')).toContainText('100–200 ms');
  });

  test('dragging and nudging handles reshapes the curve, including overshoot', async ({ page }) => {
    await page.goto('/lab/040-motion-curves.html');
    await page.getByTestId('preset-ease-in-out').click();
    await expect(page.getByTestId('overshoot')).toHaveText('0.0%');
    await page.getByTestId('plot').scrollIntoViewIfNeeded();
    const from = await plotPoint(page, 0.58, 1);
    const to = await plotPoint(page, 0.6, 1.3);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    expect(Number(await page.getByTestId('y2').inputValue())).toBeCloseTo(1.3, 1);
    expect(Number(await page.getByTestId('x2').inputValue())).toBeCloseTo(0.6, 1);
    // overshoot readout = peak of the curve above 1, recomputed here from the handle values
    const bz = await Promise.all(['x1', 'y1', 'x2', 'y2'].map(async (id) => Number(await page.getByTestId(id).inputValue())));
    const peak = await page.evaluate((b) => { let m = 0; for (let i = 0; i <= 1000; i++) m = Math.max(m, (window as any).__motion.bezierAt(...b, i / 1000)); return m; }, bz);
    const shownOver = parseFloat((await page.getByTestId('overshoot').textContent())!);
    expect(shownOver).toBeGreaterThan(2);
    expect(Math.abs(shownOver - (peak - 1) * 100)).toBeLessThan(0.2);
    await expect(page.getByTestId('curve-label')).toContainText('custom');

    // keyboard: Shift+ArrowDown moves handle 1 below zero → anticipation
    await page.getByTestId('handle-1').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown');
    await expect(page.getByTestId('y1')).toHaveValue('-0.2');
    await expect(page.getByTestId('undershoot-note')).toBeVisible();
    await expect(page.getByTestId('handle-1')).toBeFocused();
  });

  test('spring overshoot matches the analytic damped-oscillator value', async ({ page }) => {
    await page.goto('/lab/040-motion-curves.html');
    await page.getByTestId('tab-spring').click();
    await expect(page.getByTestId('tab-spring')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('zeta')).toHaveText('0.997'); // 26 / (2·√170)
    await expect(page.getByTestId('overshoot')).toHaveText('0.0%');

    await page.getByTestId('damping').fill('8');
    const k = 170, c = 8, m = 1;
    const zeta = c / (2 * Math.sqrt(k * m));
    await expect(page.getByTestId('zeta')).toHaveText(zeta.toFixed(3));
    await expect(page.getByTestId('regime')).toContainText('underdamped');
    const analytic = Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta)) * 100;
    const shown = parseFloat((await page.getByTestId('overshoot').textContent())!);
    expect(Math.abs(shown - analytic)).toBeLessThan(0.5);

    // the exported linear() easing parses and runs for the simulated settle time
    const css = (await page.getByTestId('css').textContent())!;
    const easing = css.match(/--ease-spring: (linear\([^)]*\));/)![1];
    expect(easing.startsWith('linear(0,')).toBe(true);
    expect(easing.endsWith(', 1)')).toBe(true);
    expect(await page.evaluate((e) => CSS.supports('transition-timing-function', e), easing)).toBe(true);
    const settle = (await page.getByTestId('settle').textContent())!;
    expect(css).toContain(`--motion-duration: ${parseInt(settle)}ms;`);
    // with more damping the spring gets heavier than critical and stops bouncing
    await page.getByTestId('damping').fill('60');
    await expect(page.getByTestId('regime')).toContainText('overdamped');
    await expect(page.getByTestId('overshoot')).toHaveText('0.0%');
  });

  test('scrubbing the preview samples the curve on real elements', async ({ page }) => {
    await page.goto('/lab/040-motion-curves.html');
    await page.getByTestId('preset-ease-in').click();
    await page.getByTestId('scrub').fill('50');
    await expect(page.getByTestId('scrub-out')).toHaveText('50%');
    const dist = await page.getByTestId('obj-slide').evaluate((el) => el.parentElement!.clientWidth - 24 - 44);
    const expected = dist * (await bezierAt(page, [0.42, 0, 1, 1], 0.5));
    expect(Math.abs((await translateX(page, 'obj-slide')) - expected)).toBeLessThan(1);
    const opacity = Number(await page.getByTestId('obj-fade').evaluate((el) => getComputedStyle(el).opacity));
    expect(opacity).toBeCloseTo(await bezierAt(page, [0.42, 0, 1, 1], 0.5), 2);

    await page.getByTestId('scrub').fill('100');
    expect(Math.abs((await translateX(page, 'obj-slide')) - dist)).toBeLessThan(1);
  });

  test('pin curves to compare them on one timeline', async ({ page }) => {
    await page.goto('/lab/040-motion-curves.html');
    await page.getByTestId('preset-back-out').click();
    await page.getByTestId('pin').click();
    await page.getByTestId('tab-spring').click();
    await page.getByTestId('damping').fill('10');
    await page.getByTestId('pin').click();
    await expect(page.getByTestId('pin-item')).toHaveCount(2);
    await expect(page.getByTestId('pin-item').first()).toContainText('back-out · 250 ms');
    await expect(page.getByTestId('pin-item').nth(1)).toContainText('spring k170 c10 m1.0');
    await expect(page.getByTestId('cmp-line-1')).toBeAttached();
    await expect(page.getByTestId('lane-dot-1')).toBeVisible();
    await page.getByTestId('race').click();
    await page.getByRole('button', { name: 'Remove back-out' }).click();
    await expect(page.getByTestId('pin-item')).toHaveCount(1);
  });

  test('reduced motion: the system setting switches previews to a fade and the CSS carries a fallback', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab/040-motion-curves.html');
    await expect(page.getByTestId('rm-note')).toBeVisible();
    await expect(page.getByTestId('reduced')).toBeChecked();
    await expect(page.getByTestId('preview-mode')).toContainText('no movement');
    await page.getByTestId('scrub').fill('50');
    expect(await translateX(page, 'obj-slide')).toBe(0);
    const op = Number(await page.getByTestId('obj-slide').evaluate((el) => getComputedStyle(el).opacity));
    expect(op).toBeCloseTo(0.5, 1);
    const css = page.getByTestId('css');
    await expect(css).toContainText('@media (prefers-reduced-motion: reduce)');
    await expect(css).toContainText('transition: opacity 200ms linear;');

    await page.getByTestId('reduced').uncheck();
    await expect(page.getByTestId('preview-mode')).toHaveText('full motion');
    expect(await translateX(page, 'obj-slide')).toBeGreaterThan(0);
  });
});
