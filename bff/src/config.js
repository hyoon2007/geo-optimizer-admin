'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bool = (v, dflt) => (v === undefined ? dflt : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

const config = {
  port: Number(process.env.PORT || 8787),
  nodeEnv: process.env.NODE_ENV || 'development',
  spinBaseUrl: (process.env.SPIN_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, ''),
  spinAdminToken: process.env.SPIN_ADMIN_TOKEN || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  // Spin 미기동 시 in-memory mock KV 사용 (개발용)
  spinUseMock: bool(process.env.SPIN_USE_MOCK, false),
  env: process.env.GEO_ENV || 'prod',
  channel: process.env.GEO_CHANNEL || 'stable',
  usersFile: process.env.USERS_FILE || path.join(__dirname, '..', 'data', 'users.json'),
  webDir: path.join(__dirname, '..', '..', 'web'),
};

if (!config.sessionSecret) {
  if (config.nodeEnv === 'production') {
    console.error('[config] SESSION_SECRET이 설정되지 않았습니다. 운영 환경에서는 필수입니다.');
    process.exit(1);
  }
  // 개발 편의: 프로세스마다 임의 시크릿 (재시작 시 세션 무효화됨)
  config.sessionSecret = require('crypto').randomBytes(32).toString('hex');
  console.warn('[config] SESSION_SECRET 미설정 — 임시 시크릿 사용(개발 전용).');
}

if (!config.spinUseMock && !config.spinAdminToken) {
  console.warn('[config] SPIN_ADMIN_TOKEN이 비어 있습니다. Spin 프록시 요청이 실패할 수 있습니다.');
}

module.exports = config;
