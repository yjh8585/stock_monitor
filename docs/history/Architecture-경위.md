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
