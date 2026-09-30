---
name: new-lab-page
description: Scaffold and ship a new numbered Lab page (lab/NNN-slug.html + lab/_meta/NNN.json + tests/lab/NNN-slug.spec.ts), then thumbs and build:data. Use when asked to add, build or create a Lab page or a batch of them.
argument-hint: "[NNN-slug] [one-line brief]"
---

# New Lab page: $ARGUMENTS

Work from `C:/Users/Z/Documents/GitHub/Master_List` (capital H). Touch only the files for your own page numbers: other agents may be adding pages in parallel.

## 1. Claim a number
- The next id is one past the highest `lab/_meta/NNN.json`, zero-padded to 3 digits. Check `ls lab/_meta` right before you create files. If a sibling agent took your number, pick the next free one; never overwrite.
- The slug is `NNN-kebab-name`. The page, spec and meta all use it.

## 2. Study a recent page first
Read one recent page, its spec and its meta that are close to your idea (e.g. `lab/172-knitting-calculator.html`, `tests/lab/172-knitting-calculator.spec.ts`, `lab/_meta/172.json`). Follow their structure and don't invent a new one.

## 3. The page: `lab/NNN-slug.html`
- One file with inline `<style>` and `<script>`. No external requests of any kind (no fonts, CDNs, analytics or remote images). `data:`/`blob:` URLs are fine.
- `<html lang="en">`, a real `<title>`, `<meta name="description" content="...">` (10+ chars), `<meta name="viewport" ...>`.
- `<a href="../index.html#lab" data-testid="back-link">` (the smoke suite clicks it).
- `data-testid` on everything the spec touches. Expose the pure logic as `window.__name = {...}` so the spec can check it against an independent oracle.
- If anything is random, seed it from `?seed=` (thumbs load `?seed=7`).
- Mobile: no horizontal scroll at 412 px, even when letter-spacing is widened by .05em. Tap targets are at least 24 px, and use `flex: none` on small controls in flex rows.
- Accessibility: native labelled controls, `aria-live` for results, visible `:focus-visible`.
- Flake-proofing (these patterns caused real CI failures here):
  - Do state changes on a `<dialog>`'s form `submit`, not its `close` event.
  - When an overlay or button hides, move focus explicitly.
  - For autosave, show a pending state until the write lands, and flush it on `pagehide`/`visibilitychange`.

## 4. The spec: `tests/lab/NNN-slug.spec.ts`
- `import { test, expect } from '@playwright/test';` with `const URL = '/lab/NNN-slug.html';` and one `test.describe('NNN Title', ...)`.
- IMPORTANT: write every test as a literal line that starts with `test('...'`. `scripts/build-data.mjs` counts tests by that regex, and CI fails if the homepage count differs from Playwright's. So: no tests generated in loops, and the only allowed conditional skip is `test.skip(isMobile, '...')`.
- Assert with web-first `expect(locator)` calls, not sleeps. Check the maths against an oracle written in the spec, not by re-using the page's code. Use `page.clock` for timers and animations.
- The spec runs on both `desktop` and `mobile` projects. Make it pass on both.

## 5. The metadata: `lab/_meta/NNN.json`
Required fields: `id` ("NNN"), `slug`, `file` ("lab/NNN-slug.html"), `title`, `category` (one of: AI & Agents, Audio, Data Viz, Games, Generative, Landing Pages, QA & Testing, Tools), `tags[]`, `description`, `prompt` (the brief as given), `qa.methodology[]`, `qa.risks[]`, `qa.playwright` (an honest critique that names anything the spec caught or missed), `qa.coverage[]`, `a11y`.

## 6. Verify (show the output, don't just claim it)
Run each from the capital-H path, one at a time, with `--workers=1`:
1. `npx playwright test tests/lab/NNN-slug.spec.ts --workers=1`
2. `npx playwright test tests/site/lab-smoke.spec.ts -g "Lab NNN " --workers=1`
3. Flake check: `npx playwright test tests/lab/NNN-slug.spec.ts --workers=1 --repeat-each=5`
4. Linux-font check for tight layouts: temporarily force `font-family: Verdana` and then `"Courier New"` (e.g. via `page.addStyleTag` in a scratch run), then check that nothing overflows or wraps badly. Don't commit the scratch change.
5. With `npm run serve` running: `npm run thumbs -- NNN`, then view `lab/thumbs/NNN.jpg` and make sure it's a representative frame.
6. `npm run build:data`. `data/projects.js` and `sitemap.xml` should change only by your page(s).

Don't run the full suite locally (it runs out of memory). CI runs it on push. Don't commit or push unless the user asks.
