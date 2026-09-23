// Captures card thumbnails with Playwright: every lab page, plus live external demos that
// have no screenshot in images/. Run with the static server up (node scripts/serve.mjs).
import { chromium } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';

const base = process.env.BASE_URL || 'http://localhost:4173';
const only = process.argv.slice(2);

const targets = [];
for (const f of (await readdir('lab/_meta')).filter((f) => f.endsWith('.json'))) {
  const m = JSON.parse(await readFile(`lab/_meta/${f}`, 'utf8'));
  targets.push({ id: m.id, url: `${base}/${m.file}?seed=7` });
}
for (const w of JSON.parse(await readFile('data/work.json', 'utf8'))) {
  if (w.url && w.thumb?.startsWith('lab/thumbs/')) targets.push({ id: w.id, url: w.url });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
for (const t of targets.filter((t) => !only.length || only.includes(t.id))) {
  try {
    await page.goto(t.url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1500); // let intro animations settle into a representative frame
    await page.screenshot({ path: `lab/thumbs/${t.id}.jpg`, type: 'jpeg', quality: 78 });
    console.log('ok  ', t.id, t.url);
  } catch (e) {
    console.log('fail', t.id, t.url, e.message.split('\n')[0]);
  }
}
await browser.close();
