/*
 * shared/api-contract.js
 * web(web/index.html)과 BFF(bff/)가 공유하는 "단일" API 계약 정의.
 *
 * - BFF는 이 파일을 require 해서 사용한다.
 * - web/index.html은 빌드 없이 단일 파일로 동작해야 하므로,
 *   아래 BEGIN/END 마커 사이의 블록이 index.html에 그대로 인라인되어 있다.
 * - 동기화 검증: `cd bff && npm run check:contract`
 */
/* ===== GEO ADMIN SHARED CONTRACT BEGIN ===== */
const GeoContract = (() => {
  'use strict';

  // ---- HTTP API 경로 (BFF가 노출, web이 호출) ----
  const API = {
    AUTH_LOGIN: '/api/auth/login',
    AUTH_LOGOUT: '/api/auth/logout',
    AUTH_ME: '/api/auth/me',
    DOMAINS: '/api/domains',
    DOMAIN_PAGE_TYPES: (id) => `/api/domains/${encodeURIComponent(id)}/page-types`,
    RULES: '/api/rules',
    RULE: (ruleId) => `/api/rules/${encodeURIComponent(ruleId)}`,
    CONFIG: '/api/config',
    HEALTH: '/api/health',
  };

  // UI의 "공통(Global)" 선택을 나타내는 예약 id. 도메인 id로는 사용 금지.
  const GLOBAL_ID = '__global__';

  const DEFAULT_ENV = 'prod';
  const DEFAULT_CHANNEL = 'stable';

  // ---- Spin KV 키 스킴 (KV 경로 세그먼트는 하위호환상 customer/{id}) ----
  const KV = {
    registry: (env = DEFAULT_ENV) => `rules/v1/index/${env}/customers`,
    manifestScope: ({ customer, pageType }) => {
      if (customer && pageType) return `customer/${customer}/page_type/${pageType}`;
      if (customer) return `customer/${customer}`;
      if (pageType) return `page_type/${pageType}`;
      return 'global';
    },
    manifest: (scope, env = DEFAULT_ENV, channel = DEFAULT_CHANNEL) =>
      `rules/v1/manifest/${env}/${channel}/${scope}`,
    rule: (ruleId, version) => `rules/v1/rule/${ruleId}/version/${version}`,
    pageType: (customerId, env = DEFAULT_ENV) =>
      `rules/v1/page-type/${env}/${customerId ? `customer/${customerId}` : 'global'}`,
  };

  // ---- 도메인 열거값 ----
  const RULE_TYPES = [
    'selector_remove', 'attribute_filter', 'text_token_remove', 'text_phrase_remove',
    'container_hint_remove', 'role_policy', 'div_policy', 'image_policy',
    'json_ld_policy', 'link_density_prune', 'dedup_policy', 'mode_policy',
  ];

  const RULE_STATUSES = ['draft', 'published', 'deprecated', 'archived'];

  const ACTION_OPS = [
    'remove_element', 'flatten_element', 'remove_attribute', 'keep_attribute',
    'remove_text_token', 'remove_text_phrase', 'protect_element', 'promote_tag',
    'inject_json_ld', 'prune_by_link_density',
  ];

  // page_type은 고정 허용값(allowlist)을 두지 않는다 — 자유 입력. 비어있지 않은 문자열이면 되고,
  // "중복 정의"만 검증에서 막는다. UI 자동완성 후보는 KV에 저장된 값에서 동적으로 채운다.

  const SCOPE_LEVELS = ['global', 'customer', 'page_type', 'customer_page_type'];

  // ---- 최적화 룰 카테고리 (RuleType → UI 그룹핑) ----
  const RULE_CATEGORIES = [
    { id: 'structure', label: '구조 제거',
      description: '헤더/GNB/광고 컨테이너 등 HTML 구조 요소를 선택자·휴리스틱으로 제거하거나 평탄화합니다.',
      types: ['selector_remove', 'container_hint_remove', 'div_policy', 'role_policy'] },
    { id: 'attributes', label: '속성 정제',
      description: '불필요한 HTML 속성을 제거하거나 허용 목록만 유지합니다.',
      types: ['attribute_filter'] },
    { id: 'text', label: '텍스트 정제',
      description: '노이즈 토큰·문구(광고 문구 등)를 텍스트에서 제거합니다.',
      types: ['text_token_remove', 'text_phrase_remove'] },
    { id: 'media', label: '이미지/미디어',
      description: '이미지·미디어 요소의 유지/제거/속성 처리 정책을 정의합니다.',
      types: ['image_policy'] },
    { id: 'semantic', label: '시맨틱/구조화 데이터',
      description: 'JSON-LD 등 구조화 데이터를 보존·주입해 AI 검색(GEO/AEO) 인용 가능성을 높입니다.',
      types: ['json_ld_policy'] },
    { id: 'dedup', label: '중복 제거',
      description: '반복되는 블록·텍스트를 중복 제거합니다.',
      types: ['dedup_policy'] },
    { id: 'link-density', label: '링크 밀도',
      description: '링크 밀도가 높은 내비게이션성 블록을 가지치기합니다.',
      types: ['link_density_prune'] },
    { id: 'mode', label: '모드 정책',
      description: '요청 프로파일/모드별 전체 최적화 동작을 제어합니다.',
      types: ['mode_policy'] },
  ];

  // ---- 검증 한계값 (클라이언트/BFF 동일 적용) ----
  const LIMITS = {
    CUSTOMERS_MIN: 1,
    CUSTOMERS_MAX: 256,
    HOST_PATTERNS_MAX: 32,
    HOST_PATTERN_MAX_BYTES: 253,
    PRIORITY_MIN: 0,
    PRIORITY_MAX: 10000,
    ACTIONS_MAX: 16,
    RULE_ID_MAX_BYTES: 96,
    RULE_NAME_MAX_BYTES: 160,
    SELECTOR_MAX_BYTES: 512,
  };

  const DOMAIN_ID_RE = /^[a-z0-9\-_.]+$/;
  const HOST_PATTERN_RE = /^[a-z0-9\-.*]+$/;
  const RULE_ID_RE = /^[a-zA-Z0-9\-_.]+$/;

  const byteLength = (s) => new TextEncoder().encode(String(s)).length;

  // ---- 검증기: 실패 사유 문자열 배열 반환 (빈 배열이면 통과) ----

  function validateHostPattern(p) {
    if (typeof p !== 'string' || p.length === 0) return 'host 패턴이 비어 있습니다.';
    if (byteLength(p) > LIMITS.HOST_PATTERN_MAX_BYTES)
      return `host 패턴 "${p}"이 ${LIMITS.HOST_PATTERN_MAX_BYTES}바이트를 초과합니다.`;
    if (!HOST_PATTERN_RE.test(p))
      return `host 패턴 "${p}"에 허용되지 않는 문자가 있습니다. (허용: a-z 0-9 - . *)`;
    return null;
  }

  function validateRegistry(reg) {
    const errors = [];
    if (!reg || typeof reg !== 'object') return ['레지스트리가 객체가 아닙니다.'];
    const customers = reg.customers;
    if (!Array.isArray(customers)) return ['customers가 배열이 아닙니다.'];
    if (customers.length < LIMITS.CUSTOMERS_MIN || customers.length > LIMITS.CUSTOMERS_MAX)
      errors.push(`customers는 ${LIMITS.CUSTOMERS_MIN}~${LIMITS.CUSTOMERS_MAX}개여야 합니다. (현재 ${customers.length})`);
    const seen = new Set();
    for (const c of customers) {
      if (!c || typeof c !== 'object') { errors.push('customers 항목이 객체가 아닙니다.'); continue; }
      const id = c.id;
      if (typeof id !== 'string' || !DOMAIN_ID_RE.test(id))
        errors.push(`도메인 id "${id}"가 유효하지 않습니다. (허용: a-z 0-9 - _ .)`);
      else if (id === GLOBAL_ID)
        errors.push(`"${GLOBAL_ID}"는 예약된 id입니다.`);
      else if (seen.has(id))
        errors.push(`도메인 id "${id}"가 중복되었습니다.`);
      seen.add(id);
      if (typeof c.name !== 'string' || c.name.trim().length === 0)
        errors.push(`도메인 "${id}"의 name이 비어 있습니다.`);
      const hp = c.host_patterns;
      if (!Array.isArray(hp) || hp.length === 0)
        errors.push(`도메인 "${id}"의 host_patterns가 비어 있습니다.`);
      else {
        if (hp.length > LIMITS.HOST_PATTERNS_MAX)
          errors.push(`도메인 "${id}"의 host_patterns는 최대 ${LIMITS.HOST_PATTERNS_MAX}개입니다.`);
        for (const p of hp) {
          const e = validateHostPattern(p);
          if (e) errors.push(`도메인 "${id}": ${e}`);
        }
      }
      if (c.page_types !== undefined) {
        if (!Array.isArray(c.page_types)) errors.push(`도메인 "${id}"의 page_types가 배열이 아닙니다.`);
        else {
          const seenPt = new Set();
          for (const pt of c.page_types) {
            if (typeof pt !== 'string' || pt.trim().length === 0) errors.push(`도메인 "${id}"의 page_type이 비어 있습니다.`);
            else if (seenPt.has(pt)) errors.push(`도메인 "${id}"의 page_type "${pt}"가 중복되었습니다.`);
            else seenPt.add(pt);
          }
        }
      }
    }
    if (customers.length > 0) {
      if (typeof reg.default !== 'string' || !seen.has(reg.default))
        errors.push(`default("${reg.default}")가 customers에 존재하지 않습니다.`);
    }
    return errors;
  }

  function validateRule(rule) {
    const errors = [];
    if (!rule || typeof rule !== 'object') return ['룰이 객체가 아닙니다.'];
    if (typeof rule.rule_id !== 'string' || rule.rule_id.length === 0)
      errors.push('rule_id는 필수입니다.');
    else {
      if (!RULE_ID_RE.test(rule.rule_id)) errors.push('rule_id에 허용되지 않는 문자가 있습니다. (허용: 영숫자 - _ .)');
      if (byteLength(rule.rule_id) > LIMITS.RULE_ID_MAX_BYTES)
        errors.push(`rule_id는 최대 ${LIMITS.RULE_ID_MAX_BYTES}바이트입니다.`);
    }
    if (typeof rule.name !== 'string' || rule.name.trim().length === 0)
      errors.push('name은 필수입니다.');
    else if (byteLength(rule.name) > LIMITS.RULE_NAME_MAX_BYTES)
      errors.push(`name은 최대 ${LIMITS.RULE_NAME_MAX_BYTES}바이트입니다.`);
    if (!RULE_TYPES.includes(rule.type))
      errors.push(`type("${rule.type}")은 12개 RuleType 중 하나여야 합니다.`);
    if (!Number.isInteger(rule.priority) || rule.priority < LIMITS.PRIORITY_MIN || rule.priority > LIMITS.PRIORITY_MAX)
      errors.push(`priority는 ${LIMITS.PRIORITY_MIN}~${LIMITS.PRIORITY_MAX} 정수여야 합니다.`);
    if (rule.version !== undefined && (!Number.isInteger(rule.version) || rule.version < 1))
      errors.push('version은 1 이상의 정수여야 합니다.');
    if (rule.status !== undefined && !RULE_STATUSES.includes(rule.status))
      errors.push(`status("${rule.status}")는 ${RULE_STATUSES.join('|')} 중 하나여야 합니다.`);
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean')
      errors.push('enabled는 boolean이어야 합니다.');
    const actions = rule.actions;
    if (!Array.isArray(actions) || actions.length === 0)
      errors.push('actions는 1개 이상이어야 합니다.');
    else {
      if (actions.length > LIMITS.ACTIONS_MAX)
        errors.push(`actions는 최대 ${LIMITS.ACTIONS_MAX}개입니다.`);
      actions.forEach((a, i) => {
        if (!a || typeof a !== 'object') { errors.push(`actions[${i}]가 객체가 아닙니다.`); return; }
        if (!ACTION_OPS.includes(a.op))
          errors.push(`actions[${i}].op("${a.op}")는 허용된 op가 아닙니다.`);
        if (a.selector !== undefined) {
          if (typeof a.selector !== 'string') errors.push(`actions[${i}].selector가 문자열이 아닙니다.`);
          else if (byteLength(a.selector) > LIMITS.SELECTOR_MAX_BYTES)
            errors.push(`actions[${i}].selector는 최대 ${LIMITS.SELECTOR_MAX_BYTES}바이트입니다.`);
        }
      });
    }
    if (rule.scope !== undefined) {
      const s = rule.scope;
      if (!s || typeof s !== 'object') errors.push('scope가 객체가 아닙니다.');
      else {
        if (s.level !== undefined && !SCOPE_LEVELS.includes(s.level))
          errors.push(`scope.level("${s.level}")은 ${SCOPE_LEVELS.join('|')} 중 하나여야 합니다.`);
        if (s.page_type != null && s.page_type !== '' && typeof s.page_type !== 'string')
          errors.push('scope.page_type은 문자열이어야 합니다.');
        if (s.locale !== undefined && !Array.isArray(s.locale))
          errors.push('scope.locale은 배열이어야 합니다.');
      }
    }
    return errors;
  }

  function validatePageTypeConfig(cfg) {
    const errors = [];
    if (!cfg || typeof cfg !== 'object') return ['페이지타입 설정이 객체가 아닙니다.'];
    if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean')
      errors.push('enabled는 boolean이어야 합니다.');
    if (cfg.fallback !== undefined && cfg.fallback !== null &&
        (typeof cfg.fallback !== 'string' || cfg.fallback.trim().length === 0))
      errors.push('fallback은 비어있지 않은 문자열이어야 합니다.');
    if (cfg.version !== undefined && (!Number.isInteger(cfg.version) || cfg.version < 1))
      errors.push('version은 1 이상의 정수여야 합니다.');
    const rules = cfg.hot_path_rules;
    if (!Array.isArray(rules)) return errors.concat(['hot_path_rules가 배열이 아닙니다.']);
    const seenHpr = new Set();
    rules.forEach((r, i) => {
      if (!r || typeof r !== 'object') { errors.push(`hot_path_rules[${i}]가 객체가 아닙니다.`); return; }
      if (typeof r.page_type !== 'string' || r.page_type.trim().length === 0)
        errors.push(`hot_path_rules[${i}].page_type이 비어 있습니다.`);
      else if (seenHpr.has(r.page_type))
        errors.push(`page_type "${r.page_type}"이 hot_path_rules에 중복 정의되었습니다.`);
      else seenHpr.add(r.page_type);
      if (!Number.isInteger(r.priority))
        errors.push(`hot_path_rules[${i}].priority는 정수여야 합니다.`);
      if (!Array.isArray(r.url_patterns) || r.url_patterns.some((p) => typeof p !== 'string' || p.length === 0))
        errors.push(`hot_path_rules[${i}].url_patterns는 비어있지 않은 문자열 배열이어야 합니다.`);
      if (r.query_params !== undefined && !Array.isArray(r.query_params))
        errors.push(`hot_path_rules[${i}].query_params는 배열이어야 합니다.`);
    });
    return errors;
  }

  return {
    API, KV, GLOBAL_ID, DEFAULT_ENV, DEFAULT_CHANNEL,
    RULE_TYPES, RULE_STATUSES, ACTION_OPS, SCOPE_LEVELS, RULE_CATEGORIES, LIMITS,
    DOMAIN_ID_RE, HOST_PATTERN_RE, RULE_ID_RE, byteLength,
    validateHostPattern, validateRegistry, validateRule, validatePageTypeConfig,
  };
})();
if (typeof module === 'object' && module.exports) module.exports = GeoContract;
/* ===== GEO ADMIN SHARED CONTRACT END ===== */
