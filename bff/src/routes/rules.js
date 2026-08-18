'use strict';
const express = require('express');
const C = require('../../../shared/api-contract');

function createRulesRouter({ spin, config }) {
  const router = express.Router();

  const manifestKeyFromQuery = (q) => {
    const pageType = q.page_type || null;
    if (q.scope === 'global') return C.KV.manifest(C.KV.manifestScope({ pageType }), config.env, config.channel);
    if (q.domain) return C.KV.manifest(C.KV.manifestScope({ customer: q.domain, pageType }), config.env, config.channel);
    return null;
  };

  // 쿼리(domain/page_type)에서 스코프 객체 도출 (GLOBAL_ID/미지정 → customer null)
  const scopeFromQuery = (q) => ({
    customer: q.domain && q.domain !== C.GLOBAL_ID ? q.domain : null,
    pageType: q.page_type || null,
  });

  // 해당 스코프 매니페스트에 {rule_id, version} 포인터를 upsert (없으면 새로 생성). manifest.version은 +1.
  async function attachToManifest({ ruleId, version, scopeObj }) {
    const mKey = C.KV.manifest(C.KV.manifestScope(scopeObj), config.env, config.channel);
    const { found, value } = await spin.kvGet(mKey);
    const manifest = found ? value : {
      schema_version: '1.0',
      manifest_id: C.KV.manifestScope(scopeObj).replace(/\//g, ':'),
      env: config.env, channel: config.channel,
      scope: { tenant: 'default', customer: scopeObj.customer, page_type: scopeObj.pageType },
      version: 0, rules: [],
    };
    const rules = Array.isArray(manifest.rules) ? manifest.rules : [];
    const idx = rules.findIndex((p) => p.rule_id === ruleId);
    if (idx >= 0) rules[idx] = { rule_id: ruleId, version };
    else rules.push({ rule_id: ruleId, version });
    manifest.rules = rules;
    manifest.version = (manifest.version || 0) + 1;
    await spin.kvSet(mKey, manifest);
    return { manifest_key: mKey, manifest_version: manifest.version };
  }

  // 해당 스코프 매니페스트에서 rule_id 포인터를 제거(detach). 룰 문서 자체는 보존한다.
  async function detachFromManifest({ ruleId, scopeObj }) {
    const mKey = C.KV.manifest(C.KV.manifestScope(scopeObj), config.env, config.channel);
    const { found, value } = await spin.kvGet(mKey);
    if (!found) return { found: false, removed: false, manifest_key: mKey };
    const rules = Array.isArray(value.rules) ? value.rules : [];
    const next = rules.filter((p) => p.rule_id !== ruleId);
    const removed = next.length !== rules.length;
    if (removed) {
      value.rules = next;
      value.version = (value.version || 0) + 1;
      await spin.kvSet(mKey, value);
    }
    return { found: true, removed, manifest_key: mKey, manifest_version: value.version };
  }

  // GET /api/rules?scope=global | ?domain=:id[&page_type=pt]
  // 매니페스트를 읽고 rule 포인터를 fan-out 조회해 룰 배열로 집계한다.
  router.get('/', async (req, res, next) => {
    try {
      const key = manifestKeyFromQuery(req.query);
      if (!key) return res.status(400).json({ ok: false, error: 'scope=global 또는 domain=:id 파라미터가 필요합니다.' });
      const { found, value: manifest } = await spin.kvGet(key);
      if (!found) return res.json({ ok: true, manifest: null, rules: [] });

      const pointers = Array.isArray(manifest.rules) ? manifest.rules : [];
      const results = await Promise.all(pointers.map(async (p) => {
        try {
          const { found: rFound, value } = await spin.kvGet(C.KV.rule(p.rule_id, p.version));
          return { rule_id: p.rule_id, version: p.version, found: rFound, rule: rFound ? value : null };
        } catch (err) {
          return { rule_id: p.rule_id, version: p.version, found: false, rule: null, error: err.message };
        }
      }));
      res.json({ ok: true, manifest, rules: results });
    } catch (err) { next(err); }
  });

  // GET /api/rules/:rule_id?version=n
  router.get('/:rule_id', async (req, res, next) => {
    try {
      const version = parseInt(req.query.version, 10) || 1;
      const { found, value } = await spin.kvGet(C.KV.rule(req.params.rule_id, version));
      res.json({ ok: true, found, rule: found ? value : null });
    } catch (err) { next(err); }
  });

  // POST /api/rules/:rule_id?version=n[&attach=1&domain=:id&page_type=pt]
  // body = 룰 JSON. 필수값/priority/actions 서버측 재검증 후 저장.
  // attach=1 이면 해당 스코프 매니페스트에 {rule_id, version} 포인터를 upsert한다
  // (스펙 확장: 새 룰이 목록 fan-out에 바로 잡히도록).
  router.post('/:rule_id', async (req, res, next) => {
    try {
      const rule = req.body || {};
      const version = parseInt(req.query.version, 10) || rule.version || 1;
      const errors = C.validateRule(rule);
      if (rule.rule_id !== req.params.rule_id)
        errors.push(`body.rule_id("${rule.rule_id}")가 경로의 rule_id("${req.params.rule_id}")와 다릅니다.`);
      if (errors.length) return res.status(400).json({ ok: false, errors });

      rule.version = version;
      const result = await spin.kvSet(C.KV.rule(rule.rule_id, version), rule);

      let attached = null;
      if (req.query.attach === '1') {
        attached = await attachToManifest({ ruleId: rule.rule_id, version, scopeObj: scopeFromQuery(req.query) });
      }

      res.json({ ok: true, key: result.key, bytes: result.bytes, version, attached });
    } catch (err) { next(err); }
  });

  // GET /api/rules/:rule_id/versions → 존재하는 버전 목록 (1..N, 첫 공백에서 중단, 최대 50)
  router.get('/:rule_id/versions', async (req, res, next) => {
    try {
      const ruleId = req.params.rule_id;
      const versions = [];
      for (let n = 1; n <= 50; n++) {
        const { found, value } = await spin.kvGet(C.KV.rule(ruleId, n));
        if (!found) break;
        versions.push({ version: n, name: value && value.name, status: value && value.status, type: value && value.type, enabled: !(value && value.enabled === false) });
      }
      res.json({ ok: true, versions });
    } catch (err) { next(err); }
  });

  // POST /api/rules/:rule_id/activate?domain=&page_type=  body {version}
  // 룰 본문은 그대로 두고, 해당 스코프 매니페스트 포인터만 지정 버전으로 전환 (원클릭 롤백/승격).
  router.post('/:rule_id/activate', async (req, res, next) => {
    try {
      const ruleId = req.params.rule_id;
      const version = parseInt(req.body && req.body.version, 10);
      if (!Number.isInteger(version) || version < 1)
        return res.status(400).json({ ok: false, error: 'version은 1 이상의 정수여야 합니다.' });
      const { found } = await spin.kvGet(C.KV.rule(ruleId, version));
      if (!found) return res.status(404).json({ ok: false, error: `룰 "${ruleId}"의 버전 ${version}이 존재하지 않습니다.` });
      const attached = await attachToManifest({ ruleId, version, scopeObj: scopeFromQuery(req.query) });
      res.json({ ok: true, version, ...attached });
    } catch (err) { next(err); }
  });

  // DELETE /api/rules/:rule_id?domain=&page_type=
  // 해당 스코프 매니페스트에서 룰 포인터만 제거(detach). 룰 문서는 보존되어 다른 스코프/버전에서 계속 사용 가능.
  router.delete('/:rule_id', async (req, res, next) => {
    try {
      const result = await detachFromManifest({ ruleId: req.params.rule_id, scopeObj: scopeFromQuery(req.query) });
      if (!result.found) return res.status(404).json({ ok: false, error: '해당 스코프의 매니페스트가 없습니다.' });
      if (!result.removed) return res.status(404).json({ ok: false, error: '이 스코프 매니페스트에 해당 룰이 없습니다.' });
      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createRulesRouter };
