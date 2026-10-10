'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * 凭据存储：明文经 Electron `safeStorage` 加密后落盘为密文条目，
 * 渲染进程仅拿到不透明 `ref`；主进程把明文推送给 sidecar（仅内存）。
 * 可注入 `safeStorage` 便于测试；加密不可用时降级 base64 并告警。
 */
function createSecretsStore({ dir, safeStorage, logger } = {}) {
  const file = path.join(dir, 'secrets.json');

  const load = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch {
      return {};
    }
  };
  const save = (data) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };
  const canEncrypt = () =>
    Boolean(
      safeStorage &&
        typeof safeStorage.isEncryptionAvailable === 'function' &&
        safeStorage.isEncryptionAvailable(),
    );

  const get = (ref) => {
    const raw = load()[ref];
    if (raw == null) return null;
    const buf = Buffer.from(raw, 'base64');
    return canEncrypt() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  };

  return {
    put(plaintext) {
      const ref = `sec_${crypto.randomBytes(9).toString('hex')}`;
      const data = load();
      data[ref] = canEncrypt()
        ? safeStorage.encryptString(plaintext).toString('base64')
        : Buffer.from(plaintext, 'utf8').toString('base64');
      save(data);
      if (!canEncrypt() && logger) {
        logger.error('[secrets] safeStorage unavailable; plaintext base64 fallback');
      }
      return ref;
    },
    get,
    remove(ref) {
      const data = load();
      delete data[ref];
      save(data);
    },
    refs() {
      return Object.keys(load());
    },
    all() {
      return Object.fromEntries(
        Object.keys(load()).map((ref) => [ref, get(ref)]),
      );
    },
  };
}

module.exports = { createSecretsStore };
