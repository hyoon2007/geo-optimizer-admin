'use strict';
/*
 * SPIN_USE_MOCK=true 일 때 mock KV에 시드되는 샘플 데이터.
 * 범용 샘플: 특정 도메인명에 코드가 종속되지 않는다 (데이터일 뿐).
 * web/index.html의 브라우저 mock 어댑터도 동일한 형태의 데이터를 사용한다.
 */
const C = require('../../../shared/api-contract');

const REGISTRY = {
  schema_version: '1.0',
  default: 'coupang',
  customers: [
    { id: 'coupang', name: 'Coupang',
      host_patterns: ['coupang.com', '*.coupang.com'],
      page_types: ['product', 'search'] },
    { id: 'samsung', name: 'Samsung',
      host_patterns: ['samsung.com', '*.samsung.com'],
      page_types: ['product', 'landing'] },
    { id: 'lg', name: 'LG Electronics',
      host_patterns: ['lge.co.kr', '*.lge.co.kr', 'lg.com'],
      page_types: ['product', 'article'] },
  ],
};

function rule(overrides) {
  return {
    schema_version: '1.0',
    execution_class: 'streaming',
    priority: 100,
    enabled: true,
    version: 1,
    status: 'published',
    conditions: {},
    safety: { destructive: true, requires_preview: false },
    metadata: { source: { type: 'manual', reference: 'seed' }, citations: [], tags: [], owner: null, risk_level: null },
    ...overrides,
  };
}

const RULES = [
  rule({
    rule_id: 'rule_global_attribute_filter', name: 'Strip inline styles / tracking attrs',
    type: 'attribute_filter',
    scope: { level: 'global', customer: null, page_type: null, locale: [] },
    priority: 50, safety: { destructive: false, requires_preview: false },
    actions: [
      { op: 'remove_attribute', selector: '*', attribute: 'style' },
      { op: 'remove_attribute', selector: '*', attribute: 'onclick' },
    ],
  }),
  rule({
    rule_id: 'rule_global_dedup_blocks', name: 'Deduplicate repeated widgets',
    type: 'dedup_policy',
    scope: { level: 'global', customer: null, page_type: null, locale: [] },
    priority: 40,
    actions: [{ op: 'remove_element', selector: '[data-dedup-candidate]' }],
  }),
  rule({
    rule_id: 'rule_global_link_density_prune', name: 'Prune high link-density blocks',
    type: 'link_density_prune',
    scope: { level: 'global', customer: null, page_type: null, locale: [] },
    priority: 30,
    actions: [{ op: 'prune_by_link_density', selector: 'nav, footer, aside', params: { threshold: 0.8 } }],
  }),
  rule({
    rule_id: 'rule_global_mode_default', name: 'Default mode: protect main content',
    type: 'mode_policy',
    scope: { level: 'global', customer: null, page_type: null, locale: [] },
    priority: 10, safety: { destructive: false, requires_preview: false },
    actions: [{ op: 'protect_element', selector: 'main, article' }],
  }),
  rule({
    rule_id: 'rule_coupang_jsonld_product', name: 'Preserve & inject Product JSON-LD',
    type: 'json_ld_policy',
    scope: { level: 'customer', customer: 'coupang', page_type: null, locale: [] },
    priority: 90, safety: { destructive: false, requires_preview: false },
    metadata: { source: { type: 'schema.org', reference: 'https://schema.org/Product' },
      citations: ['https://schema.org/Product'], tags: ['geo', 'aeo'], owner: null, risk_level: 'low' },
    actions: [{ op: 'inject_json_ld', selector: 'head', params: { '@type': 'Product' } }],
  }),
  rule({
    rule_id: 'rule_coupang_phrase_ad', name: 'Remove ad phrases',
    type: 'text_phrase_remove',
    scope: { level: 'customer', customer: 'coupang', page_type: null, locale: ['ko'] },
    priority: 80,
    actions: [{ op: 'remove_text_phrase', phrase: '광고 상품입니다' }],
  }),
  rule({
    rule_id: 'rule_coupang_product_remove_header_gnb', name: 'Remove header GNB',
    type: 'selector_remove',
    scope: { level: 'customer_page_type', customer: 'coupang', page_type: 'product', locale: [] },
    priority: 100,
    actions: [{ op: 'remove_element', selector: '#wa-header' }],
  }),
  rule({
    rule_id: 'rule_samsung_container_promo', name: 'Remove promo containers',
    type: 'container_hint_remove',
    scope: { level: 'customer', customer: 'samsung', page_type: null, locale: [] },
    priority: 85,
    actions: [{ op: 'remove_element', selector: '[data-promo], .banner-carousel' }],
  }),
  rule({
    rule_id: 'rule_samsung_image_policy', name: 'Keep alt, drop srcset on images',
    type: 'image_policy',
    scope: { level: 'customer', customer: 'samsung', page_type: null, locale: [] },
    priority: 60, safety: { destructive: false, requires_preview: false },
    actions: [
      { op: 'keep_attribute', selector: 'img', attribute: 'alt' },
      { op: 'remove_attribute', selector: 'img', attribute: 'srcset' },
    ],
  }),
  rule({
    rule_id: 'rule_lg_token_noise', name: 'Remove noise tokens',
    type: 'text_token_remove',
    scope: { level: 'customer', customer: 'lg', page_type: null, locale: [] },
    priority: 70,
    actions: [{ op: 'remove_text_token', token: '™' }],
  }),
  rule({
    rule_id: 'rule_lg_role_banner', name: 'Drop banner role elements',
    type: 'role_policy',
    scope: { level: 'customer', customer: 'lg', page_type: null, locale: [] },
    priority: 75,
    actions: [{ op: 'remove_element', selector: '[role="banner"]' }],
  }),
];

function manifest(scopeObj, ruleIds) {
  const scope = C.KV.manifestScope(scopeObj);
  return {
    schema_version: '1.0',
    manifest_id: scope.replace(/\//g, ':') || 'global',
    env: C.DEFAULT_ENV, channel: C.DEFAULT_CHANNEL,
    scope: { tenant: 'default', customer: scopeObj.customer || null, page_type: scopeObj.pageType || null },
    version: 1,
    rules: ruleIds.map((id) => ({ rule_id: id, version: 1 })),
  };
}

const MANIFESTS = [
  { scope: {}, rules: ['rule_global_attribute_filter', 'rule_global_dedup_blocks', 'rule_global_link_density_prune', 'rule_global_mode_default'] },
  { scope: { customer: 'coupang' }, rules: ['rule_coupang_jsonld_product', 'rule_coupang_phrase_ad'] },
  { scope: { customer: 'coupang', pageType: 'product' }, rules: ['rule_coupang_product_remove_header_gnb'] },
  { scope: { customer: 'samsung' }, rules: ['rule_samsung_container_promo', 'rule_samsung_image_policy'] },
  { scope: { customer: 'lg' }, rules: ['rule_lg_token_noise', 'rule_lg_role_banner'] },
];

const PAGE_TYPE_CONFIGS = {
  coupang: {
    schema_version: '1.0', customer: 'coupang', version: 1, enabled: true, fallback: 'unknown',
    hot_path_rules: [
      { page_type: 'product', priority: 100, url_patterns: ['*/vp/products/*', '*/products/*'], query_params: [] },
      { page_type: 'search', priority: 90, url_patterns: ['*/np/search*'], query_params: ['q'] },
    ],
  },
  samsung: {
    schema_version: '1.0', customer: 'samsung', version: 1, enabled: true, fallback: 'unknown',
    hot_path_rules: [
      { page_type: 'product', priority: 100, url_patterns: ['*/p/*'], query_params: [] },
      { page_type: 'landing', priority: 50, url_patterns: ['*/event/*', '*/offer/*'], query_params: [] },
    ],
  },
  lg: {
    schema_version: '1.0', customer: 'lg', version: 1, enabled: true, fallback: 'unknown',
    hot_path_rules: [
      { page_type: 'product', priority: 100, url_patterns: ['*/product/*'], query_params: [] },
      { page_type: 'article', priority: 60, url_patterns: ['*/story/*', '*/blog/*'], query_params: [] },
    ],
  },
};

const GLOBAL_PAGE_TYPE_CONFIG = {
  schema_version: '1.0', customer: null, version: 1, enabled: true, fallback: 'unknown',
  hot_path_rules: [
    { page_type: 'product', priority: 10, url_patterns: ['*/product/*', '*/products/*'], query_params: [] },
  ],
};

function buildSeedEntries() {
  const entries = new Map();
  entries.set(C.KV.registry(), REGISTRY);
  for (const r of RULES) entries.set(C.KV.rule(r.rule_id, r.version), r);
  for (const m of MANIFESTS) entries.set(C.KV.manifest(C.KV.manifestScope(m.scope)), manifest(m.scope, m.rules));
  for (const [id, cfg] of Object.entries(PAGE_TYPE_CONFIGS)) entries.set(C.KV.pageType(id), cfg);
  entries.set(C.KV.pageType(null), GLOBAL_PAGE_TYPE_CONFIG);
  return entries;
}

module.exports = { buildSeedEntries };
