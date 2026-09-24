import { test, expect, type Page } from '@playwright/test';

type Repo = { commits: Record<string, { id: string; parents: string[]; msg: string }>; order: string[]; branches: Record<string, string>; tags: Record<string, string>; HEAD: { branch?: string; detached?: string } };
const repo = (page: Page) => page.evaluate(() => (window as any).__git.repo) as Promise<Repo>;
async function git(page: Page, ...cmds: string[]) {
  for (const c of cmds) { await page.getByTestId('cmd').fill(c); await page.getByTestId('cmd').press('Enter'); }
}
const term = (page: Page) => page.getByTestId('terminal');
function history(r: Repo, id: string) { // first-parent + all parents ancestry messages
  const seen = new Set<string>(); const st = [id];
  while (st.length) { const c = st.pop()!; if (seen.has(c)) continue; seen.add(c); st.push(...r.commits[c].parents); }
  return [...seen];
}

test.describe('Git Graph Playground', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/lab/056-git-graph.html');
  });

  test('branch, commit and fast-forward merge from the command line', async ({ page }) => {
    await expect(page.getByTestId('head')).toContainText('HEAD → main');
    await git(page, 'switch -c feature', 'commit -m "Add search"', 'git commit -m "Search tests"');
    await expect(page.getByTestId('ref-feature')).toContainText('HEAD → feature');
    await expect(page.locator('[data-msg="Search tests"]')).toHaveClass(/\bhead\b/);
    await git(page, 'switch main', 'merge feature');
    await expect(term(page)).toContainText('Fast-forward');
    const r = await repo(page);
    expect(r.branches.main).toBe(r.branches.feature);
    expect(Object.values(r.commits).every((c) => c.parents.length <= 1)).toBe(true);
    await expect(page.getByTestId('graph')).toHaveAttribute('data-branch', 'main');
    await git(page, 'merge feature');
    await expect(term(page)).toContainText('Already up to date.');
  });

  test('diverged merge makes a two-parent commit; --no-ff; undo walks it back', async ({ page }) => {
    await git(page, 'branch topic', 'commit -m "Main work"', 'switch topic', 'commit -m "Topic work"', 'switch main');
    const before = await repo(page);
    await git(page, 'merge topic');
    await expect(term(page)).toContainText("Merge made by the 'ort' strategy.");
    let r = await repo(page);
    const merge = r.commits[r.branches.main];
    expect(merge.msg).toBe("Merge branch 'topic'");
    expect(merge.parents).toEqual([before.branches.main, before.branches.topic]);
    await expect(page.getByTestId(`c-${merge.id}`)).toHaveAttribute('data-parents', `${before.branches.main} ${before.branches.topic}`);

    await page.getByTestId('undo').click();
    r = await repo(page);
    expect(r.branches.main).toBe(before.branches.main);
    await expect(page.getByTestId(`c-${merge.id}`)).toHaveCount(0);

    // fast-forward possible, but --no-ff forces a merge commit
    await git(page, 'switch topic', 'commit -m "More topic"', 'switch -c release main', 'merge --no-ff topic');
    r = await repo(page);
    expect(r.commits[r.branches.release].parents).toHaveLength(2);
    expect(r.commits[r.branches.release].msg).toBe("Merge branch 'topic' into release");
  });

  test('challenge: make main linear with buttons (rebase + fast-forward)', async ({ page }) => {
    await page.getByTestId('start-linear').click();
    await expect(page.getByTestId('challenge-status')).toHaveAttribute('data-state', 'open');
    await page.getByTestId('target').selectOption('feature');
    await page.getByTestId('btn-switch').click();
    await page.getByTestId('target').selectOption('main');
    await page.getByTestId('btn-rebase').click();
    await expect(term(page)).toContainText('Successfully rebased and updated refs/heads/feature. (2 commits replayed)');
    // the two original feature commits are now unreachable ghosts
    await expect(page.locator('[data-msg="Add search box"][data-reachable="false"]')).toHaveCount(1);
    await expect(page.locator('[data-msg="Add search box"]')).toHaveCount(2);
    await page.getByTestId('target').selectOption('main');
    await page.getByTestId('btn-switch').click();
    await page.getByTestId('target').selectOption('feature');
    await page.getByTestId('btn-merge').click();
    await expect(term(page)).toContainText('Fast-forward');
    await expect(page.getByTestId('challenge-status')).toHaveAttribute('data-state', 'solved');
    await expect(page.getByTestId('ch-linear')).toContainText('✓ solved');
    const r = await repo(page);
    const hist = history(r, r.branches.main);
    expect(hist.every((id) => r.commits[id].parents.length <= 1)).toBe(true);
  });

  test('challenge: move a commit with cherry-pick and reset --hard', async ({ page }) => {
    await page.getByTestId('start-move').click();
    const wrong = page.locator('[data-msg="Add payment form"]');
    const hash = (await wrong.getAttribute('data-id'))!;
    await wrong.click();
    await expect(page.getByTestId('selected')).toContainText(`Selected ${hash} “Add payment form”`);
    await git(page, 'switch checkout-v2');
    await page.getByTestId('btn-cherry-pick').click();
    await expect(term(page)).toContainText('] Add payment form');
    await git(page, 'switch main', 'reset --hard HEAD~1');
    await expect(term(page)).toContainText('HEAD is now at');
    await expect(page.getByTestId('challenge-status')).toHaveAttribute('data-state', 'solved');
    await expect(page.getByTestId(`c-${hash}`)).toHaveAttribute('data-reachable', 'false');
    // cherry-picking something already in history is refused and changes nothing
    const r1 = await repo(page);
    await git(page, `cherry-pick ${r1.branches.main}`);
    await expect(term(page)).toContainText('The previous cherry-pick is now empty');
    expect((await repo(page)).order.length).toBe(r1.order.length);
  });

  test('detached HEAD, revision syntax, errors and tags', async ({ page }) => {
    await git(page, 'commit -m "Third"', 'checkout HEAD~2');
    await expect(page.getByTestId('head')).toContainText('HEAD detached');
    await expect(page.getByTestId('ref-HEAD')).toBeVisible();
    await expect(term(page)).toContainText("You are in 'detached HEAD' state.");
    await git(page, 'commit -m "Experiment"', 'switch main');
    await expect(term(page)).toContainText('Warning: you are leaving 1 commit behind');
    await expect(page.locator('[data-msg="Experiment"]')).toHaveAttribute('data-reachable', 'false');

    const before = await repo(page);
    await git(page, 'merge nope', 'branch -d main', 'rebase', 'frobnicate');
    await expect(term(page)).toContainText("fatal: ambiguous argument 'nope'");
    await expect(term(page)).toContainText("error: Cannot delete branch 'main' checked out");
    await expect(term(page)).toContainText("git: 'frobnicate' is not a git command");
    expect(await repo(page)).toEqual(before);

    await page.getByTestId('name').fill('v0.1');
    await page.locator('[data-msg="Add README"]').click();
    await page.getByTestId('btn-tag').click();
    const r = await repo(page);
    expect(r.commits[r.tags['v0.1']].msg).toBe('Add README');
    await expect(page.getByTestId('tag-v0.1')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__git.resolve('main~1'))).toBe(r.tags['v0.1']);
  });

  test('challenge: ship a release (--no-ff + tag) and progress persists', async ({ page }) => {
    await page.getByTestId('start-release').click();
    await git(page, 'merge release', 'undo');
    await expect(term(page)).toContainText('Undid the last command.');
    await git(page, 'merge --no-ff release', 'tag v1.0.0');
    await expect(page.getByTestId('challenge-status')).toHaveAttribute('data-state', 'solved');
    await page.reload();
    await expect(page.getByTestId('ch-release')).toContainText('✓ solved');
    await expect(page.getByTestId('tag-v1.0.0')).toBeVisible();
    await expect(page.getByTestId('challenge-status')).toHaveAttribute('data-state', 'solved');
  });
});
