# Master_List: portfolio + The Lab

Static site, no build step, deployed to GitHub Pages. `index.html` is the portfolio. `lab/NNN-slug.html` holds 170+ self-contained Lab pages. Client-site snapshots sit in the domain-named folders (`nss1.org/`, `cmcrealty.com/`, ...).

## Commands
IMPORTANT: run Playwright from `C:/Users/Z/Documents/GitHub/Master_List`, with a capital H. The lowercase `Github` path loads Playwright twice, and it finds 0 tests ("did not expect test.describe()"). Start with `cd "C:/Users/Z/Documents/GitHub/Master_List" && ...`.

- `npm run serve`: static server at http://localhost:4173 (Playwright starts it automatically).
- `npx playwright test tests/lab/NNN-slug.spec.ts --workers=1`: one page's spec (desktop and mobile).
- `npx playwright test tests/site/lab-smoke.spec.ts -g "Lab NNN " --workers=1`: shared smoke checks for one page.
- `npx playwright test --list`: test count without running anything.
- `npm run thumbs -- NNN`: screenshot `lab/thumbs/NNN.jpg`. The server must already be running.
- `npm run build:data`: regenerates `data/projects.js` and `sitemap.xml` from `data/work.json` and `lab/_meta/*.json`. Never hand-edit the generated files.

## Local limits
- This machine runs out of memory on big runs. Always pass `--workers=1`, run only the specs you touched, and use 5 or fewer parallel agents.
- Leave the full suite (2000+ tests, ~27 min) to CI. It shards it 4 ways.

## Lab page contract
- One self-contained HTML file with inline CSS and JS. No external requests (not even fonts or CDNs); the smoke suite fails on any.
- Needs `<html lang="en">`, a `<title>`, a `meta name="description"`, and `<a href="../index.html#lab" data-testid="back-link">`.
- No horizontal scroll at Pixel 7 width, including when letter-spacing is widened.
- Use `data-testid` hooks, and a `window.__name` object that exposes the pure logic for specs to check against an independent oracle.
- Honour `?seed=` for anything random (thumbs use `?seed=7`), so screenshots and tests are deterministic.
- Metadata goes in `lab/_meta/NNN.json` (id, slug, file, title, category, tags, description, prompt, qa{methodology, risks, playwright, coverage}, a11y). `build:data` throws if a field is missing.
- Numbering is sequential. The next batch starts after the highest `lab/_meta/NNN.json`. Other agents may be adding pages at the same time, so claim your numbers first and don't touch pages you didn't create.

## Spec rules (CI enforces these)
- `build-data.mjs` counts tests by regex. Only a line that begins with `test('...` counts, and a skip counts only as `test.skip(isMobile, ...)`. Tests generated in a loop, or other skip forms, make the homepage count wrong, and the CI `checks` job fails. Write each `test(` out literally.
- CI sets `failOnFlakyTests`, so a test that passes only on retry still fails the deploy. Treat a flake as a real bug in the page. See the `fix-flaky-test` skill.
- CI runs on Linux, whose fonts are wider than Windows fonts. Before calling layout done, check tight rows, tap targets (24 px minimum) and text measure with `font-family: Verdana` and then `"Courier New"` forced.

## Known flake causes (all were page bugs)
1. State changed from a `<dialog>` `close` event, which fires as a later task. Do the work in the form's `submit` handler instead.
2. Focus left on a button that was just hidden. Move focus explicitly when an overlay hides.
3. Debounced autosave showed "Saved" before the write landed. Show pending status and flush on `pagehide`/`visibilitychange`.

## Verify before you say "done"
1. Run the page's spec and its smoke tests with `--workers=1`, from the capital-H path. Both must pass on desktop and mobile.
2. For a new or changed spec, prove it isn't flaky with `--repeat-each=5` (or 10).
3. Run `npm run build:data`, then `git status` to check that `data/projects.js` and `sitemap.xml` changed only as expected. CI fails if either one is stale.
4. Show the evidence (the command and its pass counts), not just a claim.

## Git
- Pushing to `master` deploys the live site. Never push without the user's explicit OK. Never force-push.
- Commit only when asked. Keep a batch to one commit that lists its pages.
