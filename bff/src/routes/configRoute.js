'use strict';
const express = require('express');

/*
 * GET/POST /api/config — spin.toml 변수 관리용 스텁.
 * 실제 파일 조작은 하지 않는다 (스펙: 수도코드/스텁만).
 *
 * TODO(config): GET  — geo-optimizer 배포 파이프라인 또는 Spin 변수 API에서
 *               spin.toml 변수(geo_enable_gid, geo_request_profile,
 *               geo_dedup_text_tags 등)를 읽어 반환.
 * TODO(config): POST — 검증 후 변수 저장(배포 트리거 or 변수 스토어 반영).
 */
function createConfigRouter() {
  const router = express.Router();

  const TEMPLATE = {
    geo_enable_gid: { value: 'true', description: 'GID(GEO ID) 부여 활성화' },
    geo_request_profile: { value: 'default', description: '요청 프로파일 (default|strict|lenient)' },
    geo_dedup_text_tags: { value: 'p,li,span', description: '중복 제거 대상 텍스트 태그' },
    geo_rule_admin_token: { value: '(redacted)', description: '룰 관리 API 토큰 — 이 화면에서 노출/수정 불가' },
  };

  router.get('/', (req, res) => {
    // 수도코드:
    //   const vars = await spinVariablesClient.load();
    //   res.json({ ok:true, variables: vars });
    res.json({ ok: true, stub: true, message: '아직 스텁입니다. 실제 spin.toml 연동은 TODO(config).', variables: TEMPLATE });
  });

  router.post('/', (req, res) => {
    // 수도코드:
    //   validate(req.body); await spinVariablesClient.save(req.body);
    res.status(501).json({ ok: false, stub: true, error: 'spin.toml 설정 저장은 아직 구현되지 않았습니다. TODO(config)' });
  });

  return router;
}

module.exports = { createConfigRouter };
