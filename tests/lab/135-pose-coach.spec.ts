import { test, expect, Page } from '@playwright/test';

const URL = '/lab/135-pose-coach.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__pose.state);
const SETTINGS = ['city', 'nature', 'beach', 'wedding', 'graduation', 'food', 'sports'];
const ids = (page: Page) => page.getByTestId('card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));

async function pick(page: Page, people: number, setting: string, vibe?: string) {
  await page.getByTestId(`people-${people}`).check();
  await page.getByTestId(`setting-${setting}`).check();
  if (vibe) await page.getByTestId(`vibe-${vibe}`).check();
}
/** A fake camera: a canvas stream that keeps repainting. */
const fakeCamera = () => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 240;
  const g = c.getContext('2d')!; let t = 0;
  setInterval(() => { g.fillStyle = `hsl(${(t += 20) % 360} 70% 50%)`; g.fillRect(0, 0, 320, 240); }, 50);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => (c as any).captureStream(15) } });
};

test.describe('135 Pose Coach', () => {
  test('filtering: every card shown fits the group size and setting, for every combination', async ({ page }) => {
    await page.goto(URL);
    const poses: any[] = await page.evaluate(() => (window as any).__pose.poses);
    const byId = Object.fromEntries(poses.map((p) => [p.id, p]));
    // all 42 combinations through the deck function
    const all = await page.evaluate((SETTINGS) => {
      const out: any = {};
      for (let n = 1; n <= 6; n++) for (const s of SETTINGS) out[`${n}|${s}`] = (window as any).__pose.deck({ people: n, setting: s, vibe: 'candid', orient: 'portrait' }, 7);
      return out;
    }, SETTINGS);
    for (const [key, cards] of Object.entries(all) as [string, any[]][]) {
      const [n, s] = key.split('|');
      expect(cards.length, key).toBeGreaterThanOrEqual(3);
      expect(cards.length, key).toBeLessThanOrEqual(6);
      const fits = poses.filter((p) => +n >= p.min && +n <= p.max && p.settings.includes(s)).length;
      expect(cards.length, key).toBe(Math.min(6, fits));
      for (const c of cards) {
        const p = byId[c.id];
        expect(+n >= p.min && +n <= p.max, `${c.id} for ${n} people`).toBe(true);
        expect(p.settings, `${c.id} at ${s}`).toContain(s);
      }
    }
    // and through the UI, reading the rendered cards
    for (const [n, s, v] of [[1, 'food', 'candid'], [2, 'wedding', 'classic'], [4, 'graduation', 'playful'], [6, 'sports', 'editorial'], [3, 'beach', 'playful']] as const) {
      await pick(page, n, s, v);
      const shown = await ids(page);
      expect(shown.length).toBeGreaterThanOrEqual(3);
      for (const id of shown) {
        const p = byId[id!];
        expect(n >= p.min && n <= p.max && p.settings.includes(s), `${id} for ${n} at ${s}`).toBe(true);
      }
      // cards in the chosen vibe come first; any others say so
      const vibeOk = shown.map((id) => byId[id!].vibes.includes(v));
      expect(vibeOk).toEqual([...vibeOk].sort((a, b) => Number(b) - Number(a)));
      await expect(page.locator('.vibe-note')).toHaveCount(vibeOk.filter((x) => !x).length);
      await expect(page.getByTestId('summary')).toContainText(`${n} ${n === 1 ? 'person' : 'people'}`);
    }
  });

  test('shuffles are seeded: the same seed gives the same cards, and the URL reproduces a shuffle', async ({ page }) => {
    await page.goto('/lab/135-pose-coach.html?seed=7&people=3&setting=city&vibe=candid');
    const first = await ids(page);
    const f = { people: 3, setting: 'city', vibe: 'candid', orient: 'portrait' };
    const decks = await page.evaluate((f) => [7, 7, 1, 2, 3, 4, 5].map((s) => (window as any).__pose.deck(f, s).map((c: any) => c.id).join()), f);
    expect(decks[0]).toBe(decks[1]);
    expect(decks[0]).toBe(first.join());
    expect(new Set(decks).size).toBeGreaterThan(2);
    await page.getByTestId('shuffle').click();
    const seed = (await S(page)).seed;
    expect(seed).not.toBe(7);
    expect(page.url()).toContain(`seed=${seed}`);
    await expect(page.getByTestId('seed')).toHaveText(`shuffle seed ${seed}`);
    const shuffled = await ids(page);
    await page.reload();
    expect(await ids(page)).toEqual(shuffled);
    expect((await S(page)).people).toBe(3);
  });

  test('self-timer counts down under page.clock and takes one snapshot; cancel stops it', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-26T15:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-26T15:00:05Z'));                    // nothing moves until the test says so
    await page.getByTestId('timer').selectOption('3');
    await page.getByTestId('shoot').click();
    await expect(page.getByTestId('countdown')).toHaveText('3');
    await expect(page.getByTestId('cancel')).toBeFocused();
    await page.clock.runFor(999);
    await expect(page.getByTestId('countdown')).toHaveText('3');
    await page.clock.runFor(1);
    await expect(page.getByTestId('countdown')).toHaveText('2');
    await page.clock.runFor(1000);
    await expect(page.getByTestId('countdown')).toHaveText('1');
    expect((await S(page)).snaps).toBe(0);
    await page.clock.runFor(1000);
    await expect(page.getByTestId('snap')).toHaveCount(1);
    await expect(page.getByTestId('countdown')).toHaveText('');
    await expect(page.getByTestId('shoot')).toBeFocused();
    await expect(page.getByTestId('snap').locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    // 5 s timer, cancelled after 2 s: nothing more is taken
    await page.getByTestId('timer').selectOption('5');
    await page.getByTestId('shoot').click();
    await page.clock.runFor(2000);
    await expect(page.getByTestId('countdown')).toHaveText('3');
    await page.getByTestId('cancel').click();
    await page.clock.runFor(10_000);
    expect((await S(page)).snaps).toBe(1);
    await expect(page.getByTestId('cam-status')).toHaveText('Timer cancelled.');
  });

  test('the thirds grid sits at exactly 1/3 and 2/3 of the frame, portrait and landscape', async ({ page }) => {
    await page.goto(URL);
    for (const orient of ['portrait', 'landscape']) {
      await page.getByTestId(`orient-${orient}`).check();
      const stage = (await page.getByTestId('stage').boundingBox())!;
      expect(stage.width / stage.height).toBeCloseTo(orient === 'portrait' ? 3 / 4 : 4 / 3, 2);
      const mid = async (id: string) => { const b = (await page.getByTestId(id).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; };
      const [v1, v2, h1, h2] = await Promise.all(['grid-v1', 'grid-v2', 'grid-h1', 'grid-h2'].map(mid));
      expect(Math.abs(v1.x - (stage.x + stage.width / 3))).toBeLessThan(1);
      expect(Math.abs(v2.x - (stage.x + (2 * stage.width) / 3))).toBeLessThan(1);
      expect(Math.abs(h1.y - (stage.y + stage.height / 3))).toBeLessThan(1);
      expect(Math.abs(h2.y - (stage.y + (2 * stage.height) / 3))).toBeLessThan(1);
      expect(v1.h).toBeCloseTo(stage.height, 0);                                   // full-height verticals
      expect(h1.w).toBeCloseTo(stage.width, 0);                                    // full-width horizontals
      const still = await page.evaluate(() => { const c = document.querySelector('[data-testid=still]') as HTMLCanvasElement; return [c.width, c.height]; });
      expect(still).toEqual(orient === 'portrait' ? [600, 800] : [800, 600]);
    }
    await page.getByTestId('grid-toggle').uncheck();
    await expect(page.getByTestId('grid-v1')).toBeHidden();
    await page.getByTestId('grid-toggle').check();
    await expect(page.getByTestId('grid-h2')).toBeVisible();
  });

  test('no getUserMedia: the frame falls back to the demo scene or an uploaded photo, fully usable', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }));
    await page.clock.install({ time: new Date('2026-09-26T15:00:00Z') });
    await page.goto(URL);
    await page.clock.pauseAt(new Date('2026-09-26T15:00:05Z'));                    // nothing moves until the test says so
    const s = await S(page);
    expect(s.hasCamera).toBe(false);
    expect(s.camera).toBe('fallback');
    await expect(page.getByTestId('cam-start')).toBeDisabled();
    await expect(page.getByTestId('cam-support')).toContainText('No camera is available');
    await expect(page.getByTestId('still')).toBeVisible();
    await expect(page.getByTestId('video')).toBeHidden();
    // an uploaded photo fills the frame
    const dataUrl = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const g = c.getContext('2d')!; g.fillStyle = '#1e90ff'; g.fillRect(0, 0, 300, 400); return c.toDataURL('image/png'); });
    await page.getByTestId('file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
    await expect(page.getByTestId('cam-status')).toContainText('Your photo is in the frame');
    const px = await page.evaluate(() => Array.from((document.querySelector('[data-testid=still]') as HTMLCanvasElement).getContext('2d')!.getImageData(300, 400, 1, 1).data));
    expect(px).toEqual([30, 144, 255, 255]);
    await page.getByTestId('timer').selectOption('3');
    await page.getByTestId('shoot').click();
    await page.clock.runFor(3000);
    await expect(page.getByTestId('snap')).toHaveCount(1);
    await page.getByTestId('demo').click();
    await expect(page.getByTestId('cam-status')).toHaveText('Demo scene.');
  });

  test('with a (fake) camera: Start shows the live preview, Stop returns to the still frame', async ({ page }) => {
    await page.addInitScript(fakeCamera);
    await page.goto(URL);
    expect((await S(page)).hasCamera).toBe(true);
    await expect(page.getByTestId('cam-start')).toBeEnabled();
    await page.getByTestId('cam-start').click();
    await expect(page.getByTestId('video')).toBeVisible();
    expect((await S(page)).camera).toBe('live');
    await expect.poll(() => page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).videoWidth)).toBe(320);
    await expect(page.getByTestId('cam-stop')).toBeFocused();
    await expect(page.getByTestId('grid-v1')).toBeVisible();                        // the overlay stays on top of the live feed
    await page.getByTestId('cam-stop').click();
    expect((await S(page)).camera).toBe('off');
    await expect(page.getByTestId('still')).toBeVisible();
    await expect(page.getByTestId('cam-start')).toBeFocused();
  });

  test('a refused camera permission falls back with a clear message', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) } }));
    await page.goto(URL);
    await page.getByTestId('cam-start').click();
    await expect(page.getByTestId('cam-status')).toContainText('could not start');
    expect((await S(page)).camera).toBe('fallback');
    await expect(page.getByTestId('still')).toBeVisible();
  });

  test('the pose ghost draws one mannequin per person and follows the card you pick', async ({ page }) => {
    await page.goto(URL);
    await pick(page, 4, 'nature');
    const ghostFigs = () => page.getByTestId('ghost').locator('g').count();
    expect(await ghostFigs()).toBe(4);
    const second = page.getByTestId('card').nth(1);
    await second.getByTestId('use-ghost').click();
    await expect(second.getByTestId('use-ghost')).toHaveAttribute('aria-pressed', 'true');
    expect((await S(page)).ghost).toBe(await second.getAttribute('data-id'));
    await expect(page.getByTestId('card').first().getByTestId('use-ghost')).toHaveAttribute('aria-pressed', 'false');
    // every card's own sketch also has one figure per person
    for (const svg of await page.getByTestId('card').locator('svg.fig').all()) expect(await svg.locator('g').count()).toBe(4);
    await pick(page, 1, 'nature');
    expect(await ghostFigs()).toBe(1);
  });

  test('favourites persist across a reload and can be removed from the list', async ({ page }) => {
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const cards = page.getByTestId('card');
    const a = await cards.nth(0).getAttribute('data-id'), b = await cards.nth(2).getAttribute('data-id');
    await cards.nth(0).getByTestId('fav').click();
    await cards.nth(2).getByTestId('fav').click();
    await expect(cards.nth(0).getByTestId('fav')).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    expect((await S(page)).favs).toEqual([a, b]);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('pose-coach.favs')))!)).toEqual([a, b]);
    await expect(page.getByTestId('fav-item')).toHaveCount(2);
    await expect(page.locator(`li.card[data-id="${b}"]`).getByTestId('fav')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('fav-item').first().getByRole('button').click();
    await expect(page.getByTestId('fav-item')).toHaveCount(1);
    await expect(page.locator(`li.card[data-id="${a}"]`).getByTestId('fav')).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    expect((await S(page)).favs).toEqual([b]);
  });

  test('the shot list copies as plain text: header, numbered poses, hands and camera tips', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { (window as any).__copied.push(t); } } });
    });
    await page.goto(URL);
    await pick(page, 2, 'beach', 'playful');
    await page.getByTestId('orient-landscape').check();
    await expect(page.getByTestId('copy')).toBeDisabled();
    const cards = page.getByTestId('card');
    const picked = [cards.nth(1), cards.nth(0)];
    const want = ['Pose Coach shot list: 2 people · Beach · Playful · landscape'];
    for (const [i, c] of picked.entries()) {
      await c.getByTestId('add-shot').click();
      const name = await c.getByTestId('card-name').textContent();
      const hands = await c.locator('dt:text-is("Hands") + dd').textContent();
      const cam = await c.locator('dt:text-is("Camera") + dd').textContent();
      want.push(`${i + 1}. ${name}: ${hands} Camera: ${cam}`);
    }
    await picked[1].getByTestId('add-shot').click();                                  // adding twice doesn't duplicate
    await expect(page.getByTestId('shot')).toHaveCount(2);
    await page.getByTestId('copy').click();
    await expect(page.getByTestId('copy-status')).toHaveText('Copied 2 shots to the clipboard.');
    expect(await page.evaluate(() => (window as any).__copied)).toEqual([want.join('\n')]);
    await expect(page.getByTestId('shot-text')).toHaveValue(want.join('\n'));
    await page.getByTestId('shot').first().getByRole('button').click();
    await expect(page.getByTestId('shot')).toHaveCount(1);
    await expect(page.getByTestId('shot-text')).toHaveValue(new RegExp(`^${want[0]}\\n1\\. `));
  });
});
