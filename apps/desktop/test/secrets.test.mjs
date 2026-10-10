import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSecretsStore } = require('../src/secrets.cjs');

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`ENC:${s}`, 'utf8'),
    decryptString: (buf) => buf.toString('utf8').slice(4),
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fireeyeaud-secrets-'));
}

test('put/get/remove round-trip', () => {
  const dir = tmpDir();
  const store = createSecretsStore({ dir, safeStorage: fakeSafeStorage(), logger: silent() });
  const ref = store.put('p@ssw0rd');
  assert.match(ref, /^sec_[0-9a-f]+$/);
  assert.equal(store.get(ref), 'p@ssw0rd');
  assert.deepEqual(store.refs(), [ref]);
  assert.deepEqual(store.all(), { [ref]: 'p@ssw0rd' });
  store.remove(ref);
  assert.equal(store.get(ref), null);
  assert.deepEqual(store.refs(), []);
});

test('persists ciphertext (not plaintext) to disk', () => {
  const dir = tmpDir();
  const store = createSecretsStore({ dir, safeStorage: fakeSafeStorage(), logger: silent() });
  const ref = store.put('top-secret');
  const onDisk = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.ok(!onDisk.includes('top-secret'));
  assert.ok(!onDisk.includes('ENC:'));

  const reloaded = createSecretsStore({ dir, safeStorage: fakeSafeStorage(), logger: silent() });
  assert.equal(reloaded.get(ref), 'top-secret');
});

test('falls back to base64 when safeStorage unavailable', () => {
  const dir = tmpDir();
  const errors = [];
  const store = createSecretsStore({
    dir,
    safeStorage: { isEncryptionAvailable: () => false },
    logger: { info() {}, error: (m) => errors.push(m) },
  });
  const ref = store.put('abc');
  assert.equal(store.get(ref), 'abc');
  assert.equal(errors.length, 1);
});

function silent() {
  return { info() {}, error() {} };
}
