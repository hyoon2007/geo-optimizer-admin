# geo-optimizer-admin

geo-optimizer(Spin/WASM HTML GEO 최적화기)의 **도메인 룰 관리 도구**.
Spin과 분리되어 별도 호스팅되며 API로만 통신한다.

```
브라우저 (web/index.html, 정적 UI)
   │  세션 쿠키 (HttpOnly, SameSite=Strict) — Spin 토큰은 브라우저에 절대 없음
   ▼
BFF (bff/, Node.js Express: 인증 + 검증 + 프록시 + fan-out 집계)
   │  x-geo-admin-token 헤더 주입 (환경변수로만 보관)
   ▼
Spin geo-optimizer  GET|POST|DELETE {SPIN_BASE}/geo/rules/kv?key=...
```

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `web/index.html` | 의존성 없는 순수 HTML+CSS+Vanilla JS 단일 파일 UI (브라우저로 바로 열림) |
| `bff/` | Node.js BFF — 인증/세션, Spin 프록시, 매니페스트 fan-out, 검증 |
| `shared/api-contract.js` | **web/bff 공유 API 계약 단일 정의** (경로, KV 키 스킴, 열거값, 한계값, 검증기) |
| `bff/scripts/check-contract.js` | index.html 인라인 계약 블록 ↔ shared 파일 동기화 검증 |

`web/index.html`은 빌드 없이 단일 파일이어야 하므로 계약 블록이 인라인되어 있다.
계약 변경 시 `shared/api-contract.js`를 수정하고 같은 블록을 index.html에 반영한 뒤
`cd bff && npm run check:contract`로 일치를 확인한다.

## 실행법

```bash
cd bff
npm install
cp .env.example .env            # 값 채우기 (아래 환경변수 참고)
npm run seed:user -- --username admin --password 'your-password'
npm start                       # http://localhost:8787
```

브라우저에서 `http://localhost:8787` 접속 → 로그인 → 상단에서 도메인 선택 → 탭에서 편집.
(BFF가 `web/index.html`을 동일 오리진으로 서빙하므로 CORS 불필요)

### 환경변수 (`bff/.env`)

| 변수 | 설명 |
|---|---|
| `SPIN_BASE_URL` | Spin geo-optimizer 베이스 URL |
| `SPIN_ADMIN_TOKEN` | Spin 룰 관리 토큰. **BFF 서버측에만 존재** — 응답/로그/브라우저 노출 금지 |
| `SESSION_SECRET` | 세션 서명 시크릿 (운영 필수, 긴 랜덤 문자열) |
| `PORT` | BFF 포트 (기본 8787) |
| `SPIN_USE_MOCK` | `true`면 Spin 없이 in-memory mock KV로 동작 (개발/데모) |
| `GEO_ENV` / `GEO_CHANNEL` | KV 키의 env/channel (기본 `prod` / `stable`) |

## mock ↔ 실서버 전환

두 단계의 mock이 있고, 어댑터 인터페이스가 동일해 **무수정 교체**된다.

1. **브라우저 mock** (`web/index.html`의 `USE_MOCK` 플래그)
   - BFF 없이 UI만 데모. `file://`로 직접 열면 자동 mock.
   - coupang / samsung / lg 3개 샘플 도메인과 카테고리별 샘플 룰 제공 (데이터일 뿐, 코드는 도메인명에 비종속).
   - 실서버 전환: `USE_MOCK = false`(기본값) 상태로 BFF가 서빙하는 페이지 접속.
2. **BFF mock KV** (`SPIN_USE_MOCK=true`)
   - 실제 로그인/세션/검증/fan-out은 전부 동작하고 Spin KV만 in-memory로 대체.
   - 실서버 전환: `.env`에서 `SPIN_USE_MOCK=false` + `SPIN_BASE_URL`/`SPIN_ADMIN_TOKEN` 설정.

## API 계약 (BFF)

인증: 세션 쿠키(HttpOnly, SameSite=Strict). 쓰기 요청은 `x-csrf-token` 헤더 필요
(로그인/`GET /api/auth/me` 응답의 `csrfToken`).

| 메서드/경로 | 설명 |
|---|---|
| `POST /api/auth/login` | `{username, password}` → 세션 쿠키 + `csrfToken` |
| `POST /api/auth/logout` | 세션 파기 |
| `GET /api/auth/me` | 세션 확인 → `{authenticated, user, csrfToken}` |
| `GET /api/domains` | 도메인 레지스트리 → `{default, domains:[{id,name,host_patterns,page_types}]}` |
| `POST /api/domains` | 레지스트리 **전체 저장** (추가/수정/삭제). 서버측 재검증 |
| `GET /api/domains/:id/page-types` | 페이지타입 config 조회 (미존재 시 기본 골격 반환). `:id=__global__`이면 글로벌 |
| `POST /api/domains/:id/page-types` | 페이지타입 config 저장 (재검증) |
| `GET /api/rules?scope=global` 또는 `?domain=:id[&page_type=pt]` | 매니페스트 조회 후 룰 포인터 **fan-out 집계** → `{manifest, rules:[{rule_id,version,found,rule}]}` |
| `GET /api/rules/:rule_id?version=n` | 룰 단건 조회 |
| `POST /api/rules/:rule_id?version=n[&attach=1&domain=&page_type=]` | 룰 저장 (재검증). `attach=1`이면 해당 스코프 매니페스트에 포인터 upsert |
| `GET/POST /api/config` | spin.toml 변수용 **스텁** (TODO(config) — 실제 파일 조작 없음) |

### Spin KV 키 스킴 (기본 env=prod, channel=stable)

- 도메인 레지스트리: `rules/v1/index/{env}/customers`
- 매니페스트: `rules/v1/manifest/{env}/{channel}/[global | customer/{id} | page_type/{pt} | customer/{id}/page_type/{pt}]`
- 룰: `rules/v1/rule/{rule_id}/version/{n}`
- 페이지타입: `rules/v1/page-type/{env}/[global | customer/{id}]`

### 도메인 매칭 규칙 (핵심 모델)

- 최적화 요청은 target URL의 **host**로 도메인을 자동 매칭 (`customer=` 파라미터 없음).
- `*` 없는 패턴은 **정확 매칭**(`coupang.com`은 apex만), `*.coupang.com`은 서브도메인(멀티 라벨) 매칭.
- 여러 도메인 패턴이 겹치면 **가장 긴 패턴이 우선**.
- 검증: customers 1~256개, id `[a-z0-9-_.]`, host_patterns 최대 32개·각 ≤253바이트·문자 `[a-z0-9-.*]`.

## 사용자 저장소 추상화

`bff/src/users/userStore.js`의 `UserStore` 인터페이스(`findByUsername`/`upsert`/`list`)가 계약.
초기 구현은 파일기반 `FileUserStore`(`bff/data/users.json`, bcrypt 해시만 저장, .gitignore 대상).
DB 전환 시 `DbUserStore`를 구현하고 `createUserStore()`에서 분기하면 된다 — `TODO(db)`.

## 실 연동 (Phase 3)

Spin에 도메인 레지스트리를 먼저 저장해야 UI에 도메인이 뜬다:

```bash
curl -X POST '{SPIN_BASE}/geo/rules/kv?key=rules/v1/index/prod/customers' \
  -H 'x-geo-admin-token: <TOKEN>' -H 'content-type: application/json' \
  -d '{"schema_version":"1.0","default":"coupang","customers":[{"id":"coupang","name":"Coupang","host_patterns":["coupang.com","*.coupang.com"],"page_types":["product"]}]}'
```

이후 `GET {SPIN_BASE}/geo/recommend?url=https://www.coupang.com/...`가 `customer=` 없이 coupang 룰로 매칭된다.

## 보안 유의 (배포)

- `SPIN_ADMIN_TOKEN`은 BFF 서버측에만. 브라우저·리포에 노출 금지.
- 개발용 토큰은 운영에서 강한 토큰으로 교체하고 geo-optimizer `spin.toml`의 `geo_rule_admin_token`도 함께 갱신.
- BFF는 HTTPS 뒤에 두고(`NODE_ENV=production` 시 세션 쿠키 `Secure` 자동 적용) `trust proxy` 설정됨.
- 로그인(5분 10회)·쓰기(분당 60회) rate-limit, CSRF 토큰, 세션 고정 방지(로그인 시 재생성) 적용.

## 남은 TODO

- `TODO(config)`: `GET/POST /api/config` ↔ 실제 spin.toml 변수 로드/저장 연동 (현재 스텁·수도코드).
- `TODO(db)`: `DbUserStore` 어댑터 (현재 파일기반).
- `TODO(session)`: 운영 다중 인스턴스 시 세션 저장소를 MemoryStore → Redis 등으로 교체.
