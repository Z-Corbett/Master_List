import { test, expect, type Page } from '@playwright/test';

type T = { from: string; event: string; to: string };
type M = { states: { id: string; x: number; y: number; initial?: boolean }[]; transitions: T[] };
const machine = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__fsm.machine))) as Promise<M>;

// Oracle: replay each generated case against the machine definition from the initial state.
function replay(m: M, cases: string[][]) {
  const init = (m.states.find((s) => s.initial) || m.states[0]).id;
  const used = new Set<string>(), visited = new Set<string>([init]);
  for (const evs of cases) {
    let at = init;
    for (const e of evs) {
      const t = m.transitions.find((x) => x.from === at && x.event === e);
      if (!t) throw new Error(`event ${e} not enabled in ${at}`);
      used.add(`${t.from}|${t.event}|${t.to}`); at = t.to; visited.add(at);
    }
  }
  return { used, visited };
}
const casesOf = async (page: Page) => (await page.getByTestId('case').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.events || ''))).map((s) => (s ? s.split(' ') : []));

test.describe('State Machine Studio', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab/051-state-machine-studio.html');
  });

  test('flags unreachable states and dead ends, and clears them when the machine is fixed', async ({ page }) => {
    await expect(page.getByTestId('unreachable')).toHaveAttribute('data-ids', 'PromoApplied');
    await expect(page.getByTestId('deadends')).toHaveAttribute('data-ids', 'FraudHold');
    await expect(page.getByTestId('node-PromoApplied')).toHaveAttribute('aria-label', /unreachable/);
    await expect(page.getByTestId('node-FraudHold')).toContainText('DEAD END');
    await expect(page.getByTestId('reachable')).toHaveText('9/10 states');

    // wire the promo state in: Cart --applyPromo--> PromoApplied
    await page.getByTestId('t-from').selectOption('Cart');
    await page.getByTestId('t-event').fill('applyPromo');
    await page.getByTestId('t-to').selectOption('PromoApplied');
    await page.getByTestId('t-add').click();
    await expect(page.getByTestId('unreachable')).toHaveAttribute('data-ids', '');
    await expect(page.getByTestId('edge-Cart-PromoApplied')).toHaveAttribute('data-events', 'applyPromo');

    // FraudHold becomes an accepted final state
    await page.getByTestId('node-FraudHold').click();
    await expect(page.getByTestId('state-name')).toHaveValue('FraudHold');
    await page.getByTestId('state-final').check();
    await expect(page.getByTestId('deadends')).toHaveAttribute('data-ids', '');
    await expect(page.getByTestId('reachable')).toHaveText('10/10 states');
  });

  test('simulation fires enabled events, rejects unhandled ones and resets', async ({ page }) => {
    await expect(page.getByTestId('current-state')).toHaveText('Cart');
    await page.getByTestId('fire-checkout').click();
    await expect(page.getByTestId('current-state')).toHaveText('Shipping');
    await expect(page.getByTestId('node-Shipping')).toHaveClass(/\bcur\b/);
    await expect(page.getByTestId('edge-Cart-Shipping')).toHaveClass(/\bhot\b/);
    await page.getByTestId('fire-submitAddress').click();
    await page.getByTestId('fire-submitCard').click();
    await expect(page.getByTestId('current-state')).toHaveText('Review');

    await expect(page.getByTestId('fire-approved')).toHaveAttribute('aria-disabled', 'true');
    // aria-disabled (not disabled) so negative paths can still be fired on purpose
    await page.getByTestId('fire-approved').click({ force: true });
    await expect(page.getByTestId('current-state')).toHaveText('Review');
    await expect(page.getByTestId('log').locator('li')).toHaveText(['Cart --checkout--> Shipping', 'Shipping --submitAddress--> Payment', 'Payment --submitCard--> Review', 'approved ignored in Review']);

    await page.getByTestId('reset').click();
    await expect(page.getByTestId('current-state')).toHaveText('Cart');
    await expect(page.getByTestId('log').locator('li')).toHaveCount(0);
  });

  test('all-transitions tests replay cleanly and cover every reachable transition', async ({ page }) => {
    const m = await machine(page);
    await expect(page.getByTestId('gen-stat')).toHaveAttribute('data-covered', '13');
    await expect(page.getByTestId('gen-stat')).toHaveAttribute('data-total', '14');
    const cases = await casesOf(page);
    const { used } = replay(m, cases);
    const reachable = m.transitions.filter((t) => t.from !== 'PromoApplied').map((t) => `${t.from}|${t.event}|${t.to}`);
    expect([...used].sort()).toEqual([...reachable].sort());
    expect(used.has('PromoApplied|continue|Cart')).toBe(false);

    const outline = (await page.getByTestId('outline').textContent())!;
    expect(outline).toContain("import { test, expect, type Page } from '@playwright/test';");
    expect(outline).toContain("test.describe('Checkout flow · transition coverage'");
    expect(outline.match(/^\s+test\('TC\d+/gm)!.length).toBe(cases.length);
    expect(outline).toContain("await fire(page, 'checkout'); // Cart → Shipping");
    expect(outline).toContain("await expect(state(page)).toHaveText('Shipping');");
  });

  test('all-states coverage visits every reachable state with fewer steps', async ({ page }) => {
    await page.getByTestId('preset-login').click();
    await expect(page.getByTestId('machine-name')).toHaveText('Login flow');
    const m = await machine(page);
    const transSteps = (await casesOf(page)).flat().length;
    await page.getByTestId('cov-states').click();
    await expect(page.getByTestId('cov-states')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('gen-stat')).toHaveAttribute('data-covered', '6');
    await expect(page.getByTestId('gen-stat')).toHaveAttribute('data-total', '7');
    const cases = await casesOf(page);
    const { visited } = replay(m, cases);
    expect([...visited].sort()).toEqual(['Credentials', 'Locked', 'MfaChallenge', 'SignedIn', 'SignedOut', 'Verifying']);
    expect(cases.flat().length).toBeLessThan(transSteps);
    await expect(page.getByTestId('outline')).toContainText('all-states coverage');
    // the self-loop wrongCode is covered by the transition suite, not required for states
    await page.getByTestId('cov-transitions').click();
    expect((await casesOf(page)).flat()).toContain('wrongCode');
  });

  test('build a state, rename it, wire it up, nudge it with the keyboard and survive reload', async ({ page }) => {
    await page.getByTestId('preset-login').click();
    await expect(page.getByTestId('deadends')).toHaveAttribute('data-ids', 'Locked');
    await page.getByTestId('add-state').click();
    await expect(page.getByTestId('state-name')).toBeFocused();
    await page.getByTestId('state-name').fill('Recovery');
    await page.getByTestId('state-name').press('Enter');
    await page.getByTestId('state-name').blur();
    await expect(page.getByTestId('node-Recovery')).toBeVisible();
    await expect(page.getByTestId('unreachable')).toHaveAttribute('data-ids', 'ResetPassword Recovery');

    await page.getByTestId('t-from').selectOption('Locked');
    await page.getByTestId('t-event').fill('contactSupport');
    await page.getByTestId('t-to').selectOption('Recovery');
    await page.getByTestId('t-add').click();
    await page.getByTestId('t-from').selectOption('Recovery');
    await page.getByTestId('t-event').fill('reset');
    await page.getByTestId('t-to').selectOption('ResetPassword');
    await page.getByTestId('t-add').click();
    await expect(page.getByTestId('unreachable')).toHaveAttribute('data-ids', '');
    await expect(page.getByTestId('deadends')).toHaveAttribute('data-ids', '');

    const before = (await machine(page)).states.find((s) => s.id === 'Recovery')!;
    await page.getByTestId('node-Recovery').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    const after = (await machine(page)).states.find((s) => s.id === 'Recovery')!;
    expect([after.x - before.x, after.y - before.y]).toEqual([10, -10]);

    await page.reload();
    await expect(page.getByTestId('node-Recovery')).toBeVisible();
    await expect(page.getByTestId('edge-Locked-Recovery')).toHaveAttribute('data-events', 'contactSupport');
    expect((await machine(page)).states.find((s) => s.id === 'Recovery')!.x).toBe(after.x);
  });

  test('dragging a state moves it and redraws its edges', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse drag is exercised on desktop; the mobile sheet scrolls sideways and nodes are nudged by keyboard in another test');
    const node = page.getByTestId('node-Review');
    const edge = page.locator('#p-Review-Processing');
    const d0 = await edge.getAttribute('d');
    const box = (await node.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 + 80, { steps: 8 });
    await page.mouse.up();
    const s = (await machine(page)).states.find((x) => x.id === 'Review')!;
    expect(s.x).toBeLessThan(790);
    expect(s.y).toBeGreaterThan(80);
    expect(await edge.getAttribute('d')).not.toBe(d0);
    // a drag is not a click: the inspector stays closed
    await expect(page.getByTestId('inspector')).toBeHidden();
  });
});
