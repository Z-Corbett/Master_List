import { test, expect, Page } from '@playwright/test';

const URL = '/lab/111-morse-trainer.html?seed=7';
const S = (page: Page) => page.evaluate(() => (window as any).__morse.state);

// Reference table typed in from ITU-R M.1677-1, independent of the page's own table.
const ITU: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.', '0': '-----',
  '.': '.-.-.-', ',': '--..--', ':': '---...', '?': '..--..', "'": '.----.', '-': '-....-', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
  '"': '.-..-.', '=': '-...-', '+': '.-.-.', '@': '.--.-.',
};

/** Independent oracle: the mark start times and lengths (in units) for a string, from the rules alone. */
function marksInUnits(text: string) {
  const out: { t: number; d: number }[] = [];
  let t = 0;
  text.trim().split(/\s+/).forEach((w, wi) => {
    if (wi) t += 7;
    [...w].forEach((c, ci) => {
      if (ci) t += 3;
      [...ITU[c]].forEach((s, si) => { if (si) t += 1; const d = s === '.' ? 1 : 3; out.push({ t, d }); t += d; });
    });
  });
  return { marks: out, end: t };
}

/** Key a sequence with the real key: [markMs, gapMs] pairs, driven by the fake clock. */
async function keySpace(page: Page, seq: [number, number][]) {
  await page.getByTestId('key').focus();
  for (const [on, off] of seq) {
    await page.keyboard.down(' ');
    await page.clock.runFor(on);
    await page.keyboard.up(' ');
    await page.clock.runFor(off);
  }
}
/** Turn a code string into key timings at `u` ms per unit: '...' + ' ' char gap + '/' word gap. */
function timings(code: string, u: number, jitter = 0): [number, number][] {
  const seq: [number, number][] = [];
  const toks = code.split('');
  for (let i = 0; i < toks.length; i++) {
    const c = toks[i];
    if (c !== '.' && c !== '-') continue;
    const next = toks[i + 1];
    const gap = next === ' ' ? 3 : next === '/' ? 7 : next === undefined ? 7 : 1;
    const j = 1 + (i % 2 ? jitter : -jitter);
    seq.push([Math.round((c === '.' ? 1 : 3) * u * j), Math.round(gap * u * j)]);
  }
  return seq;
}

/** Fake clock, paused: only runFor moves time, so slow round-trips can't stretch a key press. */
async function pinned(page: Page) {
  await page.clock.install({ time: new Date('2026-09-25T12:00:00Z') });
  await page.goto(URL);
  await page.clock.pauseAt(new Date('2026-09-25T12:01:00Z'));   // a minute on: never in the past, even on a slow load
}

test.describe('111 Morse Trainer', () => {
  test('PARIS plus a word space is 50 units at every speed; a dot is 1200/WPM ms', async ({ page }) => {
    await page.goto(URL);
    const ref = marksInUnits('PARIS');
    expect(ref.end + 7).toBe(50);                                     // the definition the whole WPM scale rests on
    for (const wpm of [5, 13, 20, 25, 40]) {
      const s = await page.evaluate((w) => (window as any).__morse.schedule('PARIS ', w, w), wpm);
      const u = 1200 / wpm;
      expect(s.units).toBe(50);
      expect(s.u).toBeCloseTo(u, 9);
      expect(s.totalMs).toBeCloseTo(50 * u, 6);                        // one word per minute ÷ WPM = 60 000 / WPM ms
      expect(s.totalMs).toBeCloseTo(60000 / wpm, 6);
      expect(s.marks.length).toBe(ref.marks.length);
      s.marks.forEach((m: any, i: number) => {
        expect(m.t).toBeCloseTo(ref.marks[i].t * u, 6);
        expect(m.d).toBeCloseTo(ref.marks[i].d * u, 6);
      });
    }
    // the readouts for the default "PARIS PARIS" at 20 WPM: 50 + 43 units, 60 ms dots
    await expect(page.getByTestId('dot-ms')).toHaveText('60 ms');
    await expect(page.getByTestId('dash-ms')).toHaveText('180 ms');
    await expect(page.getByTestId('char-gap')).toHaveText('180 ms');
    await expect(page.getByTestId('word-gap')).toHaveText('420 ms');
    await expect(page.getByTestId('units')).toHaveText('93');
    await expect(page.getByTestId('duration')).toHaveText('5.58 s');
    await expect(page.getByTestId('spacing')).toHaveText('Standard');
  });

  test('the code table matches ITU-R M.1677-1, and SOS is ...---...', async ({ page }) => {
    await page.goto(URL);
    const table = await page.evaluate(() => (window as any).__morse.CODES);
    expect(table).toEqual(ITU);
    for (const [c, code] of Object.entries(ITU)) {
      await expect(page.getByTestId(`ref-${c}`).locator('code')).toHaveText(code);
    }
    await page.getByTestId('text').fill('sos');
    await expect(page.getByTestId('code-out')).toHaveText('... --- ...');
    expect((await page.getByTestId('code-out').textContent())!.replace(/ /g, '')).toBe('...---...');
    // prefix-free check the other way: every code decodes back to its character
    const back = await page.evaluate((codes) => Object.values(codes).map((c) => (window as any).__morse.decode(c)), ITU);
    expect(back).toEqual(Object.keys(ITU));
  });

  test('encoder: lower case, word breaks, skipped symbols and live readouts', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('text').fill('cq  de k7 #1?');
    await expect(page.getByTestId('code-out')).toHaveText('-.-. --.- / -.. . / -.- --... / .---- ..--..');
    await expect(page.getByTestId('unknown')).toHaveText('Not in the ITU table, skipped: #');
    const expectUnits = (() => { const r = marksInUnits('CQ DE K7 1?'); return r.end; })();
    await expect(page.getByTestId('units')).toHaveText(String(expectUnits));
    await page.getByTestId('wpm').fill('13');
    await page.getByTestId('fwpm').fill('13');
    await expect(page.getByTestId('dot-ms')).toHaveText(`${Math.round((1200 / 13) * 10) / 10} ms`);   // 92.3 ms
    await expect(page.getByTestId('duration')).toHaveText(`${((expectUnits * 1200) / 13 / 1000).toFixed(2)} s`);
    await page.getByTestId('wpm').fill('99');
    await expect(page.getByTestId('warn')).toContainText('5 to 40');
    await page.getByTestId('wpm').fill('13');
    await page.getByTestId('fwpm').fill('20');
    await expect(page.getByTestId('warn')).toContainText('cannot be faster');
  });

  test('Farnsworth: characters stay fast, the spaces stretch to hit the effective speed', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('text').fill('PARIS ');
    await page.getByTestId('wpm').fill('18');
    await page.getByTestId('fwpm').fill('5');
    const c = 18, s = 5;
    // ARRL (Bloom) formula: ta = (60c − 37.2s) / (sc) seconds, split 3/19 and 7/19
    const ta = ((60 * c - 37.2 * s) / (s * c)) * 1000;
    await expect(page.getByTestId('spacing')).toHaveText('Farnsworth');
    await expect(page.getByTestId('dot-ms')).toHaveText(`${Math.round((1200 / c) * 10) / 10} ms`);
    await expect(page.getByTestId('char-gap')).toHaveText(`${Math.round(((3 * ta) / 19) * 10) / 10} ms`);
    await expect(page.getByTestId('word-gap')).toHaveText(`${Math.round(((7 * ta) / 19) * 10) / 10} ms`);
    // the point of the formula: one PARIS word takes 60/s seconds, so the effective speed is exactly s
    await expect(page.getByTestId('duration')).toHaveText('12.00 s');
    await expect(page.getByTestId('eff-wpm')).toHaveText('5.0 WPM');
    for (const [cc, ss] of [[20, 10], [25, 12], [15, 15]]) {
      const r = await page.evaluate(([a, b]) => (window as any).__morse.schedule('PARIS ', a, b), [cc, ss]);
      expect(r.totalMs).toBeCloseTo(60000 / ss, 6);
      expect(r.marks[1].t - (r.marks[0].t + r.marks[0].d)).toBeCloseTo(1200 / cc, 6);   // inside a character: 1 unit at c
    }
  });

  test('decoder: the space bar keys SOS, a long pause makes a word space', async ({ page }) => {
    await pinned(page);
    await page.getByTestId('dec-wpm').fill('20');
    const u = 1200 / 20;
    await keySpace(page, timings('... --- .../-.-', u));
    await expect(page.getByTestId('decoded')).toHaveText('SOS K');
    const marks = (await S(page)).decoder.marks;
    expect(marks.map((m: any) => m.sym).join('')).toBe('...---...-.-');
    expect(marks[0].d).toBeCloseTo(u, 0);
    expect(marks[3].d).toBeCloseTo(3 * u, 0);
    await expect(page.getByTestId('last-mark')).toContainText('dash');
    await expect(page.getByTestId('current')).toHaveText('');
  });

  test('decoder: pointer presses with human wobble decode PARIS; the 2-unit boundary; unknown codes', async ({ page }) => {
    await pinned(page);
    await page.getByTestId('dec-wpm').fill('15');
    const u = 1200 / 15, key = page.getByTestId('key');
    const press = async (on: number, off: number) => {
      await key.dispatchEvent('pointerdown', { button: 0, pointerId: 1, isPrimary: true });
      await page.clock.runFor(on);
      await key.dispatchEvent('pointerup', { button: 0, pointerId: 1, isPrimary: true });
      await page.clock.runFor(off);
    };
    for (const [on, off] of timings('.--. .- .-. .. ...', u, 0.2)) await press(on, off);
    await expect(page.getByTestId('decoded')).toHaveText('PARIS');
    // 1.9 units is still a dot, 2.1 units is a dash
    await page.getByTestId('clear').click();
    await press(1.9 * u, 3 * u);
    await press(2.1 * u, 3 * u);
    await expect(page.getByTestId('decoded')).toHaveText('ET');
    // six dots is not a character
    await page.getByTestId('clear').click();
    for (let i = 0; i < 6; i++) await press(u, i === 5 ? 3 * u : u);
    await expect(page.getByTestId('decoded')).toHaveText('?');
    // a character is not finished until 2 units of silence have passed
    await page.getByTestId('clear').click();
    await key.dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
    await page.clock.runFor(u);
    await key.dispatchEvent('pointerup', { button: 0, pointerId: 1 });
    await page.clock.runFor(1.5 * u);
    await expect(page.getByTestId('current')).toHaveText('.');
    await expect(page.getByTestId('decoded')).toHaveText('');
    await page.clock.runFor(u);
    await expect(page.getByTestId('decoded')).toHaveText('E');
  });

  test('without Web Audio, Play still runs the lamp on the exact schedule', async ({ page }) => {
    await page.addInitScript(() => { delete (window as any).AudioContext; delete (window as any).webkitAudioContext; });
    await pinned(page);
    await page.getByTestId('text').fill('TE');                         // dash, 3-unit gap, dot: 180 + 180 + 60 at 20 WPM
    await page.getByTestId('play').click();
    await expect(page.getByTestId('status')).toContainText('Web Audio is not available');
    expect((await S(page)).audio).toBe('unavailable');
    const lead = (await S(page)).lead;
    await page.clock.runFor(lead + 90);                                // middle of the dash
    expect((await S(page)).lamp).toBe(true);
    await expect(page.getByTestId('lamp')).toHaveClass(/on/);
    await expect(page.getByTestId('tape').locator('.m.on')).toHaveCount(1);
    await page.clock.runFor(180);                                      // t ≈ 270: inside the character gap
    expect((await S(page)).lamp).toBe(false);
    await page.clock.runFor(120);                                      // t ≈ 390: the E dot (360–420)
    expect((await S(page)).lamp).toBe(true);
    await page.clock.runFor(100);                                      // t ≈ 490: past the end at 420
    const st = await S(page);
    expect(st.lamp).toBe(false);
    expect(st.playing).toBe(false);
    await expect(page.getByTestId('status')).toHaveText('Finished: 2 marks in 0.42 s.');
    await expect(page.getByTestId('stop')).toBeDisabled();
  });

  test('sound waits for a gesture; a suspended context falls back to the lamp', async ({ page }) => {
    await page.goto(URL);
    expect((await S(page)).audio).toBe('none');
    await page.getByTestId('text').fill('PARIS PARIS PARIS');
    await page.getByTestId('play').click();
    await expect.poll(async () => (await S(page)).audio).toBe('running');
    await expect(page.getByTestId('status')).toHaveText('Sending the message at 20 WPM.');
    expect((await S(page)).playedWithSound).toBe(true);
    await page.getByTestId('stop').click();
    await expect(page.getByTestId('status')).toHaveText('Stopped.');
    // a browser that keeps the context suspended even after resume()
    await page.addInitScript(() => {
      (window as any).AudioContext = class { state = 'suspended'; currentTime = 0; resume() { return Promise.resolve(); } };
      delete (window as any).webkitAudioContext;
    });
    await page.goto(URL);
    expect((await S(page)).audio).toBe('none');
    await page.getByTestId('text').fill('SOS');
    await page.getByTestId('play').click();
    await expect(page.getByTestId('status')).toContainText('Audio is suspended, so watch the lamp.');
    const st = await S(page);
    expect(st.audio).toBe('suspended');
    expect(st.playedWithSound).toBe(false);
    await expect.poll(async () => (await S(page)).playing).toBe(false);   // it still finishes on its own
  });

  test('Koch trainer starts with K and M, and a seeded drill is repeatable', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('seed')).toHaveText('7');
    await expect(page.getByTestId('koch-chars').locator('.chip')).toHaveText(['K -.-', 'M --']);
    const a = (await S(page)).koch.drill as string;
    expect(a).toMatch(/^[KM]{5}( [KM]{5}){4}$/);
    await page.reload();
    expect((await S(page)).koch.drill).toBe(a);
    await page.goto('/lab/111-morse-trainer.html?seed=8');
    expect((await S(page)).koch.drill).not.toBe(a);
    // the teaching order is the usual Koch/LCWO one
    const order = await page.evaluate(() => (window as any).__morse.KOCH.join(''));
    expect(order.slice(0, 8)).toBe('KMURESNA');
    expect(order.length).toBe(41);
    // the drill is hidden until asked for
    await expect(page.getByTestId('drill')).toBeHidden();
    await page.getByTestId('reveal').click();
    await expect(page.getByTestId('reveal')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('drill')).toHaveText((await S(page)).koch.drill);
  });

  test('Koch scoring: 90% adds the next character, less does not', async ({ page }) => {
    await page.goto(URL);
    const drill = (await S(page)).koch.drill as string;
    // a lazy answer: all K. Oracle: the share of K in the drill
    const ks = [...drill.replace(/ /g, '')].filter((c) => c === 'K').length;
    await page.getByTestId('answer').fill('K'.repeat(25));
    await page.getByTestId('check').click();
    const pct = Math.round((100 * ks) / 25);
    await expect(page.getByTestId('result')).toContainText(`${ks} of 25 correct (${pct}%)`);
    expect(pct).toBeLessThan(90);
    expect((await S(page)).koch.level).toBe(2);
    // two mistakes out of 25 is 92%: enough
    const chars = [...drill.replace(/ /g, '')];
    chars[3] = chars[3] === 'K' ? 'M' : 'K';
    chars[17] = chars[17] === 'K' ? 'M' : 'K';
    await page.getByTestId('answer').fill(chars.join('').toLowerCase());
    await page.getByTestId('answer').press('Enter');
    await expect(page.getByTestId('result')).toContainText('23 of 25 correct (92%). Level up: added U (..-).');
    const k = (await S(page)).koch;
    expect(k.level).toBe(3);
    expect(k.drill).toMatch(/^[KMU ]+$/);
    await expect(page.getByTestId('koch-chars').locator('.chip.new')).toHaveText('U ..-');
    await expect(page.getByTestId('level')).toHaveValue('3');
    // jump ahead with the select
    await page.getByTestId('level').selectOption('5');
    await expect(page.getByTestId('koch-chars').locator('.chip')).toHaveCount(5);
    expect((await S(page)).koch.drill).toMatch(/^[KMURE ]+$/);
  });
});
