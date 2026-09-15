# 회사 설명·제품 데이터 정본 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국내 상장사 180곳의 `business_summary` 를 fnguide 정본으로 되돌리고, LLM 보강이 그 값을 다시 덮지 못하게 막은 뒤, 휴머노이드 비상장사의 제품·설명을 실물과 맞추고 멈춘 시가총액 수집을 되살린다.

**Architecture:** 회사 설명에는 **정본이 둘** 있다 — 국내 상장사는 fnguide 기업개요(`collect_kr_snapshot.py`), 그 밖은 LLM 보강이다. 지금까지 이 경계를 아는 코드가 없어 LLM 이 fnguide 값을 덮어 왔다. 경계 판정을 `lib/companies.py` 의 단일 함수로 만들고 보강 스크립트 5개가 모두 그것을 보게 한 뒤, 경계가 다시 무너지면 기계가 잡도록 검사기를 남긴다.

**Tech Stack:** Python 3.13 + postgrest-py(`scripts/lib/db.py`) · Playwright(fnguide 스크레이핑) · pykrx(시세) · Supabase Postgres

## Global Constraints

- DB 접근은 **`scripts/lib/db.py` 경유**만. `supabase` SDK 금지.
- mutating 스크립트는 **`WriteSession`** 안에서 돌린다(종료 시 캐시 태그 자동 무효화).
- 파일 저장은 **UTF-8(BOM 없음) + LF**. 파이썬 스크립트 첫머리에 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`.
- 셸은 PowerShell 5.1 — `&&` 미지원. venv 파이썬은 `PYTHONIOENCODING=utf-8` 프리픽스. 한글이 든 스크립트는 **파일로 저장한 뒤 실행**(인라인 `-c` 는 조용히 깨진다).
- `verify_*.py` 는 **exit 0 이 정상**이고 위반이 있으면 0 이 아닌 값으로 끝낸다.
- 한국어를 부분 문자열로 맞추는 검사기에는 **`MUST_HIT` · `MUST_MISS` 자가 시험**을 같은 파일에 박고 본 검사 전에 돌린다.
- 새 `verify_*.py` 는 AGENTS.md 「검증 명령」에 **한 줄** 추가하고 통과 상태가 무엇인지 명시한다.
- 새로 겪은 함정은 AGENTS.md 본문이 아니라 `docs/gotchas-*.md` 에 적는다.

### 상위 계획서의 확정 결정 (그대로 따른다 · 되묻지 않는다)

`agents/docs/superpowers/plans/2026-08-24-humanoid-research.md` 「확정된 결정」에서 이번 작업에 걸리는 것:

- **결정 12 — 고객사는 컬럼 삭제·수집하지 않는다.** 🔴 제품을 정정하면서 고객사를 함께 채우지 말 것(2026-08-25 에 이 결정을 어겨 15개사 고객사가 조용히 수집됐고 되돌렸다).
- **결정 6 — 부품 카테고리 11종이 정본이다**: `액추에이터` · `감속기` · `모터` · `볼스크류/리니어` · `힘토크센서` · `위치센서` · `비전카메라` · `제어AI칩` · `배터리` · `구조기구` · `그리퍼핸드` (+ `기타`). 퓨트로닉의 내재화 모터가 쓸 자리가 여기 있다.
- **결정 7 — 비상장사는 재무 또는 기업가치가 있는 곳까지** 싣는다.

---

## 사용자 지시 원문 (2026-09-16)

> - 휴머노이드 페이지에 회사 정보가 이상한데? 국내 상장사의 경우 fnguide의 Business Summary 가져오는 거잖아. 하이젠알앤엠 확인해 보니까 아니던데?
> - 퓨트로닉은 모터 제품 생산회사 인데 제품이 이상한데?
> - 전반적으로 데이터 제대로 수집했는지 확인해봐

## 확정된 결정 (AskUserQuestion 2026-09-16 · 되묻지 말 것)

| # | 결정 | 내용 |
| --- | --- | --- |
| 1 | 복구 범위 | **국내 상장사 180곳 전부** fnguide 정본으로 되돌린다 |
| 2 | 재발 방지 | **덮어쓰기 가드** + **검사기 신설**. 수집 주기 단축은 하지 않는다 |
| 3 | 가드 강도 | 🔴 **빈 칸일 때만 LLM 허용.** 설명이 이미 있으면 국내 상장사는 절대 안 덮는다. 새로 상장해 fnguide 에 아직 기업개요가 없는 회사가 영영 빈 칸으로 남는 것을 막기 위한 예외다 |
| 4 | 제품 오류 | **휴머노이드 비상장 9곳 전체 재조사** 후 정정 |
| 5 | 제품 개수 | 🔴 **대표 제품군 5~8개.** 개별 모델명을 나열하지 않고 제품군으로 묶는다(HD현대로보틱스 95종을 그대로 싣지 않는다) |
| 6 | 한화로보틱스 | **휴머노이드 페이지에 남기되** 설명에 「협동로봇·이동로봇 제조」라고 사실대로 적는다. 휴머노이드 제품이 있는 것처럼 쓰지 않는다 |
| 7 | 시가총액 | 🔴 **GHA 에서 pykrx 원인을 먼저 판다.** 네이버 API 로 즉시 교체하지 않는다(네이버가 정상 응답을 준다는 것은 확인했으므로 원인 규명 후에도 막히면 그때 대안으로 꺼낸다) |
| 8 | 계획서 | 이 파일을 새로 만든다(휴머노이드 계획서와 완료 정의가 다르다) |

## 조사로 확정된 사실 (2026-09-16 실측)

- fnguide 는 **정상 작동**한다. 하이젠알앤엠 468자, 레인보우로보틱스 477자 등 실측 확인.
- 사고 당시 국내 상장사 180곳 중 fnguide 원문 생존 **0곳**. fnguide 기업개요는 **예외 없이 「동사」로 시작**한다(복구 후 180/180 성립 · 평균 450자 · 최소 405자).
- 2026-07-14 GHA 실행 로그: `business_summary=OK` **170건** → 사흘 뒤 덮였다.
- 범인 ①: 2026-07-17 `enrich_description_v2.py` 가 **폐지된 구 fnguide 도메인**을 보고 있었다. 폐지 도메인은 404 가 아니라 HTTP 200 안내 페이지라 오류 없이 「내용 없음」이 되어 166곳이 2차 LLM 경로로 샜다. 도메인 수정은 3주 뒤 커밋 `b3ac624`(2026-08-04)이고 값은 되돌리지 않았다.
- 범인 ②: `enrich_company.py` 의 `_missing_meta` 가 **제품·홈페이지가 비었다는 이유**로 대상에 넣고, 그 회사의 설명까지 새로 써서 덮는다. 2026-08-24~25 휴머노이드 보강에서 재발(휴머노이드 16곳 평균 162자).
- `collect_kr_snapshot.py` 에 **`revalidate` 호출이 없다** — 수집이 성공해도 화면은 낡은 채로 남는다.
- 시가총액: 최근 실행 로그에서 `market_cap=None` **179건**, 예외 로그 0건. 코드가 값이 없으면 갱신 payload 에서 빼므로 17곳은 NULL, 163곳은 과거 값에 멈춰 있다. 🔴 **값 자체가 틀린 게 아니라 낡은 것이다** — 현대차 DB 127.8조 vs 실제 75.1조(네이버 실측)이고 52주 최고가가 787,000원이라 과거 62만원대 시절 값이 멈춘 것으로 설명된다.
- 로컬에서는 pykrx 의 **주가 조회까지 함께 죽는다**(KRX 전면 차단). 그래서 시총만 죽은 원인은 **로컬로 가릴 수 없고 GHA 에서 실험해야 한다.**
- 퓨트로닉 실물 대조(공식 홈페이지 제품 페이지): 공식 제품은 `Transfer Case` · `E-Locker` · `Steering` · `Parking Lock` · `EOP` · `PTU` · `EV Infra` 7종인데 DB 에는 **EV Infra 가 없고**, 대신 제품이 아닌 설명문이 제품 칸에 들어가 있다. 카테고리는 7종 전부 `액추에이터` 라 **모터가 하나도 없다.**

---

## File Structure

| 파일 | 책임 | 변경 |
| --- | --- | --- |
| `scripts/lib/companies.py` | 회사 메타 로더 + 회사 분류 판정 | `has_authoritative_summary()` · `keeps_existing_summary()` 추가 |
| `scripts/enrich_company.py` | 신규 회사 재무·메타 보강 | 설명 저장 직전 가드 |
| `scripts/enrich_description_v2.py` | 출처별 회사 설명 수집 | 국내 상장사는 fnguide 실패 시 **2차로 내려가지 않는다**(기존 값이 있을 때) |
| `scripts/enrich_description_sonnet.py` | 설명 LLM 보강 | 대상에서 제외 |
| `scripts/enrich_description_append.py` | 설명 append 보강 | 대상에서 제외 |
| `scripts/enrich_top100_meta.py` | 부품사 TOP100 메타 보강 | 설명 저장 직전 가드 |
| `scripts/collect_kr_snapshot.py` | fnguide 기업개요 수집(정본) | `WriteSession` 전환 + revalidate |
| `scripts/verify_summary_source.py` | **신규** — 정본 경계 검사기 | 신설 |
| `scripts/collect_prices_live.py` | 시세·시가총액 수집 | 시총 실패를 침묵시키지 않는다 |
| `AGENTS.md` | 약속 | 검증 명령 한 줄 |
| `docs/gotchas-data-collection.md` | 수집 함정 정본 | 이번 사고 기록 |
| `HANDOFF.md` | 재개 지점 | 새 블록 |

---

### Task 1: 정본 경계 판정 함수

**Files:**
- Modify: `scripts/lib/companies.py`

**Interfaces:**
- Produces: `has_authoritative_summary(c: dict) -> bool` — `country == 'KR'` 이고 `market` 이 차 있으면 True(= 설명 정본이 fnguide).
- Produces: `keeps_existing_summary(c: dict) -> bool` — 정본 회사이면서 **설명이 이미 차 있으면** True. 보강 스크립트는 이 값이 True 인 회사의 `business_summary` 를 **쓰지 않는다**(결정 3).

- [ ] **Step 1: 판정 함수 두 개 추가**

```python
def has_authoritative_summary(c: dict) -> bool:
  """이 회사의 business_summary 는 **외부 정본**(fnguide 기업개요)이 채우는가."""
  return c.get('country') == 'KR' and bool(c.get('market'))


def keeps_existing_summary(c: dict) -> bool:
  """LLM 보강이 이 회사의 business_summary 를 **건드리면 안 되는가**.

  정본 회사라도 값이 **비어 있으면** LLM 이 임시로 채우는 것을 허용한다(사용자 결정
  2026-09-16) — 새로 상장해 fnguide 에 아직 기업개요가 없는 회사가 영영 빈 칸으로
  남는 것을 막기 위해서다. 다음 분기 수집이 정본으로 바꿔 놓는다.
  """
  return has_authoritative_summary(c) and bool(c.get('business_summary'))
```

`has_authoritative_summary` 의 docstring 에 2026-07-17 사고 경위(폐지 도메인이 HTTP 200 을 돌려줘 166곳이 조용히 샌 것)와 **비상장사를 포함시키지 말 것**이라는 경계를 적는다. 비상장사는 fnguide 에 없어 LLM 보강이 유일한 경로다.

- [ ] **Step 2: 판정이 네 갈래를 제대로 가르는지 확인**

Run:
```bash
PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -c "import sys; sys.path.insert(0,'scripts'); from lib.companies import keeps_existing_summary as k; print(k({'country':'KR','market':'KOSDAQ','business_summary':'동사는...'}), k({'country':'KR','market':'KOSDAQ','business_summary':None}), k({'country':'KR','market':None,'business_summary':'x'}), k({'country':'US','market':'NASDAQ','business_summary':'x'}))"
```
Expected: `True False False False` (국내 상장사이고 값이 있을 때만 보호)

---

### Task 2: 보강 스크립트 5개에 가드 적용

**Files:**
- Modify: `scripts/enrich_company.py` (메타 저장부 · 조회는 이미 `market` 포함)
- Modify: `scripts/enrich_description_v2.py` (조회 컬럼 + 2차 진입부)
- Modify: `scripts/enrich_description_sonnet.py:145` (조회 컬럼 + 대상 필터)
- Modify: `scripts/enrich_description_append.py:137` (조회 컬럼 + 대상 필터)
- Modify: `scripts/enrich_top100_meta.py:124,160` (조회 컬럼 + 설명 저장부)

**Interfaces:**
- Consumes: Task 1 의 `keeps_existing_summary(c)`

- [ ] **Step 1: `enrich_company.py` — 설명만 건너뛴다**

제품·홈페이지 보강은 계속해야 하므로 **대상에서 빼지 않고 저장 payload 에서만** 설명을 뺀다.

```python
        payload = {}
        if keeps_existing_summary(c):
          logger.debug(f'  {c["name_kr"]}: 국내 상장사 — business_summary는 fnguide 정본 유지')
        elif res.get('business_summary'):
          bs_clean = strip_citation_tags(res['business_summary'])
          ...
```

- [ ] **Step 2: `enrich_description_v2.py` — 국내 상장사는 2차로 내려가지 않는다**

이 스크립트가 2026-07-17 사고의 진원지다. fnguide 1차가 실패해도 **기존 값이 있으면** 아무것도 저장하지 않고 다음 회사로 넘어간다.

```python
                if not desc or len(desc) < MIN_LEN_THRESHOLD:
                    if keeps_existing_summary(c):
                        logger.warning(f'  {name}: fnguide 수집 실패 — 기존 정본을 LLM으로 덮지 않는다, skip')
                        continue
                    web_text = fetch_web_text(page, c, llm=llm)
```

🔴 조회 컬럼에 `market` 을 추가한다 — 없으면 판정이 전부 False 가 되어 가드가 **조용히 무동작**한다.

- [ ] **Step 3: `enrich_description_sonnet.py` · `enrich_description_append.py` — 대상에서 제외**

두 스크립트는 설명만 고치므로 대상 자체에서 뺀다. 조회 컬럼에 `country,market` 을 추가하고 루프 앞에서 거른다.

```python
    skipped = [r for r in rows if keeps_existing_summary(r)]
    rows = [r for r in rows if not keeps_existing_summary(r)]
    logger.info(f'국내 상장사 {len(skipped)}곳은 fnguide 정본이라 제외')
```

- [ ] **Step 4: `enrich_top100_meta.py` — 설명만 건너뛴다**

```python
      'business_summary': (
        c.get('business_summary') if keeps_existing_summary(c)
        else (bs_clean or c.get('business_summary'))
      ),
```

조회 컬럼에 `country,market` 을 추가한다.

- [ ] **Step 5: 문법 검사**

Run:
```bash
scripts/venv/Scripts/python.exe -m py_compile scripts/enrich_company.py scripts/enrich_description_v2.py scripts/enrich_description_sonnet.py scripts/enrich_description_append.py scripts/enrich_top100_meta.py scripts/lib/companies.py
```
Expected: 출력 없음(exit 0)

- [ ] **Step 6: 커밋**

```bash
git add scripts/lib/companies.py scripts/enrich_company.py scripts/enrich_description_v2.py scripts/enrich_description_sonnet.py scripts/enrich_description_append.py scripts/enrich_top100_meta.py
git commit -m "fix(수집): 국내 상장사 회사설명을 LLM이 덮지 못하게 막는다"
```

---

### Task 3: fnguide 수집기의 캐시 무효화 누락 수정

**Files:**
- Modify: `scripts/collect_kr_snapshot.py`

`get_client()` 로 직접 UPDATE 해서 `WriteSession` 의 자동 revalidate 를 타지 않는다. 수집이 성공해도 화면은 `'use cache'` 결과를 들고 있어 낡는다. GHA 워크플로가 `NEXT_REVALIDATE_SECRET` 을 넘겨 주는데 스크립트가 쓰지 않는다.

- [ ] **Step 1: `WriteSession` 으로 전환**

`collectKrSnapshot()` 본문을 `with WriteSession() as w:` 로 감싸고, `_update_business_summary(w, company_id, summary)` 와 `_scrape_company(w, page, ticker, company_id)` 가 `w` 를 받게 시그니처를 바꾼다. 블록 종료 시 `companies` 가 자동 무효화된다.

🔴 공용 헬퍼의 시그니처를 바꾸므로 Step 3 의 호출 계약 검사를 반드시 돌린다.

- [ ] **Step 2: 문법 검사**

Run: `scripts/venv/Scripts/python.exe -m py_compile scripts/collect_kr_snapshot.py`
Expected: exit 0

- [ ] **Step 3: 호출 계약 검사**

Run: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/verify_call_contracts.py`
Expected: exit 0

- [ ] **Step 4: 커밋**

```bash
git add scripts/collect_kr_snapshot.py
git commit -m "fix(수집): fnguide 기업개요 수집이 캐시를 무효화하지 않던 것을 고친다"
```

---

### Task 4: 정본 경계 검사기 신설

**Files:**
- Create: `scripts/verify_summary_source.py`
- Modify: `AGENTS.md` (「검증 명령」)

**Interfaces:**
- Produces: CLI `python scripts/verify_summary_source.py` — 위반 0건이면 exit 0, 위반이 있으면 exit 1, 자가 시험 실패면 exit 2.

판정: 국내 상장사(`country='KR'` + `market` 있음 + `status='active'`)의 `business_summary` 가 **fnguide 원문인가**. fnguide 기업개요는 예외 없이 「동사」로 시작한다(복구 후 180/180 실측).

- [ ] **Step 1: 자가 시험을 먼저 박는다**

🔴 한국어 부분 문자열 매칭은 조용히 0건이 된다. 「위반 0건」과 「검사가 죽었다」를 화면에서 구분할 수 없으므로 실제 문장을 표본으로 박고 본 검사 **전에** 돌린다.

```python
MUST_HIT = [   # LLM 이 덮었던 실제 값 — 반드시 위반으로 잡혀야 한다
  '하이젠 RNM은 로봇 구동모듈, 모빌리티 구동모듈, 서보 시스템, 산업용 모터 사업을 전문으로 하는 기업입니다.',
  '뉴로메카는 협동로봇 중심의 산업용 로봇과 자동화 솔루션을 개발·판매하는 기업으로,',
]
MUST_MISS = [  # fnguide 실측 원문 — 잡히면 안 된다
  '동사는 2007년 설립 후 오티스엘리베이터코리아의 산업용 모터사업부문을 인수하여 시작하고,',
  '동사는 2011년 설립된 로봇 전문기업으로, 2021년 코스닥시장에 기술성장기업으로 상장함.',
]


def _self_test() -> None:
  for s in MUST_HIT:
    if is_fnguide_original(s):
      print(f'자가 시험 실패 — 위반이어야 할 문장을 통과시켰다: {s[:30]}')
      sys.exit(2)
  for s in MUST_MISS:
    if not is_fnguide_original(s):
      print(f'자가 시험 실패 — 정상 문장을 위반으로 잡았다: {s[:30]}')
      sys.exit(2)
```

- [ ] **Step 2: 검사 본체**

```python
def is_fnguide_original(text: str | None) -> bool:
  """fnguide 기업개요인가 — 예외 없이 「동사」로 시작한다."""
  return bool(text) and text.lstrip().startswith('동사')
```

대상 조회는 `lib/db.py` 경유, 위반 목록은 회사명·티커·현재 길이·앞 40자를 줄마다 찍는다. 마지막에 `위반 N / 대상 M` 을 출력하고 `sys.exit(1 if N else 0)`.

- [ ] **Step 3: 자가 시험이 실제로 무는지 확인**

`is_fnguide_original` 을 일부러 `return True` 로 바꿔 돌리면 `MUST_HIT` 가 어긋나 exit 2 가 나야 한다. 확인한 뒤 되돌린다.

Run: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/verify_summary_source.py`
Expected: 일부러 깨뜨린 상태에서 exit 2 + 「자가 시험 실패」 출력 · 되돌린 뒤 exit 0(위반 0 / 대상 180)

- [ ] **Step 4: AGENTS.md 「검증 명령」에 한 줄 추가**

```markdown
- **`verify_summary_source.py`** — 회사 설명 수집기·보강기를 고쳤으면 돌린다. 국내 상장사 설명의 정본은 **fnguide 기업개요**(「동사는…」)이고 LLM 보강이 덮으면 위반이다(2026-07-17 실사고 166곳 — 폐지된 도메인이 HTTP 200 을 돌려줘 조용히 샜다).
```

- [ ] **Step 5: 커밋**

```bash
git add scripts/verify_summary_source.py AGENTS.md
git commit -m "feat(검사): 국내 상장사 회사설명이 fnguide 정본인지 기계로 판정한다"
```

---

### Task 5: 국내 상장사 180곳 설명 복구 — ✅ 2026-09-16 완료

**Files:** 없음(데이터 작업)

- [x] **Step 1: 복구 실행** — `collect_kr_snapshot.py` 전량 실행. `business_summary=OK` **180건** · 미수집 0 · 폴백 0 · 로드 실패 0.
- [x] **Step 2: DB 확인** — 국내 상장사 180곳 **전부** 「동사」로 시작. 평균 450자(최소 405자).
- [ ] **Step 3: 화면 확인**

`browse` 스킬로 `/humanoid` 에서 하이젠알앤엠을 펼쳐 설명이 「동사는 2007년 설립 후 오티스엘리베이터코리아…」로 바뀌었는지 눈으로 본다. 🔴 창을 숨겨 띄우고 끝나면 닫는다.

⚠️ Task 3 이 아직 안 끝난 상태에서 복구를 돌렸으므로 **캐시가 자동 무효화되지 않았다.** 화면이 옛 값을 보이면 `revalidate_tags(['companies'])` 를 수동으로 부른다.

---

### Task 6: 휴머노이드 비상장 9곳 제품·설명 정정

**Files:**
- Create: `scripts/_fix_humanoid_unlisted_meta.py` (일회성 — 끝나면 `_archive/` 이동)

대상: 퓨트로닉 · HD현대로보틱스 · 로브로스 · 에이딘로보틱스 · 에이로봇 · 엔알티 · 테솔로 · 한화로보틱스 · 홀리데이로보틱스

조사는 2026-09-16 에 완료했다(퍼플렉시티 + 공식 홈페이지 직접 확인). 원자료는 세션 스크래치패드의 `pplx_*.md`.

- [ ] **Step 1: 제품을 대표 제품군 5~8개로 묶는다 (결정 5)**

개별 모델명을 나열하지 않는다. 예 — HD현대로보틱스는 95종 전량이 아니라 「산업용로봇 HDR 시리즈」 「협동로봇 HDC 시리즈」 「FPD 로봇」 「로봇 제어기 Hi 시리즈」 「부가설비」 처럼 묶는다.

- [ ] **Step 2: 제품 카테고리는 DB 정본에서 파생시킨다**

🔴 카테고리 목록을 스크립트에 박지 말 것 — `scripts/lib/product_categories.py` 의 `fetch_product_categories()` 가 정본이다. 매핑이 없으면 트리거가 `'기타'` 로 정규화한다.

- [ ] **Step 3: 조사에서 확정된 정정 항목**

**퓨트로닉**
- 공식 제품 7종 중 **EV Infra(전기차 충전기) 누락**을 채운다
- 「정밀 액추에이터(모터·센서·감속기·제어기 수직통합)」는 제품이 아니라 **설명**이므로 제품 칸에서 뺀다. 대신 내재화 모터를 `모터` 카테고리 제품으로 싣는다
- **로봇용 액추에이터**를 넣되 **양산·수주는 미확인**이므로 설명에서 단정하지 않는다(2027년 1월 CES 공개 계획 단계)
- 「상장 계열사는 스모트로닉」을 고친다 — 2026-07-19 지분 전량이 지주사 오트로닉으로 넘어가 **자매회사**가 됐다
- **블랙스톤의 지분 과반 인수**(2026-07-19, 기업가치 약 1조 원, 고진호 회장 유임)를 반영한다
- 「미국 텍사스 2025년 가동」은 2024년 시점의 **계획**이고 실제 가동 보도는 없다 — 단정하지 말 것
- `ticker` 가 `'퓨트로닉'` 이다(다른 비상장사는 전부 비어 있다) — **NULL 로 되돌린다**

**한화로보틱스** (결정 6)
- 협동로봇 HCR 7종 · 이동로봇(AGV/AMR) · 모바일 매니퓰레이터를 만드는 **완제품 제조사**다. 휴머노이드 제품은 없고 개발 중인 「양팔 모바일 매니퓰레이터」가 가장 근접하다 — 설명을 사실대로 적고 휴머노이드 제품이 있는 것처럼 쓰지 않는다

**엔알티**
- 🔴 기존 설명(정수기 부품 + 초정밀 엔코더·센서)은 **사실이었다.** 공식 홈페이지에 네 개 제품 카테고리가 나란히 있고 엔코더는 `NRT Sensors` 브랜드로 운영한다. **고치지 말 것**

**나머지 6곳** — 조사 보고의 공식 홈페이지 제품을 제품군으로 묶어 반영한다. 「미확인」으로 표시된 항목은 **DB 에 넣지 않는다.**

🔴 **고객사는 건드리지 않는다**(상위 계획서 결정 12).

- [ ] **Step 4: 정정 스크립트를 파일로 저장해 실행**

🔴 인라인 `-c` 에 한글을 넣지 말 것(조용히 깨진다). `WriteSession` 안에서 UPDATE 한다.

```python
with WriteSession() as w:
    for name_kr, patch in FIXES.items():
        w.table('companies').update(patch).eq('name_kr', name_kr).execute()
```

- [ ] **Step 5: 적재 후 확인**

정정 대상 9곳의 `products` · `business_summary` · `ticker` 를 다시 조회한다.
Expected: 제품 칸에 설명문이 남아 있지 않고, 카테고리가 정본 11종(+기타) 안에 있으며, 퓨트로닉 `ticker` 가 NULL.

- [ ] **Step 6: 화면 확인 후 스크립트 보관**

`/humanoid` 에서 퓨트로닉을 펼쳐 제품·설명을 눈으로 본 뒤 스크립트를 `scripts/_archive/` 로 옮긴다.

---

### Task 7: 시가총액 수집 복구

**Files:**
- Modify: `scripts/collect_prices_live.py`

- [ ] **Step 1: 실패를 침묵시키지 않는다**

현재는 `cap_df.empty` 일 때 로그 없이 `None` 이 되고, `None` 이면 갱신 payload 에서 빠져 **과거 값이 그대로 남는다**. 주가는 정상 갱신되므로 화면에서 구분되지 않는 게 이 결함의 핵심이다.

`cap_df.empty` 와 `raw <= 0` 에 각각 `logger.warning` 을 붙이고, 루프 종료 후 **실패가 대상의 절반을 넘으면 `sys.exit(3)`** 으로 끝낸다(부분 실패는 성공으로 두되 전면 실패는 알린다).

- [ ] **Step 2: GHA 에서 원인을 가른다 (결정 7)**

🔴 **로컬로는 못 가린다** — 로컬은 KRX 접근이 통째로 막혀 주가 조회까지 죽는다(대조군 실측). GHA 는 주가가 정상이므로 거기서 실험해야 한다.

진단 스텝을 워크플로에 임시로 넣어 `workflow_dispatch` 로 돌린다. 확인할 것:

```python
pykrx_stock.get_market_cap(DATE, DATE, '005380')          # 종목 단위 — 지금 죽은 것
pykrx_stock.get_market_cap_by_ticker(DATE, market='ALL')  # 시장 전체 — 살아 있나
pykrx_stock.get_market_ohlcv(DATE, DATE, '005380')        # 대조군 — 이건 산다
```

시장 전체 조회가 살아 있으면 **하루 한 번 전체를 받아 티커로 매핑**하는 편이 호출 수도 180회에서 1회로 줄어 낫다. 둘 다 죽으면 KRX 응답 형식 변경이므로 그때 네이버 JSON API 를 대안으로 꺼낸다(정상 응답은 확인해 뒀다 — `https://m.stock.naver.com/api/stock/<ticker>/integration` 의 `marketValue`).

- [ ] **Step 3: 고친 경로로 실측**

Expected: `market_cap=None` 이 179건에서 줄어든다.

- [ ] **Step 4: 값 검증**

현대차 시가총액이 **75조원대**로 들어오는지 확인한다(2026-09-16 네이버 실측 75조 1,461억). 🔴 지금 DB 값 127.8조는 과거 주가 62만원대 시절 값이 멈춘 것이다.

- [ ] **Step 5: 커밋**

```bash
git add scripts/collect_prices_live.py
git commit -m "fix(수집): 시가총액 전면 실패가 조용히 낡은 값을 남기던 것을 고친다"
```

---

### Task 8: 문서 갱신·핸드오프

**Files:**
- Modify: `docs/gotchas-data-collection.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: 함정 기록**

`docs/gotchas-data-collection.md` 에 증상 → 원인 → 처방으로 적는다.

- **폐지된 도메인은 404 가 아니라 HTTP 200 안내 페이지를 준다** — 스크레이퍼가 「내용 없음」으로 읽고 폴백 경로로 조용히 샌다. 실패로 잡히지 않으므로 **1차 출처가 실패했을 때 폴백이 정본을 덮게 두지 말 것.**
- **보강 대상 판정과 저장 항목을 같이 묶지 말 것** — 제품이 비었다는 이유로 대상이 됐는데 설명까지 덮었다.
- **수집기가 성공해도 revalidate 가 없으면 화면은 낡는다** — `get_client()` 직접 UPDATE 는 `WriteSession` 의 자동 무효화를 타지 않는다.
- **「값이 있다」가 「값이 최신이다」는 아니다** — 시가총액은 실패 시 payload 에서 빠져 과거 값이 남았고, 주가는 정상 갱신돼 화면에서 구분되지 않았다.
- **로컬에서 수집기가 죽는다고 원격도 죽은 것은 아니다** — 로컬 KRX 는 전면 차단이라 대조군까지 죽는다. 원인을 가르려면 **대조군을 함께 돌려** 환경 문제인지 대상 문제인지 먼저 나눈다.

- [ ] **Step 2: `HANDOFF.md` 맨 위에 새 블록 추가**

직전 블록은 `## 이전 상태 …` 로 강등한다. 재개 지점을 반드시 남긴다.

- [ ] **Step 3: 개인 메모리 갱신**

비자명한 것만 — 회사 설명의 정본이 **둘로 갈린다**는 구조와 그 경계가 무너진 경위.

- [ ] **Step 4: 커밋**

```bash
git add docs/gotchas-data-collection.md HANDOFF.md docs/superpowers/plans/2026-09-16-company-summary-recovery.md
git commit -m "docs(함정): 폐지 도메인이 HTTP 200을 주면 폴백이 정본을 조용히 덮는다"
```
