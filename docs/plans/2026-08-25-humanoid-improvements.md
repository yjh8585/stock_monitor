# 휴머노이드 페이지 개선 (2026-08-25)

## 사용자 지시 원문

> 휴머노이드 페이지 수정사항.
> 1) 기업 페이지.
>
> - 회사설명, 뉴스, 웹페이지/홈페이지 링크, 실적 등 다 업데이트 된거 맞어? 확인해 보고 모두 업데이트 해. 주가 정보가 있는 상장사인데 실적 수집이 안된 회사도 있고, 뉴스가 없는 회사도 있고, 회사설명이 영어로 된 회사도 있고 다 제각각이야.
> - 부품사 top100, 국내자동차 등에 사용되는 도구와 로직 활용해서 똑같이 만들고 업데이트 해.
> - gha에 휴머노이드 회사 자동수집도 포함시켜.
>
> 2) 증권사 리포트.
>
> - pdf 링크만 넣어놓으면 어떻게 해? 보고서 페이지 처럼 정리를 해놔야지. 정리 할때 위클리 등 관련성 떨어지는 거 제거하고 필요한 것만 정리해.

추가 지시 (2026-08-25, 같은 세션):

> 회사설명 영어로 되어있는 것은 한국어로 번역해서 넣기로 되어있지 않나?

> 기업가치는 기존의 GHA에서 수집 안하는 데이터 인데 이건 어떻게 수집해?

## 확정된 결정 (AskUserQuestion 2026-08-25)

| # | 결정 | 사용자 선택 |
|---|---|---|
| 1 | 요약 없는 비관련 리포트 처리 | **DB에서 삭제** |
| 2 | 화면 형태 | **목록 + 상세 페이지**(`/humanoid/research/[id]`) |
| 3 | GHA 범위 | **리서치 수집 + 기업 보강** (요약은 헤드리스 구독 인증이라 GHA 불가) |

## 진단 (실측 2026-08-25)

### 기업 데이터 (67사 · `company_pages.page='humanoid'`)

| 항목 | 상태 | 원인 |
|---|---|---|
| 홈페이지 | 67/67 | 정상 |
| 주가 | 상장 47/47 | `collect-prices` 매일 전역 실행 |
| 회사설명 | 한국어 13 · 없음 32 · 영어 22 | ①`enrich-company`는 월 1회라 미실행 ②`_missing_meta()`가 "비었나"만 봐서 **영어는 영원히 미보강** |
| 실적 | KR 상장 12사 0건 · 해외 다수 1건 | `collect-financials`가 1/4/7/10월 15일 스케줄 → 다음 실행 10/15 |
| 뉴스 | 25사 0건 | 비-KR **비상장**은 `collect_news`가 무조건 yfinance로 보내는데 ticker가 없다 |
| 기업가치 | 비상장 21사 중 8사만 · `asof` 최고 2022-07-25 | **수집 경로 자체가 없다** — seed SQL 하드코딩이 전부 |

### 증권사 리포트 (`research_reports` 407건)

- 요약 77건뿐. **322건이 PDF 링크만** → 화면을 덮는다.
- 기존 선별 규칙(`is_summary_target`)은 종목 리포트를 **추적 종목만** 통과시켜, 클로봇·씨메스·큐렉소·피앤에스로보틱스·나우로보틱스·한국피아이엠 등 로봇 기업 리포트를 놓친다.
- 요약 5건이 `RULES-OK:` 훅 탈출 문구로 시작 (헤드리스 CLI 출력이 그대로 저장됨).
- `target_price` 단위 혼재 — 26건이 1000 미만(로보티즈 35.6만원 → `35`).
- `opinion` 표기 4종 갈림 — `Buy` / `BUY` / `Hold` / `매수`.

## 작업

### A. 기업 데이터

- **A1** `enrich_company.py` — `_missing_meta()`에 한국어 판정 추가(영어 설명 재보강). 번역이 아니라 웹검색 재조사(출처 규칙 준수).
- **A2** `enrich_company.py` — 스키마·프롬프트에 `valuation_usd`·`funding_total_usd`·`valuation_asof` 추가. 근거 없으면 null, `asof`가 더 최신일 때만 갱신.
- **A3** `collect_news.py` — 비-KR 비상장(ticker 없음)은 Google News RSS 폴백.
- **A4** 실행: `collect_financials.py` → `enrich_company.py --page humanoid` → `collect_news.py`
- **A5** GHA `collect-humanoid.yml` 신설 (주 1회 + 수동) — 휴머노이드 67사 실적·보강·뉴스.

### B. 증권사 리포트

- **B1** `scripts/lib/naver_research.py` — 선별 규칙 재정의. 정기물 제외 + (종목: 추적 OR 제목 로봇어 / 산업: 제목 로봇어). 관련 156건 / 삭제 251건.
- **B2** `collect_naver_research.py` — 비관련 행은 **애초에 저장하지 않는다**(안 그러면 삭제가 다음 실행에 되살아난다).
- **B3** 비관련 251건 DELETE.
- **B4** 요약 저장 전 `RULES-OK:`/`PLAN-OK:` 접두 방어 + 기존 5건 정리.
- **B5** `target_price` 단위 정규화 · `opinion` 표기 통일.
- **B6** 남은 156건 중 미요약 79건 요약 (헤드리스 세션 한도 → 나눠 실행).
- **B7** UI — 목록 카드 + `/humanoid/research/[id]` 상세(`MarkdownView` 재사용).
  추가 지시(2026-08-25): 필터에 **종목 드롭다운**도 넣는다(증권사 드롭다운은 이미 있음).
- **B8** GHA `collect-naver-research.yml` 신설 (매일 수집 · 요약 제외).

## 검증

- `npm run check-all`
- `scripts/venv/Scripts/python.exe -m pytest scripts/lib -q`
- `scripts/venv/Scripts/python.exe scripts/verify_docs.py`
- dev 서버로 `/humanoid`, `/humanoid/research`, 상세 페이지 확인
