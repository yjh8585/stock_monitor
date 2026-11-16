# 경위: Architecture.md

[`Architecture.md`](../Architecture.md) 에서 날짜 붙은 경위·실측을 **글자 그대로** 옮겨 온 곳이다(2026-11-09 · 본문 상한 초과).
구조·규칙은 본문에 있고, 여기는 「왜 그렇게 됐나」를 본다. 절 제목은 본문과 같다.

## `/oem` 프리렌더 집계 구체화 뷰 — 일반 뷰로는 부족했다

🔴 **일반 뷰로는 부족했다(2026-08-03 재발).** 일반 뷰는 계산을 옮긴 게 아니라 **이름만 붙인 것**이라, 조회할 때마다 12.3만 행을 Seq Scan + 집계했다. 20260714000001이 줄인 것은 앱으로 가는 **행 수**(12.2만 → 4천)일 뿐 DB 계산 비용은 그대로였고, 문서만 고친 커밋의 배포가 같은 이유로 다시 깨졌다. → **구체화 뷰(materialized view)로 전환**해 결과를 실제로 저장한다. 실측: `.eq('year', …)` 조회가 **80ms(Seq Scan 12.3만) → 5.4ms(Bitmap Index Scan)**.

## `oem_competition_monthly_view` — 일반 뷰로 만들었다가 같은 날 구체화 뷰로

- 🔴 **일반 뷰로 만들었다가 같은 날 구체화 뷰로 갈아탔다.** 일반 뷰는 전체 조회 **4,867ms** 로 PostgREST anon statement timeout(57014)에 걸려 **판매 추이 차트가 에러 없이 전부 비었다**. 원인은 ①`MAX(year_month)` 서브쿼리(48만 행 스캔 780ms) ②`model=ANY(배열)` 조인 뒤 `country` 필터가 인덱스를 못 타 루프마다 2,413행 폐기. 구체화 후 **23ms**. `/oem` 집계 뷰(§7-E)가 2026-08-03에 겪은 것과 **같은 실패 모드**다.

## `stock_quotes_5min` — 보존 30일 이전의 누적

2026-08-03 이전엔 삭제 로직이 없어 2.5개월에 10.9만 행(26MB)까지 누적됐다.

## `/humanoid` 상세 — 고객사를 수집하지 않는다는 결정이 조용히 깨진 실례

🔴 **화면에 안 보이므로 위반이 조용히 일어난다** — 2026-08-25 에 `enrich_company.py --page humanoid` 가 16사의 고객사를 채웠고 DB 를 직접 세기 전까지 아무도 몰랐다.

## 부록 A. 최근 주요 변경 (2026-05-20 ~ 2026-05-23)

- **status='hidden'** 도입 (`delisted` → `hidden`)
- 일본 회계연도 한국식 -1 보정 (20260521000002, 20260521000003)
- 부품사 TOP100 뷰 미래 가드 (20260521000001)
- DART corp_code 자동/수동 매핑 24개
- 6차 워크플로 stable (`os._exit(0)` + yfinance 미래 period_end 가드)
- 그룹 분류 50개 정리 (사람인 NICE 기반)
- **homepage_url** enrich_company에 수집 추가 + onboard_company.py 도입
- **챗봇 PnL 외부 전송 차단** (2026-05-23): `query_pnl` 도구 + system-prompt PnL 카탈로그(고객사·공장·제품 명단) 완전 제거. `pnl_entries`·`pnl_cost_structure` RLS 정책 삭제(anon 차단) + admin client 전용 전환 (20260523000002). `chat_audit_log` 신규 — 모든 챗봇 도구 호출 1년 보존 (20260523000003). 챗봇 입력창에 외부 전송 경고 배너 추가.

## 버킷 `reports-video` — 파일당 상한 · 재인코딩 실측

- 🔴 **파일당 상한은 버킷의 `file_size_limit` 이 아니라 프로젝트 전역 `fileSizeLimit` 이 결정한다** — 버킷에 512MB 를 걸어도 전역이 50MB 면 업로드가 **413 EntityTooLarge** 로 거부된다(2026-08-28 실측). 전역값은 Management API `GET/PATCH /v1/projects/<ref>/config/storage` 로만 보이고 SQL 로는 안 보인다. 2026-08-28 에 50MB → **512MB** 로 올렸다(조직 플랜은 Pro).
- ⚠️ 용량이 문제되면 `-preset fast -crf 28` 로 재인코딩한다. 단 **움직임 많은 실사는 crf 24 로도 절반밖에 안 줄어든다**(실측 328MB → crf24 약 190MB / crf28 129MB) — 화질 손실 대비 이득이 작으니 제약이 실제로 있을 때만.

## `country = 'China'` — 글로벌 출하 실측 (2026-09-11)

본문 원문: 「2026-09-11 실측 — 2025년 34.35백만 = CAAM 총 판매 34.40백만과 일치, 그중 수출 7.098백만. China 의 BYD 4,602,436 = BYD **글로벌** 총 판매 4,602,400」 · 「2025 전 국가 합 98.5백만 vs 실제 글로벌 91.9백만」.

## 부록 C — AGENTS.md 에서 이관한 사유 (2026-08-25)

> 이관 사유: AGENTS.md 가 44,384B 로 상한 39,000B 를 2주째 넘고 있었고, 이 절 하나가 20,029B(45%)였다.
> AGENTS.md 자신의 규칙 — _"구조 설명이 길어지면 Architecture.md로 옮기고 여기선 참조한다"_ — 을 따랐다.

## `naver_market_cap.py` — 쓰게 된 경위 (2026-09-16)

2026-09-16 실측에서 KRX 시총 계열의 종목 단위·시장 전체가 둘 다 죽고 주가만 살아 있었다.

## `marklines-adhoc-fetch` — 만든 경위

유효 쿠키가 Secrets 에만 있고 값을 꺼낼 수 없어 만든 우회 통로다 — 로컬 추출은 Chrome 127+ ABE·Chrome 150 CDP 차단으로 전부 막혔다.

## `financials.consolidation` — 믿을 수 없는 이유 (2026-09-11)

위 서술은 «적재 정책» 이고, 값 자체는 믿을 수 없다 — 연결 판정을 보고서명이 아니라 실제로 고른 본문 노드로 바꾼 것이 2026-09-11 이라, 그 이전 행(`separate` 887행)은 낡았다. **읽는 코드도 없다**(챗봇 도구는 select 조차 안 한다). 되받으려면 DART 호출이 몇 시간인데 화면에는 변화가 없어 안 고쳤다.

## `trg_skip_identical_update` — 실측 배경 (2026-08-03)

실측 배경(2026-08-03): `exchange_rates` 8,165행에 누적 UPDATE 521만 회(행당 638회), `market_series_daily` 27,784행에 1,822만 회. WAL이 하루 1.65GB씩 생성돼 Supabase Free 용량 초과의 주원인이 됐다.

## `/humanoid/reports` 상세 — 드롭다운에도 제외 배열을 넘기게 된 경위 (2026-10-31)

출처 쪽을 빠뜨려 감춘 경영표준 글의 출처 이름이 드롭다운에 새었다(2026-10-31).

## `/humanoid/research` 상세 — 리포트 수집·요약을 GHA 로 옮기지 말 것 (2026-08-24·25)

🔴 이 결정은 **2026-08-24·25 이틀 연속 어겼다가 되돌렸다.**

## Vercel 함수 지역 `sin1` — 옮긴 경위 (2026-11-13)

Supabase 가 `ap-southeast-1`(싱가포르)인데 함수는 기본값 iad1(미국 동부)에서 돌았다(응답 헤더 `x-vercel-id` 가
`icn1::iad1::…`). 조회 한 번마다 태평양을 왕복해, 로그인 화면(요청 시점 렌더 · `'use cache'` 가 인스턴스 메모리라
서버리스에선 자주 비어 있음)이 몇 초씩 걸렸다. 사용자 선택으로 `vercel.json` `regions: ["sin1"]` 로 옮겼다.

## `oem_competitor_set` 모델명 — 표기 불일치 정정 (2026-08-13)

브리프 초안 대비 실측 표기 불일치 4건을 `20260813000004`로 정정했다: `avante_ex_china/USA`는 `'Avante (Elantra)'`만
존재(`'Avante'`는 Korea 전용 표기), `avante_ex_china/Korea`는 반대로 `'Avante'`만 존재, `niro/Europe` 경쟁모델은
`'Puma'`→`'Ford Puma'`·`'2008'`→`'Peugeot 2008'`.

## `oem_competitor_set` — 배열째 교체 UPDATE 가 유효 항목 2건을 지운 경위 (2026-08-13)

같은 `20260813000004`가 각 행의 `target_models`/`competitor_models`를 통째로 재작성하며 실제로는 유효한 항목 2건이 함께 빠졌다(코드 리뷰 2건, 모두 재검토자가 DB 직접 조회로 확정):

- `niro/Europe`의 `'Captur'`(르노 캡처, 유럽 14개국 중 10개국에서 202501~ 데이터 존재) — `20260813000005`로 `ARRAY['Kona','Captur','Ford Puma','Peugeot 2008']`로 복원.
- `avante_china/China`의 `'Elantra Yuedong'`(오타가 아니라 MarkLines 상 별개 항목 — `'Elantra/Yuedong/Langdong/Elantra 2016'`과 202001~202312 41개월간 서로 다른 판매수치로 공존, `lib/oem/aggregate.ts`의 `OTHER_MODEL_TARGETS`도 이미 두 표기를 합산) — `20260813000006`로 `ARRAY['Elantra/Yuedong/Langdong/Elantra 2016','Elantra Yuedong']`로 복원.

두 번째 누락의 원인: `'Elantra Yuedong'`이 202312에서 끊겨 `.gte('year_month', 202501)` 필터에 걸리자 "China엔 없음"으로 오판해 위 누락이 발생했다.

## `outlook_prompt.py` — v1 실패 원인

v1 실패 원인은 입력이 '모회사 주식 뉴스 헤드라인 8개'뿐이라 모델이 사전지식만 쓴 것이었다(그래서 매주 돌려도 내용이 안 바뀌었다).

## `verify_revalidate_tags.py` 역방향 검사 — 더한 경위 (2026-09-09)

역방향 검사는 2026-09-09 추가분이다. 초판(①②만)이 `hyundai_retail_sales` 구멍을 **통과시킨** 것이 계기다 — 태그 `oem-hyundai-retail` 은 TS 에도 `ALL_TAGS` 에도 있었지만 그것을 부르는 매핑이 없었다. 첫 실행에서 **누락 태그 9개**를 잡았다(눈으로 찾은 건 2개였다).

## `posts` RLS — 옛 정책 `posts_select_all` 을 바꾼 이유 (20260806000001)

그 전 정책 `posts_select_all`(USING(true))은 anon 키만으로 전 보고서를 덤프할 수 있어 사외비 문서를 담을 수 없었다.

## 비상장 기업가치 수집 경로 `enrich_company.py` — 신설 전 (2026-08-25)

그 전엔 seed 마이그레이션 하드코딩이 전부라 갱신 경로가 없었다.

## `product_category_map` — 2026-09-11 실측 때의 낡은 행 수

문서에 적혀 있던 옛 행 수 74행은 로봇 시드 `20260824000002`·`20260824000005` 이전의 낡은 값이었다(2026-09-11 실측 141행).

## `product_categories.py` — 목록을 박지 말고 도메인을 가르는 이유 (2026-11-16 본문에서 이관)

- 목록을 수집기에 박으면 안 되는 이유: UI 에 이미 사본이 3벌 있다(사본이 늘수록 갈린다).
- `split_domains()` 로 자동차/로봇을 가르는 이유: 22종을 통째로 LLM enum 으로 주면 자동차 부품이 로봇 칸으로 새고 «맞던 값까지» 망가진다 → [`docs/gotchas-data-collection.md`](../gotchas-data-collection.md).
