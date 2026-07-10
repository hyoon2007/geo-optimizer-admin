'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { issueCsrfToken, rateLimit } = require('../middleware');

// 존재하지 않는 사용자에 대해서도 동일한 시간이 걸리도록 하는 더미 해시
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function createAuthRouter({ userStore }) {
  const router = express.Router();

  const loginLimiter = rateLimit({ windowMs: 5 * 60_000, max: 10, message: '로그인 시도가 너무 잦습니다. 5분 후 다시 시도하세요.' });

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        return res.status(400).json({ ok: false, error: '사용자명과 비밀번호를 입력하세요.' });
      }
      const user = await userStore.findByUsername(username);
      const hash = user ? user.passwordHash : DUMMY_HASH;
      const match = await bcrypt.compare(password, hash);
      if (!user || !match) {
        return res.status(401).json({ ok: false, error: '사용자명 또는 비밀번호가 올바르지 않습니다.' });
      }
      // 세션 고정 공격 방지: 로그인 성공 시 세션 재생성
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { username: user.username, roles: user.roles || [] };
        const csrfToken = issueCsrfToken(req.session);
        res.json({ ok: true, user: { username: user.username, roles: user.roles || [] }, csrfToken });
      });
    } catch (err) { next(err); }
  });

  router.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('geo.sid');
      res.json({ ok: true });
    });
  });

  router.get('/me', (req, res) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ ok: false, authenticated: false });
    }
    res.json({ ok: true, authenticated: true, user: req.session.user, csrfToken: issueCsrfToken(req.session) });
  });

  return router;
}

module.exports = { createAuthRouter };
