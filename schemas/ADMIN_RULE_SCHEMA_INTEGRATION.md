# Rule Admin Schema 적용 안내

## Schema

Rule 생성·수정 시 다음 JSON Schema를 기준으로 입력값을 검증합니다.

Schema 파일: [rule.schema.json](./rule.schema.json)

```text
Schema ID: urn:geo-optimizer:rule-authoring-schema:1.2.0
Artifact version: 1.2.0
지원 Rule schema versions: 1.0, 1.1, 1.2
```

## 신규 action: `relocate_element`

`relocate_element`는 source element의 wrapper를 제거하고 내부 HTML 전체를 target element 직후로 이동합니다.

```json
{
  "op": "relocate_element",
  "execution_class": "bounded-buffer",
  "phase": "normalize",
  "selector": "noscript.crawl",
  "target_selector": "#subHeader h1",
  "max_buffer_bytes": 32768
}
```

필수 조건:

- Rule의 `schema_version`은 `"1.1"`이어야 합니다.
- `selector`, `target_selector`, `max_buffer_bytes`가 필요합니다.
- `max_buffer_bytes`의 허용 범위는 1~65,536입니다.
- `selectors` 배열은 사용할 수 없습니다.
- `execution_class`를 입력하면 `bounded-buffer`여야 합니다.
- `phase`를 입력하면 `normalize`여야 합니다.
- `execution_class`와 `phase`는 생략할 수 있습니다.

## 신규 Rule에서 선택 가능한 action

Schema의 `x-adminSelectable` 값을 기준으로 선택 가능 여부를 결정합니다.

신규 생성 가능:

```text
remove_element
flatten_element
relocate_element
remove_attribute
```

`x-adminSelectable: false`인 action은 기존 Rule 조회에는 표시할 수 있지만, 신규 생성이나 변경 시 선택할 수 없도록 처리해야 합니다.

## `flatten_element` 구분자 옵션

wrapper 제거 후 인접 텍스트가 붙는 경우 `separator_before` 또는 `separator_after`를 사용할 수 있습니다.

```json
{
  "op": "flatten_element",
  "execution_class": "streaming",
  "selector": "#subHeader h1 > p",
  "separator_after": " "
}
```

- 구분자를 사용하는 Rule의 `schema_version`은 `"1.2"`여야 합니다.
- 구분자는 `flatten_element`에서만 사용할 수 있습니다.
- 허용값은 빈 문자열, ASCII 공백 한 칸, 줄바꿈 한 글자입니다.
- 구분자는 HTML이 아닌 text로 삽입됩니다.
- 옵션을 생략한 기존 flatten 동작은 변경되지 않습니다.

## 추가 검증

다음 확장 필드는 일반 JSON Schema validator가 자동으로 처리하지 않습니다.

```text
x-adminSelectable
x-maxUtf8Bytes
x-runtimeExtraBudget
x-runtimeConstraints
```

Admin App은 최소한 다음을 보장해야 합니다.

- `rule_id`, `name`, selector에 공백만 입력할 수 없습니다.
- `x-maxUtf8Bytes`가 선언된 문자열은 UTF-8 바이트 제한을 지켜야 합니다.
- `template: null`은 허용하지 않습니다.
- Schema에 선언된 payload 크기 제한을 지켜야 합니다.
- `x-adminSelectable: false`인 action의 신규 publish를 차단해야 합니다.

JavaScript에서 UTF-8 바이트 길이는 다음과 같이 계산할 수 있습니다.

```javascript
const byteLength = new TextEncoder().encode(value).length;
```

## 서버 오류 처리

Admin의 사전 검증을 통과하더라도 Rule Engine의 최종 검증에서 요청이 거부될 수 있습니다.

서버가 validation 오류를 반환하면:

- publish 성공으로 표시하지 않습니다.
- Rule을 active 상태로 전환하지 않습니다.
- 서버가 반환한 validation 오류를 사용자에게 표시합니다.

## 구현 방식은 자율

다음 사항은 Admin App에서 자율적으로 결정할 수 있습니다.

- JSON Schema validator 라이브러리
- Schema를 build asset으로 포함할지 API로 제공할지 여부
- action 및 selector 입력 UI
- validation 메시지와 표시 위치
- 선택할 수 없는 action을 숨길지 disabled 상태로 표시할지 여부
- custom byte 검증을 client와 server 중 어디에서 수행할지 여부

구현 방식과 UI는 자유지만, 최종 payload는 JSON Schema와 Rule Engine validation을 모두 만족해야 합니다.
