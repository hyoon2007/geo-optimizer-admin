'use strict';
/*
 * Spin KV 프록시 클라이언트.
 * 인터페이스: { kvGet(key) -> {found, value}, kvSet(key, value), kvDelete(key) }
 * - RealSpinClient: 실제 Spin `/geo/rules/kv` API 호출 (x-geo-admin-token 주입)
 * - MockSpinStore(./mockSpinStore): SPIN_USE_MOCK=true 시 in-memory 대체
 */

class SpinError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SpinError';
    this.status = status || 502;
  }
}

class RealSpinClient {
  constructor({ baseUrl, adminToken }) {
    this.baseUrl = baseUrl;
    this.adminToken = adminToken;
  }

  _url(key) {
    return `${this.baseUrl}/geo/rules/kv?key=${encodeURIComponent(key)}`;
  }

  async _fetch(key, init = {}) {
    let res;
    try {
      res = await fetch(this._url(key), {
        ...init,
        headers: {
          'x-geo-admin-token': this.adminToken,
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new SpinError(`Spin 서버에 연결할 수 없습니다: ${err.message}`, 502);
    }
    let body = null;
    try { body = await res.json(); } catch { /* 비JSON 응답 */ }
    if (!res.ok) {
      // 주의: 토큰 등 요청 헤더는 절대 에러에 포함하지 않는다.
      throw new SpinError(`Spin 응답 오류 (HTTP ${res.status})`, res.status === 401 || res.status === 403 ? 502 : res.status);
    }
    return body || {};
  }

  async kvGet(key) {
    const body = await this._fetch(key, { method: 'GET' });
    if (!body.found) return { found: false, value: null };
    let value = body.value;
    if (value === undefined && typeof body.value_text === 'string') {
      try { value = JSON.parse(body.value_text); } catch { value = body.value_text; }
    }
    return { found: true, value };
  }

  async kvSet(key, value) {
    const body = await this._fetch(key, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
    return { ok: body.ok !== false, key, bytes: body.bytes };
  }

  async kvDelete(key) {
    await this._fetch(key, { method: 'DELETE' });
    return { ok: true, key };
  }
}

function createSpinStore(config) {
  if (config.spinUseMock) {
    const { MockSpinStore } = require('./mockSpinStore');
    console.log('[spin] SPIN_USE_MOCK=true — in-memory mock KV 사용');
    return new MockSpinStore();
  }
  return new RealSpinClient({ baseUrl: config.spinBaseUrl, adminToken: config.spinAdminToken });
}

module.exports = { createSpinStore, SpinError };
