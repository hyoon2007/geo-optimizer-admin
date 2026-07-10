'use strict';
const crypto = require('crypto');

/** 세션 인증 필수 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ ok: false, error: '인증이 필요합니다.' });
}

/**
 * CSRF 방어: 세션에 저장된 토큰과 x-csrf-token 헤더 비교.
 * 로그인은 세션 성립 전이므로 제외 (SameSite=Strict 쿠키 + rate limit으로 보완).
 */
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/auth/login') return next();
  const token = req.get('x-csrf-token');
  const expected = req.session && req.session.csrfToken;
  if (!token || !expected || !timingSafeEqual(token, expected)) {
    return res.status(403).json({ ok: false, error: 'CSRF 토큰이 유효하지 않습니다.' });
  }
  next();
}

function timingSafeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function issueCsrfToken(session) {
  if (!session.csrfToken) session.csrfToken = crypto.randomBytes(24).toString('hex');
  return session.csrfToken;
}

/** 의존성 없는 간단한 in-memory rate limiter (IP 기준 슬라이딩 윈도) */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> timestamps[]
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      hits.set(ip, arr);
      return res.status(429).json({ ok: false, error: message || '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' });
    }
    arr.push(now);
    hits.set(ip, arr);
    if (hits.size > 10_000) hits.clear(); // 메모리 상한 보호
    next();
  };
}

module.exports = { requireAuth, csrfProtect, issueCsrfToken, rateLimit };
