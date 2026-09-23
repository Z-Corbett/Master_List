# Zac Corbett: Portfolio & The Lab

**Live:** https://z-corbett.github.io/Master_List/

The portfolio of a web developer, AI engineer and QA automation engineer. The site has three parts:

- **The Lab** (`lab/`): original, single-file HTML pages built with AI coding agents under my direction. Every page ships with
  - a Playwright spec (`tests/lab/*.spec.ts`), run on desktop and mobile viewports;
  - a QA write-up (methodology, risks, a candid Playwright critique) and the exact prompt, shown in the gallery;
  - zero external requests, enforced by a shared smoke suite (`tests/site/lab-smoke.spec.ts`).
- **Client work**: archived snapshots of sites I designed and built, each with a QA plan.
- **Website of the day**: a deterministic daily rotation. Everyone sees the same pick on a given day, and it cycles through the whole collection before repeating.

## Run it

```bash
npm install
npx playwright install chromium
npm run serve          # http://localhost:4173
npm test               # full suite, desktop + mobile
npm run report         # open the HTML report
```

## Add a Lab page

1. Add `lab/NNN-slug.html` (self-contained, with a `data-testid="back-link"` to `../index.html#lab`).
2. Add `lab/_meta/NNN.json` (title, category, tags, description, prompt, qa).
3. Add `tests/lab/NNN-slug.spec.ts`.
4. `npm run thumbs -- NNN && npm run build:data`, then `npm test`.

CI (`.github/workflows/playwright.yml`) runs the full suite on every push and PR. It also fails if `data/projects.js` is out of date.
