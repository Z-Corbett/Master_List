---
name: fix-flaky-test
description: Root-cause and fix a flaky or CI-only Playwright failure in this repo (failOnFlakyTests is on, so a pass-on-retry fails the deploy). Use when CI reports "N flaky", a test fails only in CI, or a test passes and fails intermittently.
argument-hint: "[spec path, test name, or CI run id]"
---

# Fix a flaky test: $ARGUMENTS

A flake here is a bug, usually in the page, not the test. Don't add retries, longer timeouts, `waitForTimeout` or `test.skip`. They hide the bug, and the site sells QA rigour.

## 1. Get the facts
- CI: `gh run list --limit 5`, then `gh run view <id> --log-failed`. For flakes, search the full log (`gh run view <id> --log`) for "flaky" and the test names listed under it. Note the project (desktop or mobile) and the shard.
- Download the trace if one exists (`gh run download <id>`, `playwright-report-N`). CI records a trace on first retry.
- Work from `C:/Users/Z/Documents/GitHub/Master_List` (capital H).

## 2. Reproduce locally
- `npx playwright test <spec> --workers=1 --repeat-each=20` (add `--project=mobile` or `--project=desktop` if the flake is on one project).
- If it only fails in CI, suspect fonts first. CI is Linux, with wider glyphs. Force `font-family: Verdana` and then `"Courier New"` in a scratch run and re-check widths, wraps, overflow and 24 px tap targets.
- Mild CPU contention also helps: use `--workers=2` with `--repeat-each`, but don't go above 2 on this machine.

## 3. Check the known causes (all real, all fixed in the page)
1. **Dialog `close` event.** State changed in a `<dialog>`'s `close` handler, which fires as a later task, so the test races it. Fix: do the work in the form's `submit` handler.
2. **Focus on a hidden element.** Focus stayed on a button that was just hidden. Chrome fixes focus up later, so keystrokes go to the wrong place. Fix: move focus explicitly when the overlay or button hides.
3. **Debounced save race.** The UI said "Saved" while a write was still pending, so a quick reload lost the edit. Fix: show a pending state until the write lands, and flush on `pagehide`/`visibilitychange`.
4. **Linux font widths.** Layout, wrapping or tap-target size differs under wider fonts. Fix with layout (`flex: none`, `min-width`, wrapping), or make the assertion tolerate one-character or one-line font differences when the page measures text itself.
5. **Test-side races.** Non-web-first assertions (`expect(await x.textContent())`), `waitForTimeout`, timers without `page.clock`, or animations. Fix: use `await expect(locator).toHaveText(...)`, `page.clock`, and wait for the state change the user would see.

`lab/162-*.html` and `lab/_meta/162.json` (the Flaky Test Rescue case study) document causes 1-3 with the real diffs.

## 4. Fix and prove it
- Fix the root cause in the page (or the test, if the test is wrong). Add a regression test that would have caught it, written as a literal `test('...'` line (build-data counts tests by regex).
- Prove it: `--repeat-each=20` with `--workers=1` passes 100%. Report the count (e.g. "180/180").
- If the spec's test count changed, run `npm run build:data`.
- If the lesson is new, add one line to the flake list in `CLAUDE.md` and to this skill.
