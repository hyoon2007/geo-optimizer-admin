'use strict';
/*
 * 룰 저장 전 스키마 검증 (BFF 자체 검증, ajv 기반).
 *
 * - schemas/rule.schema.json (JSON Schema 2020-12)을 기준으로 구조 검증한다.
 * - 표준 validator가 처리하지 않는 확장 규칙을 커스텀 보완한다:
 *     x-maxUtf8Bytes  → UTF-8 바이트 길이 (maxLength는 문자 수만 검사)
 *     x-runtimeConstraints → payload 바이트 예산 (kv 1MB, JSON-LD template 16KB)
 * - x-adminSelectable(신규 생성 가능 op 제한)은 UI(Phase 2)에서 처리한다.
 *
 * ※ 룰엔진(Spin) 측 validate API는 호출하지 않는다.
 * TODO(runtime-validate): 룰엔진이 dedicated validate 엔드포인트를 제공하면,
 *   저장 직전에 그 API로 런타임 검증을 추가 호출하도록 연결한다(현재 미구현이라 생략).
 *   저장(kvSet) 시 Spin이 스키마를 거부하면 그 오류는 이미 사용자에게 노출된다.
 */
const Ajv = require('ajv/dist/2020');
const schema = require('../../../schemas/rule.schema.json');

const ajv = new Ajv({ strict: false, allErrors: true });
const validateFn = ajv.compile(schema);

const utf8 = (s) => Buffer.byteLength(String(s), 'utf8');

function resolveRef(root, ref) {
  return ref.replace(/^#\//, '').split('/').reduce((o, k) => (o == null ? o : o[k]), root);
}

// x-maxUtf8Bytes: properties/items/$ref만 따라가며 문자열의 UTF-8 바이트를 검사한다.
// (모든 x-maxUtf8Bytes는 base 정의에 있으므로 조건부(allOf/oneOf/if) 탐색 없이 도달 가능)
function collectByteViolations(node, data, root, path, out) {
  if (!node || data == null) return;
  if (node.$ref) return collectByteViolations(resolveRef(root, node.$ref), data, root, path, out);
  const max = node['x-maxUtf8Bytes'];
  if (typeof max === 'number' && typeof data === 'string' && utf8(data) > max)
    out.push(`${path || '(root)'}: UTF-8 ${utf8(data)}바이트 > 허용 ${max}바이트`);
  if (node.properties && data && typeof data === 'object' && !Array.isArray(data))
    for (const [k, sub] of Object.entries(node.properties))
      if (k in data) collectByteViolations(sub, data[k], root, path ? `${path}.${k}` : k, out);
  if (node.items && Array.isArray(data))
    data.forEach((el, i) => collectByteViolations(node.items, el, root, `${path}[${i}]`, out));
}

function validateRuleSchema(rule) {
  const errors = [];
  if (!validateFn(rule))
    for (const e of validateFn.errors)
      errors.push(`${e.instancePath || '(root)'} ${e.message}`);
  collectByteViolations(schema, rule, schema, '', errors);
  const rc = schema['x-runtimeConstraints'] || {};
  if (rc.kvValueMaxBytes) {
    const b = utf8(JSON.stringify(rule));
    if (b > rc.kvValueMaxBytes) errors.push(`rule JSON ${b}바이트 > kvValueMaxBytes ${rc.kvValueMaxBytes}`);
  }
  if (rc.jsonLdTemplateMaxBytes && Array.isArray(rule.actions))
    rule.actions.forEach((a, i) => {
      if (a && a.template !== undefined) {
        const b = utf8(JSON.stringify(a.template));
        if (b > rc.jsonLdTemplateMaxBytes)
          errors.push(`actions[${i}].template ${b}바이트 > 허용 ${rc.jsonLdTemplateMaxBytes}바이트`);
      }
    });
  return errors;
}

// 폼이 보내는 null 옵셔널 필드(scope.customer:null 등)를 제거해 authoring schema에 맞춘다.
// authoring schema는 이 필드들을 "string 또는 없음"으로 정의하며 null을 허용하지 않는다.
// template은 JSON-LD 원형 보존을 위해 내부까지 건드리지 않는다.
function normalizeRule(v) {
  if (Array.isArray(v)) return v.map((x) => normalizeRule(x));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === null) continue;
      out[k] = k === 'template' ? val : normalizeRule(val);
    }
    return out;
  }
  return v;
}

module.exports = { validateRuleSchema, normalizeRule, schema };
