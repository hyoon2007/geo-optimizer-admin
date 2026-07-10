# Claude Code 프롬프트 — geo-optimizer 도메인 룰 관리 UI + Node.js BFF

> 이 파일은 **독립 저장소(`geo-optimizer-admin`)** 에서 Claude Code에 넘길 자체포함 프롬프트다.
> geo-optimizer(Spin) 저장소와 분리되어 있으므로, 필요한 Spin API 계약은 이 문서에 모두 포함되어 있다.
> Claude Code 실행: 이 저장소 루트에서 `claude "$(cat CLAUDE_CODE_PROMPT.md)"`

---

## 작업: geo-optimizer 도메인 룰 관리 UI + Node.js BFF

### 배경 / 아키텍처
- 원격 `geo-optimizer`는 Spin(WASM) 기반 HTML GEO 최적화기다. 최적화 룰은 Spin KV(`default` store)에 JSON으로 저장된다.
- 이 저장소는 그 **관리 도구**다. Spin과 분리되어 웹서버에 별도 호스팅되고 API로만 통신한다. 3계층:
  브라우저(정적 UI) → BFF(Node.js: 인증 + 프록시) → Spin(`/geo/rules/kv`).
- 브라우저는 Spin admin 토큰을 절대 보관/전송하지 않는다. BFF 세션(HttpOnly 쿠키)만 사용하고, Spin admin 토큰은 BFF가 환경변수로만 보관해 프록시 시 `x-geo-admin-token` 헤더로 주입한다.

### 핵심 도메인 모델 (반드시 반영)
- 실시간 최적화 요청은 **target URL의 host로 도메인을 자동 매칭**한다. `customer=` 같은 파라미터는 쓰지 않는다.
- 도메인 매칭은 KV의 **도메인 레지스트리**로 데이터 구동된다. 각 도메인은 `host_patterns`(호스트 매칭 규칙)를 가진다.
- 매칭 규칙: `*` 없는 패턴은 **정확 매칭**(`coupang.com`은 apex만), `*`는 임의 문자(멀티 라벨) 매칭(`*.coupang.com`). 여러 도메인이 겹치면 **가장 긴 패턴이 우선**한다.
- 룰/매니페스트/페이지타입은 도메인 id(`{id}`) 기준으로 KV에 저장된다(KV 경로 세그먼트는 하위호환상 `customer/{id}`).

### 산출물 (이 저장소 루트 구조)
- `web/index.html` — 의존성 없는 **순수 HTML + CSS + Vanilla JS 단일 파일**. 외부 CDN/프레임워크/빌드 금지. 브라우저로 바로 열려 동작.
- `bff/` — Node.js 서버(Express 또는 Fastify): package.json, 엔트리, 라우트, 인증/세션, Spin 프록시, fan-out 집계, 사용자 저장소 추상화.
- `README.md` — 실행법, 환경변수, API 계약, mock↔실서버 전환법.
- `.gitignore` — node_modules, .env, bff/data/users.json 등.
- `web`과 `bff`는 **공유 API 계약**을 단일 정의(문서/상수)해 불일치를 막아라.

### Spin 실제 계약 (BFF가 프록시하는 하위 API)
- 인증: 헤더 `x-geo-admin-token: <SPIN_ADMIN_TOKEN>`
- `GET|POST|DELETE {SPIN_BASE}/geo/rules/kv?key=<KEY>`
  - GET 응답: `{ ok, store, key, found, bytes, value, value_text }`
  - POST body = JSON, 응답: `{ ok, operation:"set", key, bytes }`
- KV 키 스킴 (기본 env=prod, channel=stable):
  - 도메인 레지스트리: `rules/v1/index/{env}/customers`
  - 매니페스트: `rules/v1/manifest/{env}/{channel}/[global | customer/{id} | page_type/{pt} | customer/{id}/page_type/{pt}]`
  - 룰: `rules/v1/rule/{rule_id}/version/{n}`
  - 페이지타입: `rules/v1/page-type/{env}/[global | customer/{id}]`

#### 스키마: 도메인 레지스트리
```json
{
  "schema_version": "1.0",
  "default": "coupang",
  "customers": [
    { "id": "coupang", "name": "Coupang",
      "host_patterns": ["coupang.com", "*.coupang.com"],
      "page_types": ["product"] }
  ]
}
```
- 검증(클라이언트+BFF 동일): customers 1~256개, id 문자 `[a-z0-9-_.]`·중복 금지, default는 customers에 존재. host_patterns 최대 32개·각 ≤253바이트·문자 `[a-z0-9-.*]`만.

#### 스키마: 매니페스트 (룰 목록/스위치판, 룰 본문 아님)
```json
{
  "schema_version": "1.0",
  "manifest_id": "customer:coupang:page_type:product",
  "env": "prod", "channel": "stable",
  "scope": { "tenant": "default", "customer": "coupang", "page_type": "product" },
  "version": 1,
  "rules": [ { "rule_id": "rule_coupang_product_remove_header_gnb", "version": 1 } ]
}
```

#### 스키마: 룰
```json
{
  "schema_version": "1.0",
  "rule_id": "rule_coupang_product_remove_header_gnb",
  "name": "Remove header GNB",
  "type": "selector_remove",
  "execution_class": "streaming",
  "scope": { "level": "customer_page_type", "customer": "coupang", "page_type": "product", "locale": [] },
  "priority": 100, "enabled": true, "version": 1, "status": "published",
  "conditions": {}, 
  "actions": [ { "op": "remove_element", "selector": "#wa-header" } ],
  "safety": { "destructive": true, "requires_preview": false },
  "metadata": { "source": {"type":"...", "reference":"..."}, "citations": [], "tags": [], "owner": null, "risk_level": null }
}
```
- RuleType(12): selector_remove, attribute_filter, text_token_remove, text_phrase_remove, container_hint_remove, role_policy, div_policy, image_policy, json_ld_policy, link_density_prune, dedup_policy, mode_policy
- status: draft | published | deprecated | archived
- RuleActionOp: remove_element, flatten_element, remove_attribute, keep_attribute, remove_text_token, remove_text_phrase, protect_element, promote_tag, inject_json_ld, prune_by_link_density
- 검증 한계: priority 0..10000, actions ≤16개, rule_id ≤96B, name ≤160B, selector ≤512B.

#### 스키마: 페이지타입 config
```json
{
  "schema_version": "1.0",
  "customer": "coupang", "version": 1, "enabled": true, "fallback": "unknown",
  "hot_path_rules": [ { "page_type": "product", "priority": 100, "url_patterns": ["*/vp/products/*", "*/products/*"], "query_params": [] } ]
}
```
- page_type 허용값: product, category, search, landing, article, policy, unknown

### BFF (Node.js) 요구사항
#### 인증 (초기 파일기반 → DB 전환 가능)
- `POST /api/auth/login` {username,password} → HttpOnly, SameSite=Strict 세션 쿠키.
- `POST /api/auth/logout`, `GET /api/auth/me`.
- 사용자 저장소는 **인터페이스(추상화)**. 초기 구현 파일기반(`bff/data/users.json`), 향후 DB 어댑터 교체 가능하게.
- 비밀번호는 **bcrypt/argon2 해시**만 저장. `npm run seed:user`로 관리자 계정 생성.
- 세션 서버측 저장, 로그아웃/만료 처리.

#### 도메인/룰 프록시 (세션 인증 필수)
- `GET  /api/domains` → Spin 레지스트리 조회 → {default, domains:[{id,name,host_patterns,page_types}]}.
- `POST /api/domains` → 레지스트리 전체 저장(추가/수정/삭제). 저장 전 서버측 검증(host_patterns 규칙).
- `GET  /api/domains/:id/page-types` → `rules/v1/page-type/{env}/customer/:id` 조회/파싱.
- `POST /api/domains/:id/page-types` → 페이지타입 config 저장.
- `GET  /api/rules?scope=global` 또는 `?domain=:id&page_type=` → **매니페스트를 읽고 rule 포인터를 fan-out 조회**해 룰 배열 집계.
- `GET  /api/rules/:rule_id?version=` , `POST /api/rules/:rule_id?version=` → 룰 get/set. 저장 전 필수값/priority(0..10000)/actions(≤16) 재검증.
- `GET/POST /api/config` — spin.toml 변수용. **수도코드/스텁만**(실제 파일 조작 금지).

#### 보안/운영
- 환경변수: `SPIN_BASE_URL`, `SPIN_ADMIN_TOKEN`, `SESSION_SECRET`, `PORT`. `.env.example` 제공, `.env`/`bff/data/users.json`은 .gitignore.
- BFF가 정적 UI(`web/index.html`)도 서빙하면 동일 오리진으로 단순화(권장): `/`→index.html, `/api/*`→API. 아니면 CORS+CSRF 설정.
- 로그인·쓰기 rate-limit, CSRF. Spin admin 토큰/시크릿을 응답·로그에 노출 금지.

### UI (web/index.html) 요구사항
#### 로그인
- 사용자/비밀번호 폼 → `POST /api/auth/login`. 세션 쿠키로 인증(브라우저는 토큰 직접 보관 안 함). 미인증 차단, 로그아웃.

#### 상단 전역 도메인 선택
- `GET /api/domains`로 **동적** 드롭다운(하드코딩 금지). 기본 선택 = 응답 `default`, 없으면 첫 항목. 최상단에 "공통(Global)" 고정 엔트리.
- 변경 시 하위 섹션 재로딩.

#### 3개 대분류 섹션 (탭/좌측 내비)
- 탭A **도메인 정보**: 선택 도메인의 `name`, `host_patterns` 편집.
  - host_patterns 편집기: **콤마로 여러 개 입력 → 저장 시 배열로 분해**. 각 항목에 `*` 와일드카드 허용.
  - 도움말 문구: "`*` 없으면 정확 매칭(apex만), `*.coupang.com`은 서브도메인. 여러 도메인이 겹치면 **가장 긴 패턴이 우선**." 명시.
  - 클라이언트 검증: 최대 32개, ≤253바이트, 문자 `[a-z0-9-.*]`만.
- 탭B **페이지 타입 정보**: 선택 도메인의 page-type config(page_type, url_patterns 등) 표시/편집.
- 탭C **최적화 룰 정보**: 룰을 아래 카테고리로 그룹핑.

#### 최적화 룰 카테고리 (RuleType 매핑, 카테고리 헤더에 설명)
- 구조 제거: selector_remove, container_hint_remove, div_policy, role_policy
- 속성 정제: attribute_filter
- 텍스트 정제: text_token_remove, text_phrase_remove
- 이미지/미디어: image_policy
- 시맨틱/구조화 데이터: json_ld_policy
- 중복 제거: dedup_policy
- 링크 밀도: link_density_prune
- 모드 정책: mode_policy

#### 룰 편집
- 폼: rule_id, name, type, scope(customer/page_type/locale), priority, enabled, version, status, conditions, actions, safety, metadata(source/citations/tags/owner/risk_level).
- **각 필드 옆 설명(도움말)**: title 툴팁 + 짧은 설명. source/citations는 GEO/AEO 신뢰성·인용 보존용임을 반영.
- 클라이언트 검증: priority 0..10000, actions ≤16, 필수값(rule_id/name/type/actions≥1). 저장 전 JSON 미리보기 → `POST /api/rules/:rule_id?version=`.

#### spin.toml 설정 (템플릿 + 수도코드만)
- "환경 설정" 섹션 스켈레톤(geo_enable_gid, geo_request_profile, geo_dedup_text_tags 등)만.
- 실제 로드/저장 금지, 주석 수도코드:
  ```
  // TODO(config): GET /api/config 로 spin.toml 변수 로드
  // TODO(config): POST /api/config 로 저장 (BFF 연동 예정)
  ```

### Mock 어댑터 (범용, 샘플 비종속)
- BFF 미기동/오프라인용 mock을 어댑터로 분리(`USE_MOCK` 플래그, 실제 fetch로 무수정 교체 가능).
- mock 도메인 **여러 개**(coupang, samsung, lg) 제공, 각기 다른 host_patterns/룰/페이지타입 반환. 특정 도메인명에 코드 종속 금지.
- 카테고리별 샘플 룰 1~2개씩(위 스키마 준수).

### 코드 품질/보안
- XSS 방지: 데이터 문자열은 textContent 렌더(원시 innerHTML 삽입 금지).
- fetch 에러 핸들링(401/403/네트워크) + 사용자 피드백. 접근성(라벨/포커스/키보드).
- 시크릿 하드코딩 금지. `.env`/`users.json`은 .gitignore.

### 검증 & 산출 보고
- `bff`에서 `npm install && npm start`, `web/index.html` 서빙 확인.
- 로그인 → 도메인 선택 → host_patterns/페이지타입/룰 편집·미리보기·저장 흐름을 mock으로 확인.
- 마지막에: 구현 화면, BFF 라우트, 사용자 저장소 추상화 지점, mock↔실서버 전환법, 남은 TODO(config, DB 어댑터)를 요약 보고하라.

---

## 실 연동 참고 (Phase 3)
Spin에 도메인 레지스트리를 먼저 저장해야 UI에 도메인이 뜬다:
```
curl -X POST '{SPIN_BASE}/geo/rules/kv?key=rules/v1/index/prod/customers' \
  -H 'x-geo-admin-token: <TOKEN>' -H 'content-type: application/json' \
  -d '{"schema_version":"1.0","default":"coupang","customers":[{"id":"coupang","name":"Coupang","host_patterns":["coupang.com","*.coupang.com"],"page_types":["product"]}]}'
```
이후 `GET {SPIN_BASE}/geo/recommend?url=https://www.coupang.com/...`가 `customer=` 없이 coupang 룰로 매칭된다.

## 보안 유의 (배포)
- `SPIN_ADMIN_TOKEN`은 BFF 서버측에만. 브라우저·리포 노출 금지.
- 개발용 토큰은 운영에서 강한 토큰으로 교체하고, geo-optimizer의 `spin.toml` `geo_rule_admin_token`도 함께 갱신.
- BFF는 HTTPS 뒤에 두고 세션 쿠키 `Secure` 적용.
