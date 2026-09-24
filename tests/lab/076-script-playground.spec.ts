import { test, expect, Page } from '@playwright/test';

const URL = '/lab/076-script-playground.html';
const S = (page: Page) => page.evaluate(() => (window as any).__script.state);
async function setScripts(page: Page, unlock: string, lock: string) {
  await page.getByTestId('unlock').fill(unlock);
  await page.getByTestId('lock').fill(lock);
  await expect.poll(async () => (await S(page))?.tokens.join(' ')).toBe(`${unlock} ${lock}`.trim().split(/\s+/).join(' '));
}

test.describe('076 Bitcoin Script Playground', () => {
  test('SHA-256 and RIPEMD-160 match published test vectors', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('selftest')).toHaveText('self-test: 8/8 hash vectors pass');
    const h = await page.evaluate(() => {
      const s = (window as any).__script;
      return {
        e: s.sha256(''), abc: s.sha256('abc'), long: s.sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
        million: s.sha256('a'.repeat(1_000_000)),
        r0: s.ripemd160(''), rabc: s.ripemd160('abc'), rmd: s.ripemd160('message digest'), ra: s.ripemd160('a'),
        raz: s.ripemd160('abcdefghijklmnopqrstuvwxyz'), rmil: s.ripemd160('a'.repeat(1_000_000)),
        h160: s.hash160Hex('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
      };
    });
    // FIPS 180-2 appendix vectors
    expect(h.e).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(h.abc).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(h.long).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(h.million).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    // RIPEMD-160 reference vectors (Bosselaers)
    expect(h.r0).toBe('9c1185a5c5e9fc54612808977ee8f548b2258d31');
    expect(h.rabc).toBe('8eb208f7e05d987a9b044a8e98c6b087f15a0bfc');
    expect(h.rmd).toBe('5d0689ef49d2fae572b881b123a85ffa21595f36');
    expect(h.ra).toBe('0bdc9d2d256b3ee9daae347be6f4dc835a467ffe');
    expect(h.raz).toBe('f71c27109c692c1b56bbdceb5b9d2865b3708dbc');
    expect(h.rmil).toBe('52783243c1697bdbe16d37f97f68f08325dc1528');
    // HASH160 of the generator point's compressed key (BIP-173 example witness program)
    expect(h.h160).toBe('751e76e8199196d454941c45d1b3a323f1433bd6');
    // the hash lab UI shows the same digests
    await page.getByTestId('hash-input').fill('message digest');
    await expect(page.getByTestId('ripemd-out')).toHaveText('5d0689ef49d2fae572b881b123a85ffa21595f36');
    await page.getByTestId('hash-input').fill('0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
    await expect(page.getByTestId('h160-out')).toHaveText('751e76e8199196d454941c45d1b3a323f1433bd6');
  });

  test('stepping the simulated P2PKH spend: the stack evolves opcode by opcode', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('preset-p2pkh')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('sim-note')).toContainText('SIMULATED');
    const items = page.getByTestId('stack-item');
    const step = () => page.getByTestId('step').click();
    await step(); await step();
    await expect(items).toHaveCount(2);
    await expect(page.getByTestId('stack')).toContainText("Alice's pubkey (simulated)");
    const pub = await page.evaluate(() => (window as any).__script.simPub('alice'));
    await step(); // OP_DUP
    let s = await S(page);
    expect(s.stack).toEqual([s.stack[0], pub, pub]);
    await step(); // OP_HASH160
    s = await S(page);
    expect(s.stack[2]).toBe(await page.evaluate((p) => (window as any).__script.hash160Hex(p), pub));
    await expect(page.getByTestId('tape-lock').locator('.tok.pc')).toHaveText(/^<[0-9a-f]{9}…[0-9a-f]{7}>$/);
    await step(); await step(); // push hash, OP_EQUALVERIFY
    await expect(items).toHaveCount(2);
    await step(); // OP_CHECKSIG
    await expect(page.getByTestId('result')).toHaveText('✓ VALID: the spend would be accepted');
    await expect(page.getByTestId('step')).toBeDisabled();
    await expect(items).toHaveCount(1);
    await expect(page.getByTestId('log')).toContainText('OP_CHECKSIG (simulated): signature matches');
    // step back undoes the last opcode exactly
    await page.getByTestId('step-back').click();
    s = await S(page);
    expect(s.stack).toHaveLength(2);
    expect(s.status).toBe('running');
  });

  test('the wrong key fails at OP_EQUALVERIFY; a forged signature leaves false on the stack', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await page.getByTestId('preset-thief').click();
    await page.getByTestId('run').click();
    await expect(page.getByTestId('result')).toHaveText(/^✗ FAILED at step 6: OP_EQUALVERIFY failed/);
    await expect(page.getByTestId('tape-lock').locator('.tok.fail')).toHaveText('OP_EQUALVERIFY');
    // Bob's signature with Alice's pubkey passes the hash check but not the (simulated) signature check
    const lock = await page.getByTestId('lock').inputValue();
    const r = await page.evaluate((lock) => (window as any).__script.run('<sig:bob> <pub:alice>', lock), lock);
    expect(r.status).toBe('false');
    expect(r.error).toBe('script ended with false on top of the stack');
    expect(r.stack).toEqual(['']);
  });

  test('hash puzzle: only the right preimage unlocks it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await page.getByTestId('preset-puzzle').click();
    await expect(page.getByTestId('lock')).toHaveValue(`OP_SHA256 <${await page.evaluate(() => (window as any).__script.sha256('fiat lux'))}> OP_EQUAL`);
    await page.getByTestId('run').click();
    await expect(page.getByTestId('result')).toHaveText('✓ VALID: the spend would be accepted');
    await page.getByTestId('unlock').fill('"fiat lucks"');
    await expect(page.getByTestId('preset-puzzle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('result')).toHaveText('Script edited.');
    await page.getByTestId('run').click();
    await expect(page.getByTestId('result')).toHaveText('✗ INVALID: script ended with false on top of the stack');
    await page.getByTestId('unlock').fill('OP_FROBNICATE');
    await expect(page.getByTestId('parse-error')).toContainText('unknown token "OP_FROBNICATE"');
    await expect(page.getByTestId('step')).toBeDisabled();
  });

  test('IF/ELSE skips the untaken branch; numbers, arithmetic and unbalanced branches follow the rules', async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId('preset-branch').click();
    for (let i = 0; i < 4; i++) await page.getByTestId('step').click(); // sig, 0, OP_IF(false), <pub:alice> skipped
    await expect(page.getByTestId('exec')).toHaveText('Branch stack: skipping');
    await expect(page.getByTestId('tape-lock').locator('.tok.skip')).toHaveText(['<pub:alice>']);
    for (let i = 0; i < 4; i++) await page.getByTestId('step').click();
    await expect(page.getByTestId('result')).toHaveText('✓ VALID: the spend would be accepted');
    const r = await page.evaluate(() => {
      const s = (window as any).__script;
      return {
        math: s.run('7 5', 'OP_SWAP OP_SUB -2 OP_EQUALVERIFY 100 27 OP_ADD 127 OP_EQUAL'),
        neg: [s.encNum(-1), s.encNum(127), s.encNum(128), s.encNum(-128), s.encNum(255), s.decNum('ff00'), s.decNum('8000'), s.decNum('ff')],
        open: s.run('1 OP_IF', 'OP_ENDIF 1'),
        noEnd: s.run('', '1 OP_IF 2'),
        under: s.run('', 'OP_ADD'),
        verify: s.run('0', 'OP_VERIFY 1'),
        negZero: s.run('', '0x80'),
      };
    });
    expect(r.math.status).toBe('ok');
    // script-number encoding: little-endian with a sign bit, minimal
    expect(r.neg).toEqual(['81', '7f', '8000', '8080', 'ff00', 255, 128, -127]);
    expect(r.open.error).toContain('unbalanced OP_IF in the unlocking script');
    expect(r.noEnd.error).toBe('OP_IF without a matching OP_ENDIF');
    expect(r.under.error).toBe('OP_ADD needs 2 items but the stack has 0');
    expect(r.verify.error).toBe('OP_VERIFY failed: top item was false');
    expect(r.negZero.status).toBe('false'); // 0x80 is negative zero, which is false
  });
});
