// PreToolUse hook (Bash|PowerShell): guards the two ways a local Playwright run goes wrong here.
// 1. Run from the lowercase `Github` path, Playwright loads twice and finds 0 tests: deny, with the fix.
// 2. An unscoped run with no --workers flag starts the full 2000+ test suite, which runs this machine out of memory: ask.
// Anything else exits 0 with no output, so the normal permission flow applies.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => { main(); });
function main() {
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const cmd = String(input?.tool_input?.command ?? '');
  // Only a test command in command position counts, so grep patterns and commit messages that mention one don't trip it.
  const at = cmd.search(/(?:^|[;&|(\n]\s*)(?:npx\s+playwright\s+test|playwright\s+test|npm\s+(?:run\s+)?test)(?![\w:-])/);
  if (at < 0) return;

  // The directory the tests run in: the last absolute cd / Set-Location / pushd before the test command, else the cwd.
  const before = cmd.slice(0, at + 1);
  const cds = [...before.matchAll(/(?:^|[;&|]\s*|\n\s*)(?:cd|Set-Location|sl|pushd)\s+(?:-Path\s+|-LiteralPath\s+)?(["']?)((?:[A-Za-z]:|\/)[^"';&|\n]*)\1/gi)];
  const dir = cds.length ? cds[cds.length - 1][2] : String(input?.cwd ?? '');
  const lowercasePath = dir.split(/[\\/]/).includes('Github');

  const out = (decision, reason) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
    }));
  };

  if (lowercasePath) {
    return out('deny', 'Playwright finds 0 tests from the lowercase "Github" path (it loads twice). Re-run with: cd "C:/Users/Z/Documents/GitHub/Master_List" && <same command>');
  }
  if (/--list\b/.test(cmd)) return;
  const scoped = /(tests[\\/]|\.spec\.ts\b|\s-g\s|--grep\b|--last-failed\b|--shard\b|--only-changed\b)/.test(cmd);
  if (!scoped && !/--workers\b|\s-j\s/.test(cmd)) {
    return out('ask', 'This starts the full Playwright suite (2000+ tests, ~27 min), which runs this machine out of memory. Prefer the touched specs with --workers=1 and leave the full suite to CI. Approve only if the user asked for a full local run.');
  }
  return;
}
