const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDuplicateGuard } = require('../lead-duplicates');

const temp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kepstroy-state-'));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  return { dir, filePath: path.join(dir, 'state.json') };
};

test('corrupted persisted state fails visibly rather than silently disabling protection', t => {
  const { filePath } = temp(t);
  fs.writeFileSync(filePath, '{corrupted');
  assert.throws(() => createDuplicateGuard({ filePath }), /Unable to load/);
});

test('write failure keeps an acknowledged lead protected in memory and degrades health', t => {
  const { dir, filePath } = temp(t);
  const guard = createDuplicateGuard({ filePath });
  // Deterministic on Windows and Linux: parent directory no longer exists.
  fs.rmSync(dir, { recursive: true });
  guard.record({ service: 'septiki' }, '79781234567');
  assert.ok(guard.remaining({ service: 'septiki' }, '79781234567') > 0);
  assert.equal(guard.healthy(), false);
});

test('whitespace and Unicode form normalization do not bypass deduplication', () => {
  const guard = createDuplicateGuard();
  guard.record({ service: 'septiki', message: 'Монтаж в Ялте' }, '79781234567');
  assert.ok(guard.remaining({ service: ' SEPTIKI ', message: '  Монтаж\u00a0в\u200b  Ялте ' }, '79781234567') > 0);
  assert.equal(guard.remaining({ service: 'septiki', message: 'Монтаж в Судаке' }, '79781234567'), 0);
});
