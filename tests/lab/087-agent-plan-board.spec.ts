import { test, expect, type Page } from '@playwright/test';

const URL = '/lab/087-agent-plan-board.html';
type Slot = { id: string; agent: number; start: number; end: number };
const slots = (page: Page): Promise<Slot[]> => page.getByTestId('slot').evaluateAll((els) => els.map((e) => ({
  id: e.getAttribute('data-id')!, agent: Number(e.getAttribute('data-agent')), start: Number(e.getAttribute('data-start')), end: Number(e.getAttribute('data-end')) })));
const deps = (page: Page) => page.getByTestId('task').evaluateAll((trs) => Object.fromEntries(trs.map((tr) => [tr.getAttribute('data-id')!,
  (tr.querySelector('[data-testid="t-deps"]') as HTMLInputElement).value.split(/[,\s]+/).filter(Boolean)])));
async function setAgents(page: Page, n: number) { await page.getByTestId('agents').fill(String(n)); await expect(page.getByTestId('agents-out')).toHaveText(String(n)); }

// Schedule oracle: dependencies respected, no overlap on one agent, durations preserved.
async function checkSchedule(page: Page, n: number) {
  const s = await slots(page); const d = await deps(page);
  const byId = Object.fromEntries(s.map((x) => [x.id, x]));
  for (const x of s) {
    expect(x.agent).toBeLessThan(n);
    for (const p of d[x.id]) expect(byId[p].end, `${x.id} after ${p}`).toBeLessThanOrEqual(x.start);
  }
  for (let a = 0; a < n; a++) {
    const mine = s.filter((x) => x.agent === a).sort((p, q) => p.start - q.start);
    for (let i = 1; i < mine.length; i++) expect(mine[i].start).toBeGreaterThanOrEqual(mine[i - 1].end);
  }
  return s;
}

test.describe('Agent Plan Board', () => {
  test('feature preset: critical path, levels and parallelism', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('k-work')).toHaveText('5:30');
    await expect(page.getByTestId('k-cp')).toHaveText('3:15'); // T1 20 + T2 30 + T5 70 + T7 45 + T9 30
    await expect(page.getByTestId('k-par')).toHaveText('3');
    const crit = await page.locator('[data-testid="node"][data-crit="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
    expect(crit.sort()).toEqual(['T1', 'T2', 'T5', 'T7', 'T9']);
    await expect(page.locator('[data-testid="edge"][data-crit="true"]')).toHaveCount(4);
    expect(await page.getByTestId('level').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-count'))))).toEqual([1, 1, 3, 3, 1]);
    await expect(page.locator('[data-testid="task"][data-id="T4"]')).toHaveAttribute('data-slack', '10'); // 185 vs 195
    await expect(page.locator('[data-testid="task"][data-id="T8"]')).toHaveAttribute('data-slack', '40');
    await expect(page.getByTestId('markdown')).toContainText('Critical path: 195 min (T1 → T2 → T5 → T7 → T9)');
  });

  test('schedules respect dependencies; one agent takes the sum, enough agents hit the critical path', async ({ page }) => {
    await page.goto(URL);
    await setAgents(page, 1);
    let s = await checkSchedule(page, 1);
    expect(Math.max(...s.map((x) => x.end))).toBe(330);
    await expect(page.getByTestId('k-finish')).toHaveText('5:30');
    await setAgents(page, 2);
    s = await checkSchedule(page, 2);
    const two = Math.max(...s.map((x) => x.end));
    expect(two).toBeGreaterThanOrEqual(195);
    expect(two).toBeGreaterThanOrEqual(Math.ceil(330 / 2));
    await setAgents(page, 6);
    s = await checkSchedule(page, 6);
    expect(Math.max(...s.map((x) => x.end))).toBe(195);
    await expect(page.getByTestId('lane-verdict')).toContainText("more agents won't help");
    await expect(page.getByTestId('markdown')).toContainText('## Sub-agent 6');
    await expect(page.getByTestId('markdown')).toContainText('_Idle');
  });

  test('a cycle is detected, named and blocks the schedule until it is removed', async ({ page }) => {
    await page.goto(URL);
    await page.locator('[data-testid="task"][data-id="T2"] [data-testid="t-deps"]').fill('T1, T7');
    await expect(page.getByTestId('cycle')).toBeVisible();
    const path = (await page.getByTestId('cycle-path').textContent())!.split(' → ');
    expect(path[0]).toBe(path[path.length - 1]);
    expect(path).toContain('T2');
    expect(path).toContain('T7');
    await expect(page.getByTestId('slot')).toHaveCount(0);
    await expect(page.getByTestId('k-cp')).toHaveText('—');
    await expect(page.locator('[data-testid="task"][data-id="T2"] [data-testid="t-deps"]')).toHaveAttribute('aria-invalid', 'true');
    await page.locator('[data-testid="task"][data-id="T2"] [data-testid="t-deps"]').fill('T1');
    await expect(page.getByTestId('cycle')).toBeHidden();
    await expect(page.getByTestId('k-cp')).toHaveText('3:15');
  });

  test('editing tasks: new subtasks, unknown ids and durations change the plan', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('add-task').click();
    await expect(page.getByTestId('task')).toHaveCount(10);
    await expect(page.getByTestId('t-title').last()).toBeFocused();
    await page.getByTestId('t-title').last().fill('Announce in the changelog channel');
    await page.getByTestId('t-dur').last().fill('10');
    await expect(page.getByTestId('k-cp')).toHaveText('3:25'); // T10 hangs off T9 by default
    await page.getByTestId('t-deps').last().fill('T8, T99');
    await expect(page.getByTestId('warnings')).toContainText("T10 depends on T99, which doesn't exist");
    await expect(page.getByTestId('k-cp')).toHaveText('3:15');
    // make the UI panel much longer: the critical path stays on T5 and grows
    await page.locator('[data-testid="task"][data-id="T5"] [data-testid="t-dur"]').fill('100');
    await expect(page.getByTestId('k-cp')).toHaveText('3:45');
    await page.locator('[data-testid="task"][data-id="T5"] [data-testid="t-del"]').click();
    await expect(page.getByTestId('warnings')).toContainText('T7 depends on T5');
    await expect(page.getByTestId('k-cp')).toHaveText('3:05'); // T1 T2 T4 T7 T9 = 185
  });

  test('presets switch plans; the brief lists every task once', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-migrate').click();
    await expect(page.getByTestId('preset-migrate')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('goal')).toHaveValue('Move three packages into the monorepo');
    await expect(page.getByTestId('k-par')).toHaveText('4'); // A, B, C and CI at level 2
    await expect(page.getByTestId('k-cp')).toHaveText('3:00'); // 30 + 20 + 45 + 40 + 30 + 15
    await setAgents(page, 4);
    await checkSchedule(page, 4);
    const md = (await page.getByTestId('markdown').textContent())!;
    for (let i = 1; i <= 10; i++) expect(md.match(new RegExp(`\\*\\*T${i} —`, 'g')) || []).toHaveLength(1);
    await page.getByTestId('preset-flaky').click();
    await expect(page.getByTestId('k-work')).toHaveText('4:30');
    await expect(page.getByTestId('k-cp')).toHaveText('2:45'); // T2 40 + T5 25 + T7 60 + T9 40
  });
});
