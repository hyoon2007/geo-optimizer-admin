'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./config');
const C = require('../../shared/api-contract');
const { createSpinStore, SpinError } = require('./spin/spinClient');
const { createUserStore } = require('./users/userStore');
const { requireAuth, csrfProtect, rateLimit } = require('./middleware');
const { createAuthRouter } = require('./routes/auth');
const { createDomainsRouter } = require('./routes/domains');
const { createRulesRouter } = require('./routes/rules');
const { createConfigRouter } = require('./routes/configRoute');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // HTTPS 리버스 프록시 뒤 배포 가정

app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'geo.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  // 서버측 세션 저장소: 기본 MemoryStore(단일 프로세스 개발용).
  // TODO(session): 운영 다중 인스턴스 시 connect-redis 등으로 교체.
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.nodeEnv === 'production', // 운영은 HTTPS 뒤에서 Secure
    maxAge: 8 * 60 * 60 * 1000, // 8h
  },
}));

const spin = createSpinStore(config);
const userStore = createUserStore(config);

// ---- API ----
const api = express.Router();
api.use(csrfProtect);
api.use('/auth', createAuthRouter({ userStore }));

// 인증 필수 구간 + 쓰기 rate limit
const writeLimiter = rateLimit({ windowMs: 60_000, max: 60, message: '쓰기 요청이 너무 잦습니다.' });
api.use((req, res, next) => (req.path.startsWith('/auth') || req.path === '/health' ? next() : requireAuth(req, res, next)));
api.use((req, res, next) => (['POST', 'PUT', 'DELETE'].includes(req.method) ? writeLimiter(req, res, next) : next()));

api.use('/domains', createDomainsRouter({ spin, config }));
api.use('/rules', createRulesRouter({ spin, config }));
api.use('/config', createConfigRouter());

api.get('/health', (req, res) => res.json({ ok: true, mock: config.spinUseMock }));

app.use('/api', api);

// ---- 정적 UI 서빙 (동일 오리진 → CORS 불필요) ----
app.use(express.static(config.webDir, { index: 'index.html' }));
app.use('/shared', express.static(path.join(__dirname, '..', '..', 'shared')));

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: '알 수 없는 API 경로입니다.' }));

// 에러 핸들러: 내부 정보/토큰을 응답에 노출하지 않는다.
app.use((err, req, res, _next) => {
  const status = err instanceof SpinError ? err.status : (err.status || 500);
  if (status >= 500) console.error('[error]', err.message);
  res.status(status).json({ ok: false, error: err instanceof SpinError ? err.message : (err.expose ? err.message : '서버 오류가 발생했습니다.') });
});

app.listen(config.port, () => {
  console.log(`[bff] listening on http://localhost:${config.port} (spin: ${config.spinUseMock ? 'MOCK' : config.spinBaseUrl}, env=${config.env}, channel=${config.channel})`);
  console.log(`[bff] UI: http://localhost:${config.port}/  (contract: ${Object.keys(C.API).length} endpoints)`);
});
