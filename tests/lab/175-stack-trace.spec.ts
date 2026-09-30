import { test, expect, Page } from '@playwright/test';

const URL = '/lab/175-stack-trace.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__trace.state);
const arena = (page: Page, opts: any) => page.evaluate((o) => (window as any).__trace.arena(o), opts);
const set = (page: Page, patch: any) => page.evaluate((p) => (window as any).__trace.set(p), patch);

async function start(page: Page, url = URL) {
  await page.goto(url);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('ready')).toBeHidden();
  await expect(page.getByTestId('scene')).toBeFocused();   // focus moves off the vanished Start button
  expect((await S(page)).mode).toBe('play');
}

test.describe('175 Stack Trace', () => {
  test('floors are seeded, and every floor connects the start to the way down', async ({ page }) => {
    await page.goto(URL);
    const layouts = await page.evaluate(() => {
      const T = (window as any).__trace, out: any[] = [];
      for (let f = 1; f <= T.FLOORS; f++) {
        const p = T.peek(f);
        // breadth-first search over floor tiles from the start
        const seen = new Set([p.start.y * T.GW + p.start.x]), q = [p.start];
        while (q.length) {
          const c = q.shift();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = c.x + dx, y = c.y + dy, i = y * T.GW + x;
            if (x < 0 || y < 0 || x >= T.GW || y >= T.GH || p.map[i] !== 1 || seen.has(i)) continue;
            seen.add(i); q.push({ x, y });
          }
        }
        const goal = p.exit || p.enemies.find((e: any) => e.type === 'root');
        out.push({ f, reach: seen.has(goal.y * T.GW + goal.x), allItems: [...p.enemies, ...p.items].every((e: any) => seen.has(e.y * T.GW + e.x)),
          hasExit: !!p.exit, root: p.enemies.filter((e: any) => e.type === 'root').length, hash: p.map.join('') });
      }
      return out;
    });
    for (const l of layouts) {
      expect(l.reach, `floor ${l.f} reachable`).toBe(true);
      expect(l.allItems, `floor ${l.f} bugs and items reachable`).toBe(true);
      expect(l.hasExit).toBe(l.f < 5);
      expect(l.root).toBe(l.f === 5 ? 1 : 0);
    }
    // same seed, same floors; other seeds, other floors (and other incidents)
    await page.reload();
    const again = await page.evaluate(() => (window as any).__trace.peek(1).map.join(''));
    expect(again).toBe(layouts[0].hash);
    const others = new Set<string>(), incidents = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      await page.goto(`/lab/175-stack-trace.html?seed=${seed}`);
      others.add(await page.evaluate(() => (window as any).__trace.peek(1).map.join('')));
      incidents.add((await S(page)).incident);
    }
    expect(others.size).toBe(6);
    expect(incidents.size).toBe(3);
  });

  test('moving, walls, and squashing a NullPointer by walking into it', async ({ page }) => {
    await start(page);
    let s = await arena(page, { w: 10, h: 6, player: [2, 2], enemies: [['nullref', 8, 2]] });
    expect(s.enemies[0].awake).toBe(true);                   // in view, so it wakes
    await page.keyboard.press('ArrowRight');
    s = await S(page);
    expect(s.player).toEqual({ x: 3, y: 2 });
    expect(s.turn).toBe(1);
    expect(s.enemies[0].x).toBe(7);                           // it walks one square towards you
    // a wall costs no turn
    await arena(page, { w: 10, h: 6, player: [1, 1] });
    const t0 = (await S(page)).turn;
    await page.keyboard.press('ArrowUp');
    s = await S(page);
    expect(s.player).toEqual({ x: 1, y: 1 });
    expect(s.turn).toBe(t0);
    expect(s.log[0]).toContain("That's a wall");
    // bump to attack: 2 hits, and it hits back in between
    await arena(page, { w: 10, h: 6, player: [2, 2], enemies: [['nullref', 3, 2]] });
    await page.keyboard.press('d');
    s = await S(page);
    expect(s.enemies[0].hp).toBe(1);
    expect(s.hp).toBe(9);
    await expect(page.getByTestId('hp')).toHaveText('9/10');
    await page.keyboard.press('l');
    s = await S(page);
    expect(s.enemies).toHaveLength(0);
    expect(s.kills).toBe(1);
    expect(s.score).toBe(10);
    expect(s.player).toEqual({ x: 2, y: 2 });                 // attacking doesn't move you
    await expect(page.getByTestId('score')).toHaveText('10');
    await expect(page.getByTestId('log').locator('li').first()).toHaveText('Squashed a NullPointer. +10');
  });

  test('a RaceCondition moves two squares on even turns; a MemoryLeak allocates a blob every 5', async ({ page }) => {
    await start(page);
    await arena(page, { w: 16, h: 8, player: [2, 2], enemies: [['race', 9, 2]] });
    const xs: number[] = [];
    for (let i = 0; i < 4; i++) { await page.keyboard.press('.'); xs.push((await S(page)).enemies[0].x); }
    expect(xs).toEqual([9, 7, 7, 5]);
    // leak
    await arena(page, { w: 16, h: 8, player: [2, 2], enemies: [['leak', 7, 5]] });
    await set(page, { turn: 0 });
    for (let i = 0; i < 4; i++) await page.keyboard.press('Space');
    let s = await S(page);
    expect(s.enemies.filter((e: any) => e.type === 'blob')).toHaveLength(0);
    await page.keyboard.press('Space');
    s = await S(page);
    expect(s.enemies.filter((e: any) => e.type === 'blob')).toHaveLength(1);
    expect(s.log).toContain('The MemoryLeak allocated another blob.');
    const leak = s.enemies.find((e: any) => e.type === 'leak');
    const blob = s.enemies.find((e: any) => e.type === 'blob');
    expect(Math.abs(leak.x - blob.x) + Math.abs(leak.y - blob.y)).toBe(1);
  });

  test('the Heisenbug vanishes when observed, unless a breakpoint freezes it', async ({ page }) => {
    await start(page);
    let s = await arena(page, { w: 16, h: 10, player: [2, 2], enemies: [['heisen', 5, 2]] });
    await page.keyboard.press('.');
    s = await S(page);
    expect(s.blinks).toBe(1);
    const h = s.enemies[0];
    expect(Math.abs(h.x - 2) + Math.abs(h.y - 2)).toBeGreaterThanOrEqual(6);  // teleported ≥ 7 away, then took a step
    await expect(page.getByTestId('log').locator('li').first()).toHaveText('The Heisenbug vanished the moment you looked at it.');
    // breakpoint: everything freezes for 5 turns, so you can walk up and catch it
    await arena(page, { w: 16, h: 10, player: [2, 2], enemies: [['heisen', 5, 2]] });
    await set(page, { inv: { log: 0, bp: 1, duck: 0 } });
    await expect(page.getByTestId('use-bp')).toHaveText('2 · breakpoint ×1');
    await page.keyboard.press('2');
    s = await S(page);
    expect(s.freeze).toBe(4);
    expect(s.inv.bp).toBe(0);
    expect(s.enemies[0]).toMatchObject({ x: 5, y: 2 });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    s = await S(page);
    expect(s.enemies[0]).toMatchObject({ x: 5, y: 2 });
    expect(s.blinks).toBe(1);                                 // still just the one from before
    await page.keyboard.press('ArrowRight');
    s = await S(page);
    expect(s.enemies).toHaveLength(0);
    expect(s.score).toBe(50);
    expect(s.inv.bp).toBe(1);                                 // it drops a breakpoint
  });

  test('console.log, the rubber duck, coffee and pickups', async ({ page }) => {
    await start(page);
    let s = await S(page);
    expect(s.seenCount).toBeLessThan(24 * 16);
    await expect(page.getByTestId('use-log')).toBeDisabled();
    await set(page, { inv: { log: 1, bp: 0, duck: 1 } });
    await page.keyboard.press('1');
    s = await S(page);
    expect(s.seenCount).toBe(24 * 16);
    expect(s.logged).toBe(true);
    expect(s.enemies.every((e: any) => e.awake)).toBe(true);
    // an empty tool costs no turn
    const t = s.turn;
    await page.keyboard.press('1');
    s = await S(page);
    expect(s.turn).toBe(t);
    expect(s.log[0]).toBe('No console.log left.');
    // the duck heals 4, capped at the maximum
    await arena(page, { w: 10, h: 6, player: [2, 2], items: [['coffee', 3, 2], ['bp', 4, 2]] });
    await set(page, { hp: 3 });
    await page.getByTestId('use-duck').click();
    s = await S(page);
    expect(s.hp).toBe(7);
    expect(s.inv.duck).toBe(0);
    await expect(page.getByTestId('use-duck')).toBeDisabled();
    // walk over coffee and a breakpoint
    await page.getByTestId('scene').focus();
    await page.keyboard.press('ArrowRight');
    s = await S(page);
    expect(s.maxHp).toBe(11);
    expect(s.hp).toBe(8);
    await page.keyboard.press('ArrowRight');
    s = await S(page);
    expect(s.inv.bp).toBe(1);
    expect(s.items).toHaveLength(0);
    await expect(page.getByTestId('use-bp')).toBeEnabled();
    await set(page, { hp: 10, inv: { log: 0, bp: 1, duck: 1 } });
    await page.keyboard.press('3');
    expect((await S(page)).hp).toBe(11);
  });

  test('down the call stack to the root cause', async ({ page }) => {
    await start(page);
    const frames = await page.getByTestId('trace').locator('li:not(.err)').allTextContents();
    expect(frames).toHaveLength(5);
    await expect(page.getByTestId('frame-1')).toHaveAttribute('aria-current', 'step');
    for (let f = 1; f <= 4; f++) {
      await arena(page, { w: 8, h: 5, player: [2, 2], exit: [3, 2] });
      await page.keyboard.press('ArrowRight');
      const s = await S(page);
      expect(s.floor).toBe(f + 1);
      expect(s.score).toBe(100 * f);
      await expect(page.getByTestId(`frame-${f + 1}`)).toHaveAttribute('aria-current', 'step');
      await expect(page.getByTestId(`frame-${f}`)).toHaveClass('done');
      await expect(page.getByTestId('floor')).toHaveText(`${f + 1}/5`);
      await expect(page.getByTestId('status')).toContainText(`Frame ${f + 1} of 5`);
    }
    // the root cause: 6 hits, and it hits back for 2 on even turns
    await arena(page, { w: 8, h: 5, player: [2, 2], enemies: [['root', 3, 2]] });
    await set(page, { hp: 10, turn: 0 });
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    const s = await S(page);
    expect(s.mode).toBe('won');
    expect(s.hp).toBe(6);
    expect(s.score).toBe(400 + 200 + 500 + 6 * 10);
    await expect(page.getByTestId('end')).toBeVisible();
    await expect(page.getByTestId('end-text')).toContainText('Fixed in commit');
    await expect(page.getByTestId('end-score')).toHaveText('1,160');
    await expect(page.getByTestId('again')).toBeFocused();
    await expect(page.getByTestId('frame-5')).toHaveClass('done');
    await page.reload();
    await expect(page.getByTestId('best')).toHaveText('1,160');
  });

  test('running out of patience closes the ticket; touch and the d-pad move you', async ({ page }) => {
    await start(page);
    await arena(page, { w: 10, h: 6, player: [2, 2], enemies: [['nullref', 3, 2]] });
    await set(page, { hp: 1 });
    await page.keyboard.press('.');
    let s = await S(page);
    expect(s.mode).toBe('lost');
    expect(s.hp).toBe(0);
    await expect(page.getByTestId('end')).toContainText('cannot reproduce');
    await expect(page.getByTestId('again')).toBeFocused();
    await page.keyboard.press('ArrowRight');                  // no moves once it's over
    expect((await S(page)).player).toEqual(s.player);
    await page.getByTestId('again').click();
    await expect(page.getByTestId('end')).toBeHidden();
    await expect(page.getByTestId('scene')).toBeFocused();
    s = await S(page);
    expect(s.mode).toBe('play');
    expect(s.hp).toBe(10);
    // touch: tap to the right of the player, then use the d-pad
    await arena(page, { w: 10, h: 6, player: [4, 3] });
    const scene = page.getByTestId('scene'), box = (await scene.boundingBox())!;
    const tap = (cx: number, cy: number) => scene.dispatchEvent('pointerdown', { pointerId: 4, pointerType: 'touch', bubbles: true,
      clientX: box.x + ((cx + 0.5) / 24) * box.width, clientY: box.y + ((cy + 0.5) / 16) * box.height });
    await tap(8, 3);
    expect((await S(page)).player).toEqual({ x: 5, y: 3 });
    await tap(5, 1);
    expect((await S(page)).player).toEqual({ x: 5, y: 2 });
    await page.getByTestId('pad-down').click();
    expect((await S(page)).player).toEqual({ x: 5, y: 3 });
    const t = (await S(page)).turn;
    await page.getByTestId('pad-wait').click();
    expect((await S(page)).turn).toBe(t + 1);
  });

  test('pause holds every input until you resume', async ({ page }) => {
    await start(page);
    await arena(page, { w: 10, h: 6, player: [2, 2] });
    await page.keyboard.press('p');
    await expect(page.getByTestId('paused')).toBeVisible();
    await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('resume')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    expect((await S(page)).player).toEqual({ x: 2, y: 2 });
    expect((await S(page)).mode).toBe('paused');
    await page.keyboard.press('p');
    await expect(page.getByTestId('paused')).toBeHidden();
    await expect(page.getByTestId('scene')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    expect((await S(page)).player).toEqual({ x: 3, y: 2 });
    // the Resume button does the same
    await page.getByTestId('pause').click();
    await page.getByTestId('resume').click();
    await expect(page.getByTestId('paused')).toBeHidden();
    await expect(page.getByTestId('scene')).toBeFocused();
  });
});
