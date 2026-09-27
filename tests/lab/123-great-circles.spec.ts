import { test, expect, Page } from '@playwright/test';

const URL = '/lab/123-great-circles.html';
const last = (page: Page) => page.evaluate(() => (window as any).__gc.last);
const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;

// Independent oracles: unit vectors instead of the haversine / atan2 forms the page uses.
type LL = { lat: number; lon: number };
const vec = (p: LL) => [Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)), Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)), Math.sin(rad(p.lat))];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
/** Central angle from atan2(|a×b|, a·b): well conditioned everywhere, unlike acos. */
const vecDist = (a: LL, b: LL) => R * Math.atan2(norm(cross(vec(a), vec(b))), dot(vec(a), vec(b)));
/** Initial bearing from the tangent of the great circle at a, projected on local north and east. */
function vecBearing(a: LL, b: LL) {
  const A = vec(a), n = cross(A, vec(b));           // normal of the great-circle plane
  const t = cross(n, A);                            // direction of travel at a
  const east = [-Math.sin(rad(a.lon)), Math.cos(rad(a.lon)), 0];
  const north = [-Math.sin(rad(a.lat)) * Math.cos(rad(a.lon)), -Math.sin(rad(a.lat)) * Math.sin(rad(a.lon)), Math.cos(rad(a.lat))];
  return (deg(Math.atan2(dot(t, east), dot(t, north))) + 360) % 360;
}
function vecMid(a: LL, b: LL) { const m = vec(a).map((x, i) => x + vec(b)[i]); return { lat: deg(Math.atan2(m[2], Math.hypot(m[0], m[1]))), lon: deg(Math.atan2(m[1], m[0])) }; }

async function setLL(page: Page, end: 'from' | 'to', lat: number, lon: number) {
  await page.getByTestId(`${end}-lat`).fill(String(lat));
  await page.getByTestId(`${end}-lon`).fill(String(lon));
}

test.describe('123 Great Circles', () => {
  test('Austin to London: about 7,900 km, with km, mi and nmi consistent', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('from')).toHaveValue('0');
    await expect(page.getByTestId('to').locator('option:checked')).toHaveText('London');
    const L = await last(page);
    // published great-circle figures for Austin–London are about 7,900 km (4,910 mi); allow for the city-centre choice
    expect(L.km).toBeGreaterThan(7870);
    expect(L.km).toBeLessThan(7940);
    expect(L.km).toBeCloseTo(vecDist({ lat: 30.27, lon: -97.74 }, { lat: 51.51, lon: -0.13 }), 6);
    expect(L.mi).toBeCloseTo(L.km / 1.609344, 9);
    expect(L.nmi).toBeCloseTo(L.km / 1.852, 9);
    await expect(page.getByTestId('dist')).toHaveText(`${Math.round(L.km).toLocaleString('en-US')} km`);
    await expect(page.getByTestId('mi')).toHaveText((L.km / 1.609344).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    await expect(page.getByTestId('nmi')).toHaveText((L.km / 1.852).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    // sets off to the north-east, arrives heading south-east-ish
    expect(Math.abs(L.bearing - vecBearing(L.a, L.b))).toBeLessThan(1e-6);
    await expect(page.getByTestId('bearing')).toHaveText(/^40\.\d° NE$/);
    expect(L.finalBearing).toBeGreaterThan(90);
    expect(L.finalBearing).toBeLessThan(140);
  });

  test('haversine against a vector oracle and published distances for other pairs', async ({ page }) => {
    await page.goto(URL);
    const cities = await page.evaluate(() => (window as any).__gc.CITIES);
    expect(cities.length).toBeGreaterThanOrEqual(30);
    const by = (n: string) => cities.find((c: any) => c.name === n);
    const d = (a: string, b: string) => page.evaluate(([a, b]) => { const g = (window as any).__gc; const f = (n: string) => g.CITIES.find((c: any) => c.name === n); return g.haversine(f(a), f(b)); }, [a, b]);
    // commonly quoted great-circle distances (± 1%)
    for (const [a, b, km] of [['New York', 'London', 5570], ['Sydney', 'London', 16990], ['Tokyo', 'Los Angeles', 8800], ['Paris', 'Rome', 1105]] as const) {
      const got = await d(a, b);
      expect(Math.abs(got - km) / km).toBeLessThan(0.01);
      expect(got).toBeCloseTo(vecDist(by(a), by(b)), 5);
    }
    // symmetric, and every coordinate is a sane rounded value
    expect(await d('Austin', 'Tokyo')).toBeCloseTo(await d('Tokyo', 'Austin'), 9);
    for (const c of cities) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
      expect(Math.round(c.lat * 100) / 100).toBe(c.lat);
    }
    expect(by('Austin')).toMatchObject({ lat: 30.27, lon: -97.74 });
  });

  test('edge cases: antipodes are πR apart with no defined bearing; the same point is 0 km', async ({ page }) => {
    await page.goto(URL);
    await setLL(page, 'from', 10, 20);
    await setLL(page, 'to', -10, -160);
    await expect(page.getByTestId('to')).toHaveValue('custom');
    let L = await last(page);
    expect(L.km).toBeCloseTo(Math.PI * 6371, 6);                          // 20,015.09 km
    await expect(page.getByTestId('dist')).toHaveText('20,015 km');
    await expect(page.getByTestId('bearing')).toHaveText('any (antipodal)');
    await expect(page.getByTestId('midpoint')).toHaveText('undefined (antipodal)');
    expect(L.antipodal).toBe(true);
    // pole to pole
    await setLL(page, 'from', 90, 0);
    await setLL(page, 'to', -90, 0);
    expect((await last(page)).km).toBeCloseTo(Math.PI * 6371, 6);
    // same point
    await setLL(page, 'from', 30.27, -97.74);
    await setLL(page, 'to', 30.27, -97.74);
    L = await last(page);
    expect(L.km).toBe(0);
    await expect(page.getByTestId('dist')).toHaveText('0 km');
    await expect(page.getByTestId('bearing')).toHaveText('— (same point)');
    await expect(page.getByTestId('rhumb-extra')).toHaveText('0 km');
    // a quarter of the equator
    await setLL(page, 'from', 0, 0);
    await setLL(page, 'to', 0, 90);
    L = await last(page);
    expect(L.km).toBeCloseTo((Math.PI / 2) * 6371, 6);
    expect(L.bearing).toBeCloseTo(90, 9);
    expect(L.rhumbKm).toBeCloseTo(L.km, 6);                              // along the equator the two coincide
    await expect(page.getByTestId('midpoint')).toHaveText('0.00° N, 45.00° E');
  });

  test('the rhumb line is never shorter than the great circle, for every pair of cities', async ({ page }) => {
    await page.goto(URL);
    const bad = await page.evaluate(() => {
      const g = (window as any).__gc, out: string[] = [];
      for (const a of g.CITIES) for (const b of g.CITIES) {
        const gc = g.haversine(a, b), rh = g.rhumb(a, b).km;
        if (rh < gc - 1e-6) out.push(`${a.name}-${b.name}`);
      }
      return { out, n: g.CITIES.length };
    });
    expect(bad.out).toEqual([]);
    expect(bad.n ** 2).toBeGreaterThan(900);
    // and for the page's own readout on a long high-latitude route, it is much longer
    await page.getByTestId('from').selectOption({ label: 'Tokyo' });
    await page.getByTestId('to').selectOption({ label: 'New York' });
    const L = await last(page);
    expect(L.rhumbKm / L.km).toBeGreaterThan(1.15);
    await expect(page.getByTestId('rhumb-extra')).toHaveText(/^[\d,]+ km \(\d+\.\d%\)$/);
    // a north–south route: the two lines are the same length
    await setLL(page, 'from', -30, 20);
    await setLL(page, 'to', 50, 20);
    const M = await last(page);
    expect(M.rhumbKm).toBeCloseTo(M.km, 6);
    expect(M.km).toBeCloseTo((80 / 360) * 2 * Math.PI * 6371, 6);
    await expect(page.getByTestId('rhumb-bearing')).toHaveText('0.0° N');
  });

  test('bearings and midpoint agree with the vector oracle for many pairs', async ({ page }) => {
    await page.goto(URL);
    const rows = await page.evaluate(() => {
      const g = (window as any).__gc, out: any[] = [];
      for (let i = 0; i < g.CITIES.length; i += 3) for (let j = 1; j < g.CITIES.length; j += 4) {
        const a = g.CITIES[i], b = g.CITIES[j]; if (a === b) continue;
        out.push({ a, b, br: g.bearing(a, b), mid: g.midpoint(a, b) });
      }
      return out;
    });
    expect(rows.length).toBeGreaterThan(60);
    for (const r of rows) {
      expect(Math.abs(((r.br - vecBearing(r.a, r.b) + 540) % 360) - 180)).toBeLessThan(1e-6);
      const m = vecMid(r.a, r.b);
      expect(r.mid.lat).toBeCloseTo(m.lat, 6);
      expect(Math.abs(((r.mid.lon - m.lon + 540) % 360) - 180)).toBeLessThan(1e-6);
    }
    // due east from the equator is 90°, and due north is 0°
    const b = await page.evaluate(() => { const g = (window as any).__gc; return [g.bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }), g.bearing({ lat: 10, lon: 5 }, { lat: 40, lon: 5 })]; });
    expect(b[0]).toBeCloseTo(90, 9);
    expect(b[1]).toBeCloseTo(0, 9);
  });

  test('Mercator: the rhumb line is straight and the great circle bows toward the pole', async ({ page }) => {
    await page.goto(URL);                                                 // Austin → London
    const L = await last(page);
    const offLine = (pts: number[][]) => {                                // max distance from the chord, in map units
      const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1], len = Math.hypot(x1 - x0, y1 - y0);
      return Math.max(...pts.map(([x, y]) => Math.abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / len));
    };
    expect(offLine(L.rhMerc)).toBeLessThan(1e-6);
    expect(offLine(L.gcMerc)).toBeGreaterThan(3);
    // on the equirectangular map the rhumb line is not straight any more
    expect(offLine(L.rhEq)).toBeGreaterThan(0.5);
    // the great circle's highest point is north of both ends (smaller y is further north)
    const topY = Math.min(...L.gcMerc.map((p: number[]) => p[1]));
    expect(topY).toBeLessThan(Math.min(L.gcMerc[0][1], L.gcMerc[L.gcMerc.length - 1][1]) - 1);
    const maxLat = Math.max(...L.gcEq.map((p: number[]) => 90 - p[1]));
    expect(maxLat).toBeGreaterThan(51.51 + 1);
    await expect(page.getByTestId('merc-gc')).toHaveAttribute('d', /^M/);
    await expect(page.getByTestId('map-merc')).toHaveAttribute('aria-label', /Mercator map, where the rhumb line is straight\. Austin to London: great circle 7,9\d\d km, setting off at 4\d°/);
  });

  test('routes across the Pacific are split at the antimeridian', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('from').selectOption({ label: 'Tokyo' });
    await page.getByTestId('to').selectOption({ label: 'Los Angeles' });
    await expect(page.getByTestId('eq-gc')).toHaveAttribute('data-segments', '2');
    await expect(page.getByTestId('merc-gc')).toHaveAttribute('data-segments', '2');
    await expect(page.getByTestId('eq-rhumb')).toHaveAttribute('data-segments', '2');
    const L = await last(page);
    expect(L.bearing).toBeGreaterThan(0);
    expect(L.bearing).toBeLessThan(90);                                    // Tokyo → LA sets off north-east
    // Austin → London does not cross it
    await page.getByTestId('from').selectOption({ label: 'Austin' });
    await page.getByTestId('to').selectOption({ label: 'London' });
    await expect(page.getByTestId('eq-gc')).toHaveAttribute('data-segments', '1');
  });

  test('swap, custom points, validation and schematic labelling', async ({ page }) => {
    await page.goto(URL);
    const before = await last(page);
    await page.getByTestId('swap').click();
    await expect(page.getByTestId('from').locator('option:checked')).toHaveText('London');
    await expect(page.getByTestId('to').locator('option:checked')).toHaveText('Austin');
    const after = await last(page);
    expect(after.km).toBeCloseTo(before.km, 9);
    // the reverse route's initial bearing is the forward route's final bearing turned round
    expect(Math.abs(((after.bearing - (before.finalBearing + 180) + 540) % 360) - 180)).toBeLessThan(1e-9);
    await page.getByTestId('to-lat').fill('95');
    await expect(page.getByTestId('error')).toContainText('latitude must be −90 to 90');
    await page.getByTestId('to-lat').fill('-33.87');
    await expect(page.getByTestId('error')).toHaveText('');
    await expect(page.getByTestId('to')).toHaveValue('custom');
    await expect(page.locator('.schem').first()).toContainText(/schematic/i);
    await expect(page.locator('.schem').nth(1)).toContainText(/schematic/i);
    // keyboard: the city selects are native and labelled
    await expect(page.getByLabel('City').first()).toBeVisible();
    await page.getByTestId('from').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('from-lat')).toBeFocused();
  });
});
