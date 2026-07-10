'use strict';
/*
 * in-memory mock KV. spinClient와 동일 인터페이스라 무수정 교체 가능.
 * 프로세스 재시작 시 시드로 초기화된다 (개발/데모 전용).
 */
const { buildSeedEntries } = require('./mockSeed');

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

class MockSpinStore {
  constructor() {
    this.map = buildSeedEntries();
  }

  async kvGet(key) {
    if (!this.map.has(key)) return { found: false, value: null };
    return { found: true, value: clone(this.map.get(key)) };
  }

  async kvSet(key, value) {
    this.map.set(key, clone(value));
    return { ok: true, key, bytes: Buffer.byteLength(JSON.stringify(value)) };
  }

  async kvDelete(key) {
    this.map.delete(key);
    return { ok: true, key };
  }
}

module.exports = { MockSpinStore };
