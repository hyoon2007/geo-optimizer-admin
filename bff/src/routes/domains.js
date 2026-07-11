'use strict';
const express = require('express');
const C = require('../../../shared/api-contract');

function createDomainsRouter({ spin, config }) {
  const router = express.Router();

  // GET /api/domains — Spin 도메인 레지스트리 → {default, domains:[...]}
  router.get('/', async (req, res, next) => {
    try {
      const { found, value } = await spin.kvGet(C.KV.registry(config.env));
      if (!found) return res.json({ ok: true, found: false, default: null, domains: [] });
      const customers = Array.isArray(value.customers) ? value.customers : [];
      res.json({
        ok: true,
        found: true,
        default: value.default ?? null,
        domains: customers.map((c) => ({
          id: c.id, name: c.name,
          host_patterns: c.host_patterns || [],
          page_types: c.page_types || [],
        })),
      });
    } catch (err) { next(err); }
  });

  // POST /api/domains — 레지스트리 전체 저장 (추가/수정/삭제 포함). 서버측 재검증.
  router.post('/', async (req, res, next) => {
    try {
      const body = req.body || {};
      const registry = {
        schema_version: body.schema_version || '1.0',
        default: body.default,
        customers: body.customers || body.domains, // web은 domains 명칭 사용 가능
      };
      // ?only=<id> 편집/추가 대상 도메인만 내용 검증, ?only=none 이면 내용 검증 생략(삭제/기본값 변경).
      // 미지정 시 전체 검증(하위호환). 구조 검증(id/중복/개수/default)은 항상 수행.
      const only = req.query.only;
      const onlyDomain = only === undefined ? undefined : (only === 'none' ? null : only);
      const errors = C.validateRegistry(registry, { onlyDomain });
      if (errors.length) return res.status(400).json({ ok: false, errors });
      const result = await spin.kvSet(C.KV.registry(config.env), registry);
      res.json({ ok: true, key: result.key, bytes: result.bytes });
    } catch (err) { next(err); }
  });

  // :id === GLOBAL_ID('__global__') 이면 글로벌 page-type config 키로 매핑
  const pageTypeKey = (id) => C.KV.pageType(id === C.GLOBAL_ID ? null : id, config.env);

  // GET /api/domains/:id/page-types
  router.get('/:id/page-types', async (req, res, next) => {
    try {
      const id = req.params.id;
      const { found, value } = await spin.kvGet(pageTypeKey(id));
      if (found) return res.json({ ok: true, found: true, config: value });
      // 미존재 시 편집 시작용 기본 골격 제공
      res.json({
        ok: true, found: false,
        config: {
          schema_version: '1.0',
          customer: id === C.GLOBAL_ID ? null : id,
          version: 1, enabled: true, fallback: 'unknown',
          hot_path_rules: [],
        },
      });
    } catch (err) { next(err); }
  });

  // POST /api/domains/:id/page-types — 서버측 재검증 후 저장
  router.post('/:id/page-types', async (req, res, next) => {
    try {
      const id = req.params.id;
      const cfg = req.body || {};
      const errors = C.validatePageTypeConfig(cfg);
      if (id !== C.GLOBAL_ID && cfg.customer !== id) {
        errors.push(`config.customer("${cfg.customer}")가 경로의 도메인 id("${id}")와 다릅니다.`);
      }
      if (errors.length) return res.status(400).json({ ok: false, errors });
      const result = await spin.kvSet(pageTypeKey(id), cfg);
      res.json({ ok: true, key: result.key, bytes: result.bytes });
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createDomainsRouter };
