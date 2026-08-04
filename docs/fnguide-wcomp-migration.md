# fnguide 신버전(wcomp) 이전 대응 — 2026-08-04

`comp.fnguide.com`(구버전)이 폐지되고 `wcomp.fnguide.com`(신버전)으로 이전되면서
재무·기업개요 수집이 전면 중단된 건에 대한 조사 기록과 대응 계약이다.

## 사용자 지시 원문 (2026-08-04)

> fnguide 데이터 수집에 문제가 없는지 정기적으로 점검해. 도메인이 이걸로 바뀐 것 같은데 https://wcomp.fnguide.com/

이어진 선택(AskUserQuestion 응답):

- **수정 범위**: "전체 한 번에" — 재무 수집 + 기업개요 수집 + 회사소개 보강 + 폴백 가드 + 팝업 링크 + 회귀 테스트를 한 작업으로 처리.
- **수집 방식**: "requests로 전환" — 재무 수집을 Playwright(실브라우저)에서 단순 HTTP 요청으로 변경.
- **재발 감시**: "점검 스크립트 + 주간 자동 실행" — `scripts/verify_fnguide.py` + GitHub Actions 주 1회.

## 무엇이 깨졌나

구버전 `comp.fnguide.com`은 **모든 경로에서 HTTP 200과 함께** 다음 안내 페이지를 반환한다.

```
페이지가 없습니다.  [신버전 바로가기 → https://wcomp.fnguide.com]
```

상태 코드가 200이라 `raise_for_status()`류 검사에 걸리지 않는 **조용한 실패**다.
본문 길이 약 1,829바이트, `<table>` 1개(에러 레이아웃용).

영향 대상:

| 파일                               | 용도                         | 상태      |
| ---------------------------------- | ---------------------------- | --------- |
| `scripts/collect_financials.py`    | KR 상장사 재무제표·투자지표  | 전면 실패 |
| `scripts/collect_kr_snapshot.py`   | 기업개요(`business_summary`) | 전면 실패 |
| `scripts/enrich_description_v2.py` | 회사소개 보강                | 전면 실패 |
| `app/stock-popup/[id]/page.tsx`    | fnguide 바로가기 링크        | 죽은 링크 |

`collect-financials.yml`은 분기 1회(1·4·7·10월 15일) 실행이라 마지막 성공이 2026-07-14,
다음 예정이 2026-10-15다. 그래서 3주 넘게 아무도 몰랐다 — 주간 헬스체크를 붙이는 이유.

## 신버전 데이터 계약 (2026-08-04 실측)

### 1. 재무제표 — 순수 JSON 엔드포인트

```
GET https://wcomp.fnguide.com/CompanyInfo/getFinIncome  ?cmp_cd={6자리}&freq_typ={Y|Q}&consol_typ={C|P}
                                        getFinBalance
                                        getFinCashFlow
```

- `cmp_cd`: 종목코드 6자리. **`A` 접두어(구 `gicode`)를 붙여도 동작**하지만 붙이지 않는 게 정식.
- `freq_typ`: `Y`=연간, `Q`=분기
- `consol_typ`: `C`=연결, `P`=별도(Parent)

응답:

```json
{"dataset": {
  "header": [{"YYMM": "2023/12", "CD": "VAL1", "LINE": 0},
             {"YYMM": "2026/03 (최근분기)", "CD": "VAL4", "LINE": 1},
             {"YYMM": "2025/03 (전년동기)", "CD": "VAL5", "LINE": 0},
             {"YYMM": "전년동기대비(%)",    "CD": "VAL6", "LINE": 0}],
  "data":   [{"SEQ": 1, "AC_CODE": "200000", "P_AC_CODE": null, "NAME": "매출액(수익)",
              "DIGIT": 0, "UNIT": null, "LVL": 0, "VAL1": "2589354.94", ...}]
}}
```

**`AC_CODE`(계정 코드)가 회사와 무관한 표준값**이라는 점이 중요하다(005930·000660·005380 실측 동일).
구버전 파서는 계정명 문자열로 매칭해서 `부채총계`가 `부채및자본총계`를 집는 사고를 냈는데
(2026-07-18 감사, 79개사 217행), 코드 매칭으로 바꾸면 그 부류가 원천 차단된다.

| AC_CODE | 계정           | DB 컬럼                |
| ------- | -------------- | ---------------------- |
| 200000  | 매출액(수익)   | `revenue`              |
| 200360  | 매출원가       | `cogs`                 |
| 200810  | 매출총이익     | `gross_profit`         |
| 200820  | 판매비와관리비 | `sga`                  |
| 201370  | 영업이익       | `operating_income`     |
| 203170  | 당기순이익     | `net_income`           |
| 110000  | 자산총계       | `total_assets`         |
| 130000  | 부채총계       | `total_liabilities`    |
| 120000  | 자본총계       | `total_equity`         |
| 112830  | 유동자산       | `current_ratio` 계산용 |
| 131580  | 유동부채       | `current_ratio` 계산용 |
| 112840  | 재고자산       | `inventory`            |

값 단위는 **억원** — 기존 `FNGUIDE_UNIT_MULTIPLIER = 100`(→백만원)을 그대로 쓴다.

**⚠️ 헤더 열 처리 규칙** (오적재 방지의 핵심):

- `freq_typ=Y` 응답에도 `2026/03 (최근분기)` 열이 **섞여 온다.** 연간으로 적재하면 안 되므로 배제한다.
  결산월 비교(`_build_kr_rows`)만으로는 **3월 결산 회사에서 최근분기 열이 결산월과 일치해 통과**하므로
  라벨 기반 배제가 반드시 필요하다.
- `freq_typ=Q` 응답의 `(최근분기)` 열은 **최신 분기 실측값**이라 반드시 채택한다
  (이 열이 있어야 2026Q1 같은 최신 분기가 들어온다).
- `(전년동기)` 열은 **freq와 무관하게 항상 배제**한다. 손익 응답에만 있고 재무상태 응답에는 없어서,
  적재하면 자산·부채가 비어 있는 반쪽 행이 되고 1년 전에 온전히 수집해 둔 행을 덮어 NULL로 만든다.
- `전년동기대비(%)` 열은 증감률이라 항상 배제한다(기간 패턴이 없어 자동 배제됨).

**⚠️ 라벨이 항상 붙는 것은 아니다.** 결산월과 최신 분기가 겹치면 fnguide가 `(최근분기)` 라벨을
붙이지 않고 그냥 4개 결산 열을 준다(3월 결산 동원모빌리티, 12월 결산 태양기계 등 실측).
이 경우 4개 열 모두 정상 연간값이므로 그대로 채택하는 것이 맞다.

### 2. 투자지표 — 페이지 HTML 안의 인라인 JSON

```
GET https://wcomp.fnguide.com/CompanyInfo/Invest?cmp_cd={6자리}
```

렌더된 `<table id="tbl_value_idx">`는 **requests로는 빈 골격**(헤더가 2018~2022 더미)이라 파싱하면 안 된다.
실제 값은 같은 HTML 안 인라인 스크립트의 `invValueIndex` 객체에 있다.

```js
invValueIndex: {"data":   [{"GRP_CD":1,"SEQ":11,"NM":"   SPS","UNIT":"(원)","LVL":1,"VAL1":"44,494", ...}],
                "header": [{"YYMM":"2022/12","CD":"VAL1"}, ... {"YYMM":"2026/03","CD":"VAL5"}]}
```

`NM`은 들여쓰기 공백이 붙어 오므로 `strip()` 후 매칭한다. 값에 천단위 콤마가 포함된다.

### 3. 기업개요 — 셀렉터는 구버전과 동일

```
GET https://wcomp.fnguide.com/CompanyInfo/Snapshot?cmp_cd={6자리}
```

`ul#bizSummaryContent`, `#giName` 모두 **신버전에서 그대로 유효**(실측). URL만 갈아끼우면 된다.

### 4. 폴백(엉뚱한 회사) 동작 — 가드는 계속 필요

- 데이터 엔드포인트(`getFin*`)에 잘못된 `cmp_cd`(`999999`, `abc`)를 주면 1,628바이트 에러 페이지를 준다.
  **삼성전자로 조용히 대체되지 않는다** — 구버전보다 안전.
- 그러나 **페이지 경로**(`/CompanyInfo/Finance`, `/Snapshot`)에 파라미터 이름을 틀리면
  (`?code=000660` 등) 여전히 **기본 종목 삼성전자 페이지가 200으로** 돌아온다.
  → `scripts/lib/fnguide_guard.py`의 폴백 감지는 신버전에서도 유지한다.
  마커 문구(`DX, DS, SDC, Harman`, `1969년 설립된 글로벌 전자`)도 신버전에서 동일하게 확인됐다.

## 함께 처리한 별건 (2026-08-04)

### 1. 2026Q1 분기 공백 — 해소

전환 전 DB의 fnguide 분기 최신값이 2025-12-31이었다(2026Q1 없음). 신버전으로 재수집하니
정상 적재됐다. 원인은 구버전 종료 시점과 겹친 수집 실패로 보인다.

### 2. `financials.source` 유실 — 복구

`collect_uzauto_financials.py`를 **뺀 모든 재무 수집기가 `source`를 넣지 않고 있었다.**
DB에 남아 있던 `fnguide`/`dart`/`yfinance` 값은 과거 코드의 유산이고, 어느 시점부터
신규 적재분은 전부 `NULL`이었다. 한 회사에 여러 출처 행이 공존하는 구조라(상장사에
fnguide 행과 dart 행이 함께 있다) 출처가 비면 **값이 틀렸을 때 어느 수집기를 고쳐야
하는지 사후에 특정할 수 없다.**

조치:

- `scripts/lib/financial_sources.py`에 출처 상수를 모으고, financials에 쓰는 수집기
  9개가 모두 `'source'`를 채우도록 수정.
- fnguide·yfinance 경로는 재수집으로 즉시 반영. DART·MarkLines 등은 다음 정기 실행 때 반영된다.
- 재수집으로 덮이지 않는 잔여분 중 **출처가 명백한 것만** 마이그레이션
  `20260804000001_backfill_financials_source.sql`로 백필(NULL 561행 → 50행).
  남긴 50행은 marklines(직접 수집 vs web_search 폴백 혼재) · pykrx(hidden) ·
  fnguide 회사의 annual(fnguide vs dart_domestic 혼재)로, 추정으로 채우면 오히려
  오진을 부르므로 비워 뒀다.

**⚠️ 함정**: `collect_dart_domestic._build_rows`는 행 dict의 **키 개수**로 "실제 계정이
붙었는지"를 판정한다(`len(row) > 6`). `source`를 추가하면서 빈 행이 통과하게 되므로
`_META_KEY_COUNT` 상수로 바꿔 함께 고쳤다. 메타 키를 늘릴 때마다 이 판정을 확인할 것.

### 3. 018500 사명 변경 — 동원금속 → 동원모빌리티

fnguide 신버전이 **동원모빌리티**로 표기해 확인해 보니 KRX 공식 종목명도 동원모빌리티였다.
`companies`(name·name_kr) · `scripts/lib/companies.json` · 문서를 통일했다. 과거 감사
기록(`docs/data-audit-2026-07-18.md`)에는 옛 기록과의 연결을 위해 `동원모빌리티(구 동원금속)`로
병기했다. 아카이브(`scripts/_archive/`)는 프로젝트 규칙상 손대지 않았다.
