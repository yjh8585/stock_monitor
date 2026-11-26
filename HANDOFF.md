# HANDOFF

다음 세션이 그대로 이어받기 위한 인수인계 기록. **맨 위가 최신**이고, 새 블록을 쓸 때
직전 블록은 `## 이전 상태 …` 로 강등한다.

**여기엔 최근 10블록만 둔다.** 그보다 오래된 블록은 지우지 않고
[`docs/handoff-archive-2026.md`](./docs/handoff-archive-2026.md)(현재 **56블록** · 2026-11-27 실측)로 옮긴다.

---

## 최신 상태 · 재개 지점 (2026-11-27 새벽, **휴머노이드 「모터」 탭 신설 · 국내 모터회사 54곳 등록 · 덱은 구조안 승인 대기**)

- 사용자 지시(2026-11-26 · 원문 = `docs/plans/2026-11-26-motor-companies_최초지시.md`): 국내 모터회사 조사 → `/humanoid` 아래 「모터」 탭(표) + 「국내 모터회사 현황」 덱. 목적 = 한세모빌리티(기계 부품만)의 전장·로봇 진출 M&A 후보 찾기. 밤사이 진행·master 푸시는 사용자 사전 승인(밤 질문 7번: check-all·화면 캡처 통과 시 — **그 밤의 이 작업에만** 해당. 뒤의 정정 푸시는 다시 묻는다).
- 한 것(계획 `docs/superpowers/plans/2026-11-26-motor-tab.md` Task 1~8 · 결정 이행·실행 중 판정 53줄 = 같은 폴더 `_결정이행.md`): 스키마 `20261126000001`(motor_types·supply_history·페이지 트리거·`motor_stocks_view`) · 시드 `20261126000002`(54곳 = 기존 24 UPDATE + 신규 30 INSERT · 「확인」 공급 이력 32건만) · `/humanoid/motor` 화면(`DomesticTable variant="motor"`) · 신규 상장 6곳 재무·기업개요. 자동차 납품사만 `/domestic` 에도 나간다.
- 검증(11-27 03:39): `npm run check-all` exit 0(vitest 785) · `pytest scripts/lib` 1126 · 명단 `validate` 위반 0 · 화면 캡처는 Task 7 에서 확인(장부) · 이 블록 커밋과 함께 master 푸시.
- 명단 정본은 git 밖 `참고/모터회사/motor_companies.json`(「추정」 포함 · 덱 재료) · 사람이 읽는 요약 = `참고/모터회사/명단요약.md`(5절 = Codex 원문 대조로 바뀐 것). 메인이 Codex 판정을 뒤집은 ①퓨트로닉→글로벌 완성차 ②신라공업→가렛 모션은 «공급 이력 한 줄»의 등급 판단이다 — 틀렸다고 보면 JSON 에서 그 줄을 「추정」으로 내리고 아래 「명단 정정」 순서로 새 마이그레이션을 내면 화면에서 그 이력만 빠진다(회사 행은 남는다).
- 🔴 시드는 운영 DB 에 Management API 로 먼저 들어갔다(11-27 03시 · schema_migrations 이력 version 20261126180349 수동 INSERT). 최종 검토가 잡은 Critical — `motor` 페이지가 붙은 로봇사 5곳·설명 빈 신규 30곳이 정기 GHA 의 LLM 메타 보강 대상이 됨 — 을 `_skips_meta` 로 고쳤다(deeace15 · 함정 = `docs/gotchas-data-collection.md` 휴머노이드 5번). Codex diff 검토 반영 = 0546be9f.
- 🔴 하지 말 것: 이미 적용한 시드 `20261126000002` 를 다시 돌리거나 schema_migrations 에 다시 넣지 않는다(정정은 새 번호) · 「추정」 공급 이력을 운영 DB 에 넣지 않는다 · (라) 승인 전 기존 회사 `products` 를 고치지 않는다(승인 뒤에도 덧붙이기만) · `_skips_meta` 를 지우거나 우회하지 않는다 · 주가가 비어도 로컬 KRX 로그인을 되풀이하지 않는다(11-27 4회 실패 · 계정 잠금 우려).
- 10:45 사용자에게 물을 것(답은 `docs/plans/2026-11-26-motor-companies_최초지시.md` 에 날짜 붙여 원문 추가 · 결정은 `_결정이행.md`):
  - (가) `Architecture.md` 상한 초과(155,749B > 150,975B · 모터 작업 전에도 153,848B) — 경위·실측 서술을 `docs/history/Architecture-경위.md` 로 옮겨 줄일지 vs 보류. `verify_docs.py` 는 check-all 밖이라 보류해도 푸시는 안 막힌다.
  - (나) 결정 7 원안은 「DB 에 두 등급 저장, 뷰가 「확인」만」(설계서 100행). `companies` 를 비로그인(anon)이 읽을 수 있어 운영 시드엔 「확인」만 넣었다 → ① 이 저장 방식 사후 승인 ② 승인하면 DB CHECK 로 「추정」 저장을 거부할지(새 마이그레이션) — 둘을 따로 묻는다.
  - (다) 덱 구조안 v1 — `../PPT/보고서/12.국내모터회사/2.작업/_명세/_구조확정_v1.md`(본문 14장+요약 1·부록 6 · 1순위 애드테크·브이씨텍·위즈진 · 「잠정」 표시는 Codex 대조·재무 수집으로 이제 확정 가능).
  - (라) 따로 묻는다: ① 기존 24곳 `products` 에 모터 제품 덧붙이기(덧붙이면 `/domestic` 제품 칸·제품군 필터도 바뀜) ② 공급 이력 승격 — 이노빌→씨에이치모터스(전동 3륜 운반차 · 올리면 이노빌이 `/domestic` 에 새로 나온다)·민맥스→현대자동차(품목 미특정). 근거 = `명단요약.md` 5-3 아래 문단.
- 🔴 다음 명단 정정 순서(정본 = `scripts/build_motor_seed.py` 첫머리 사용법): 레포 루트에서 ① Supabase 에서 `select id, name_kr from companies where name_kr = …` 로 이미 등록된 회사의 id 를 하나로 확인(0건·여러 건이면 멈추고 사용자에게) → JSON `existing_company_id` 에 넣는다 — 신규 INSERT 는 `name_kr` NOT EXISTS 로 건너뛰어, 비워 두면 정정이 조용히 안 들어간다 ② `validate` ③ `emit <json> supabase/migrations/<다음 번호>_….sql` ④ 생성 SQL 을 읽고 적용.
- 알아 둘 것: LG이노텍·엘지마그나가 `/domestic` 기본 표(매출 100위+한세모빌리티)에 새로 들어간다 · 로컬 주가 수집 실패(이번 변경과 무관 — KRX 로그인 · yfinance curl 77 = 한글 경로 인증서).
- 재개 지점:
  1. 평일 09:00 뒤 GHA `collect-prices-live.yml`(평일 매시 · KST 09~15시와 22~06시) 실행이 성공했는지 `gh run list --workflow collect-prices-live.yml -L 3` → Supabase 에서 `select ticker, last_price, last_updated_at from motor_stocks_view where ticker in ('033200','052710','011070','377330','059120','496320')` 로 `last_updated_at` 이 그날인지. 빈 종목·실패 실행은 로그와 함께 사용자에게 알린다(로컬 재수집 금지).
  2. 10:45 질문 (가)~(라).
  3. (다) 승인 뒤 덱 — 별도 계획서로(계획 「다음 계획」 절). 착수 전 PPT `docs/gotchas-research.md` 원천 6종 점검표(1번 = 사내 지식위키) · 배수를 넣기 전 `measured-not-proxy` · `명단요약.md` 5-5 대주주 8곳 DART 원문 재확인 · 매출 구간을 운영 DB `financials`(최근 연간 매출)로 다시 나눈다(구조안의 구간 미확인 12곳). 저장 = `../PPT/보고서/12.국내모터회사/`. (라) 답이 덱에 닿는지도 본다.
  4. 아침 보고 뒤 장부 폴더 `.superpowers/sdd/2026-11-26-motor-tab/` 삭제(판정은 `_결정이행.md` 에 사본이 있다 · git 밖 폴더라 승인 없이 지워도 기록 손실 없음).

## 이전 상태 · 재개 지점 (2026-11-26, **MarkLines 첫 수동 적재 · 판매·생산 받는 주소 변경 반영**)

- 사용자가 파니 월요일 알림대로 브라우저에서 엑셀 6개를 받음 → `import_marklines_manual.py`(dry-run 후 본 적재) 종료 0. 판매·생산·중국 배기량·수출·승용차 2026 적재, 승용차 2025 는 「변경 없음」. 교차 검증 불일치 0. DB 6표 최신 월 = 202610(MCP 조회).
- 사용자 알림(2026-11-26): MarkLines 판매·생산 페이지 주소가 `…/vehicle_sales/member` · `…/vehicle_production/member` 로 바뀜(옛 `search?rf=left_menu`). 반영 = 알림 문구 agents `apps/orchestrator/src/marklinesRemind.ts`(`5ad4bad3` · 시험 추가) + `docs/oem-collection.md` 「수동 적재」 표(`d8f8a41e`). 봇은 tsx 로 부팅 때 한 번 읽어 재기동함(15:42 · 루프 PID 유지).
- 옛 주소가 남은 곳: 꺼 둔 자동 수집기(`sync_oem_excel.py` · `sync_oem_production_excel.py` · `fetch_marklines_adhoc.py`)와 옛 spec — 약관상 다시 켜지 않는 코드라 그대로 둠.
- 재개 지점: 남은 일 = (11-25 블록의) `Architecture.md` 상한 정리 1건. 다음 월요일(12-01) 알림에 member 주소가 실렸는지 한 번 보면 된다.

## 이전 상태 · 재개 지점 (2026-11-25, **손익 2-2 경비관리 재배치 · 삼정KPMG 26회 GAES 보고서 게시(리포트 179)**)

- (1) 손익 2-2 「전사 고정비·변동비 구조」 경비관리 보기 — 사용자 지시: 상각비합계를 경비관리 바로 아래(매출원가 위)로 · 매출원가·판관비 중분류에 「(상각비 제외)」 · 외주가공비(매출원가›경비)는 인건비합계로 · 운반비는 상각비합계 바로 아래 · 「개발서버 띄우지 말고 바로 수정한 뒤 배포하고 프로덕션에서 확인」. 커밋 `7e83f489` 푸시 · 프로덕션 확인(행 순서 · 합계 3식 참 — 금액은 출력 안 함). 개별관리 = 재료비 + 인건비합계만 남았다.
- (2) 사용자가 준 PDF(`Downloads/삼정KPMG-26회-…-20261120.pdf`, 50쪽 · 글자 전부 그림) → 리포트 **179** 「움직이는 과녁의 시대 — 자동차 경영진 775명이 본 다섯 가지 전환」(분류 시장 · 원문 링크 kpmg.com/kr/ko/insights/eri/2026/gtl-1120.html · 발행일 2026-11-20). 그림 24장 Storage `reports/kpmg-gaes-26-2026-11/`. 프로덕션 `verify.py --ids 179` = ALL_OK(그림 24/24 · 별표 0).
  - 그림 PDF 라 서브에이전트 5명이 10쪽씩 받아쓰기 → 그 합본을 원문으로 Codex 대조(지적 35건 전부 채택 · 숫자 오류 0 · 대부분 세기·조건·문항명). 절차는 `docs/report-from-pdf.md` §1-A 에 넣었다.
  - 교훈 원장(agents `docs/data/curation-lessons.jsonl`): pdf-report 새 교훈 3건(proposed) + 씨앗 5564a3b9 에 회차 붙임. promote·sync-docs 는 안 돌렸다 — 같은 파일에 다른 세션의 ma-deal-note 미커밋 수정이 있었다.
  - 원문 면책 문구: 「삼정KPMG의 사전 동의 없이 무단 배포·인용·발간·복제 금지」 — 사내 게시판 요약 게시는 사용자 지시로 진행. 외부 공유 시 주의.
- 🔴 남은 한계: `Architecture.md` 가 문서 상한 초과(153,848B > 150,975B) — 2-2 커밋 «전»부터 152,836B 로 넘어 있었다(앞 커밋 658e168a 의 표를 prettier 가 다시 정렬하며 늘어남). `verify_docs.py` 가 종료 1. 처방 = 경위·실측을 `docs/history/Architecture-경위.md` 로 옮긴다(상한 올리기 금지).
- 재개 지점: 남은 일 = Architecture.md 상한 정리 1건. 회차 폴더 `scripts/_pdf_report/2026-11-25/`(gitignore)는 회고가 §5 에 옮겨졌으니 지워도 된다(사외비 아님 · 원문 PDF 사본 있음).

## 이전 상태 · 재개 지점 (2026-11-23 오후, **증권사 리포트 선별 — 휴머노이드 기업은 제목에 로봇 낱말이 없어도 로봇 주제**)

- 계기: 자동 작업 점검(사용자 「실패한 작업이나 완료되지 않은 작업 있으면 작업해」)에서 로보티즈 리포트(「수요는 견조, 공급 병목 해소가 관건」 등)가 4점으로 요약 문턱 5점 아래라 빠진 것을 보고 → 사용자가 고침을 고름.
- 사용자 결정(2026-11-23 · 되묻지 말 것): 「휴머노이드 역할만」 — `companies.robot_roles` 에 `humanoid` 가 있는 회사(25곳)만 +3. 고르지 않은 안: 역할 전부(76곳 · 9월 이후 12편 · 고영·비에이치 실적 리뷰가 섞임) · 「로봇 본업」 표시 칸 신설(DB 칸 + 명단 확정 필요).
- 고친 것(`1acfa7f8`): `scripts/lib/research_priority.py` `is_robot_report` · `summarize_naver_research.py` 가 `companies(robot_roles)` 를 함께 읽음 · 시험 3개 추가(29 통과) · `check-all` 통과. 실 DB `load_targets` = 로보티즈 4편 7점.
- 🔴 남은 한계: 감속기 전문(에스피지·하이젠알앤엠)은 `parts` 역할이라 여전히 제목에 감속기 낱말이 있어야 들어온다(사용자가 알고 고른 것).
- 재개 지점: 다음 평일 15:00 agents `collect:naver-research` 뒤 로보티즈 4편(10-27·11-06·11-18 둘)이 요약됐는지 `research_reports.summary` 로 확인. 푸시는 wrap-up 에서 함.

## 이전 상태 · 재개 지점 (2026-11-23, **레포 코드 리뷰 6~11번 수정 · 2회차 diff 검토 반영**)

- 사용자 지시(2026-11-23): 「계속해」(앞 회차 재개 문장 = HANDOFF 재개 지점부터 6~11번). 반영 방식은 계획서 머리말의 11-20 선택 「커밋+운영 배포」를 그대로 따랐다. 처리표·검토 반영/기각 이유 = `docs/plans/2026-11-20-code-review.md` 「2회차 처리」·「2회차 diff 검토」.
- 고친 것: (6) 1,000행 잘림 — 공용 `lib/supabase/fetchAllPages.ts` · 손익·계획·재고·인원·고객사 6표 PK 전체 정렬 (7) 종목토론 반응을 못 받으면 `null`(조회수가 비어 와도) → 반응 칸 뺀 별도 upsert 로 DB 값 유지 · 429 면 남은 묶음 중단 (8) 고객사 재처리: 지우기 전 `breakdown_at` null · 같은 키면 검증된 행이 이김(값이 달라도) (9) 숫자 검증층 — `-$50`·`-US$`·`-USD` 부호 · 일정 연도 = 월·일에 가장 가까운 것 · 모델이 적은 통화 대조 · 발행 연도 뒤 해 불일치(`'27`·`27년`·`FY27`·`CY27`) · 대수 지표 `units` 만 · PDF 쪽 번호 필수·범위 · 이중 판독은 «그림 속 숫자»(인용은 그 쪽에 있음)만 · 배수 표지 검사(정기 API 행만) (10) 고객사 문서 날짜 서울 기준 (11) KOMIS 401·403·429 → `KomisBlocked` 즉시 멈춤 · 조회 연도 서울 기준.
- 🔴 운영 DB 영향(실측 · 건수만): 기존 검증 행이 뒤집히는 경우 0 — 쪽 번호 빈 행 1,891 은 전부 비-PDF 문서 · 이중 판독 64행은 원문 쪽에 다시 대조해 전부 「인용은 있고 값만 그림」 · 일정 80행 새 실패 0 · 전망 294행 판정 불변.
- 🔴 의도적으로 남긴 것: 배수 표지 검사는 소급(manual) 행에 안 건다(`SHORTCUT` — 검증 행 2,906 중 788 이 인용에 표지가 없다 · 걸려면 그 문서의 쪽 본문 표지부터 잰다). 삭제·삽입이 한 거래가 아닌 것(RPC 필요) · 문장 단위 해석이 필요한 통화·연도 갈래는 계획서에 이유와 함께 기각.
- 검토: Codex(high · 공개 코드만 — 사외비 `lib/pnl` 등 제외)와 오퍼스 검토자를 따로 돌려 합침. 맞은 지적은 시험 먼저 → 실패 확인 → 수정. 「구현을 지워도 통과하던 시험」 2개(KOMIS 수집기 재던지기 · 429 뒤 멈춤)는 변형해 실패하는 것까지 확인.
- 같은 날 3회차(「작고 효과가 분명한 것들 작업하고 WRAP-UP으로 마무리 해」): 게시글 API 두 곳이 `canReadPost`·경영표준 제외를 탄다(세션 없으면 401 · 권한 없으면 404) · 비밀값 `?secret=` 제거(`/api/revalidate`·`/revalidate/posts/[id]`·`/cron/sentiment` 는 헤더로만 — 호출부 전부 헤더 확인) · Toaster 위치 문구 3곳 `top-right`. iframe `sandbox` 는 의도된 설계라 기각.
- 재개 지점: 남은 코드 리뷰 지적 = 계획서 「낮음·참고」 중 로그인 시도 제한·30일 토큰(보안 정책 — 사용자 결정 필요) 외엔 「현재 미발생」 판정 · agents `scan_all.py` 정정본 49딜은 agents 세션에서. 배수 검사가 과한지는 사람이 기억할 필요 없다 — 정기 실행(GHA `collect-customer-docs.yml` 평일 08:00)이 떨어진 행이 생기면 `::warning::` 으로 건수를, 20% 이상이면 「검사가 과할 수 있다」를 찍는다(사용자 「1번으로 해」 · 11-23 기준 정기 API 행 0). 그 경고를 보면 `docs/customers-collection.md` 의 처방대로.

## 이전 상태 · 재개 지점 (2026-11-20, **레포 코드 리뷰 · 1~5번 수정 · 다크모드 순서도**)

- 사용자 지시(2026-11-20): 「경영표준 보니까 다크모드에서 순서도 화살표가 잘 안보임. 전반적으로 확인해봐.」 → 「끝나고 이것도 해. - 레포 코드 리뷰를 해봐. 필요한 스킬 다 사용하고. 코덱스도 활용해」. 판정 원장·선택 = `docs/plans/2026-11-20-code-review.md`(지적 57건 · 수정 범위 「1~5번만」 · agents 레포 건 「따로 회차」).
- 다크모드: `components/reports/mermaid-block.tsx` — 다크면 mermaid `dark` 테마로 다시 그림 · `%%{init` 으로 색을 정한 도표는 흰 카드 위에. 규칙 = `report.md` §6.
- 고친 것: (1) mermaid `securityLevel` loose→strict(`click` javascript: 링크 차단 · `<br>`·`classDef`·init 은 그대로 — 헤드리스 확인) (2) 자금수지 ②·③ 은 EBITDA 가 비면 비움(④·미설명 차이 계산은 그대로) (3) 재무 `selectPeriods` — 12월 연간 행이 계정 미완이거나 손익월보다 앞서면 월별로(원래 입력 안 하는 계정이면 연말 유지 · 운영 DB 영향 0건 확인) (4) `MultiSeriesChart` 숨김 effect 에 라벨 의존성 (5) 네이버 리서치 0건 판정을 종류마다 · 하나라도 0이면 저장 없이 exit 3(`scripts/lib/test_collect_naver_research.py`).
- 🔴 커밋 당시 다른 세션이 `lib/finance/aggregate.ts` 에 「리스료 지급」을 넣는 중이었다 → 이 커밋은 내 hunk 만 담았다(그쪽 변경은 작업트리에 남김). 그쪽 미완 상태에선 `aggregate.test.ts` 「흐름 계정 10종」 시험이 실패한다(리스료가 목록엔 있고 계산엔 없음) — 내 변경 탓 아님.
- 재개 지점: 다음 회차 후보 6~11(사외비 4곳 1,000행 · 종목토론 반응 0 덮어쓰기 · 고객사 재적재·숫자 대조 검사기 7건 · UTC 날짜 · KOMIS 403) = 계획서 「다음 회차 후보」. 검사기 7건은 재현 입력을 MUST_HIT 시험으로 먼저 박을 것. agents `scan_all.py` 같은 날 정정본 49딜은 agents 세션에서.
- 기존 실패(이번 변경 무관): `verify_docs.py` 상한 초과 2건 — `Architecture.md` · `docs/gotchas-playwright-ui.md`. → 2026-11-23 해소(자금수지 세션 · 설명 구절을 `docs/history/` 경위 문서로 글자 그대로 옮김 · 오류 0건).

## 이전 상태 · 재개 지점 (2026-11-20, **재무 3번 → 자금수지(Cash Bridge) · 더미 예시 적재 · 입력용 엑셀**)

- 사용자 지시(2026-11-20) 원문·결정 = `docs/plans/2026-11-20-finance-cash-bridge_최초지시.md` · `_결정이행.md`(결정 14 + 최종 검토 반영 표). 옛 「투하자본·자금조달」 표는 삭제.
- 화면: `/management/finance` 3번 = 최신 기간 폭포 차트 + 표(2024 연간 · 2025 연간 · 2026.09 누계 · 비고 칸). 칸 호버 = 비고, 항목 이름 호버 = 엑셀 입력 위치. 비고가 `[더미]`로 시작하면 주황 기울임(입력 예시).
- 리스(K-IFRS 16 · 같은 날 추가 · 결정 15): 사용자 확인 = 「차입」에 리스부채 없음 · 감가상각비에 사용권자산 상각 포함 · 이자비용에 리스 이자 제외 → 흐름 계정 「리스료 지급」(원금 + 이자 전액)을 ② 이자비용 바로 아래에서 뺀다. 위치는 사용자가 안 골라 권장안(②) — 자금조달 쪽으로 옮기라 하면 layout·계산 묶음만 바꾼다. 리스 더미 11행은 운영 DB 에 SQL 로 직접 넣었고 예시 엑셀 끝에도 11행(주황) 덧붙였다.
- 입력: '재무' 시트 하나(별도 시트 없음 · 사용자 지시). 새 흐름 계정 11종(정본 `lib/finance/aggregate.ts` `CASH_FLOW_ACCOUNTS`) · 현금 기준 부호(유출 음수) · **그 달까지 누계**(사용자 확정) · 8열 비고 → `finance_entries.note`(마이그레이션 `20261120000001`). 이자는 기존 「이자비용」 그대로.
- 🔴 DB 에 더미가 이미 들어가 있다(운영 DB · 흐름 계정 11종 × 2024·2025 연간 + 2026.01~09 · 비고 `[더미] …`). 2026-11-23 사용자 지시 「다음에 업로드 할 때 지워」(결정 16) → `sync_finance.py` 본 적재가 DB 의 `[더미]` 행(11-23 실측 80행)을 먼저 지우고 upsert 한다. 다음 엑셀 업로드에서 사라지고, 올린 엑셀에 `[더미]` 행이 남아 있으면 그것만 다시 들어간다. 손으로 지울 일 없음.
- 입력 담당자용 예시 엑셀(사용자 PC · gitignore 밖): `C:\Users\junghwan.yoon\Downloads\자료정리_월별손익_2026 10 31_자금수지예시.xlsx` — 주황 행 121 = 더미(리스료 11 포함) · 노란 칸 5 = 「[예시] 이런 걸 적는 칸」 · 회색 252 = 화면에서 안 쓰는 행(권장 = 그대로 두고 「안 채워도 됨」 안내만 · 사용자 미결정).
- 최종 검토(Codex·오퍼스 따로)에서 맞은 지적을 반영: 지난 연도 월별 행이 남으면 전기를 11월로 고르던 것(`selectPeriods` 가 연간 우선) · 재무가 손익보다 늦을 때 다른 달 영업이익 혼입 · 조회 1,000행 상한(`fetchFinanceRows` 페이지 나눔 — 2027 초 초과 예상이었다) 등. 안 고친 것 = 공용 `useRowHighlight` 의 행=버튼 접근성(다른 표 전부에 걸려 별도 과제).
- 배포 확인(2026-11-20 12:06 · `4f5bcad7`): 운영 화면 헤드리스 — 열 3개 · 더미 칸 38 · 비고 표시 31 · 막대 12 · 페이지 오류 0.
- 재개 지점: (1) 운영 화면 확인 끝 (2) 입력 담당자가 실제 값을 넣으면 「미설명 차이」 크기로 빠진 항목 점검 (3) 다음 업로드 뒤 DB `[더미]` 0행 확인(결정 16) (4) 회색 행은 그대로(사용자 미결정). · 별개 기존 문제 고침(11-23 사용자 「고쳐」): 로컬 실행 때 `resolve_excel_path` 가 파일명 글자순이라 6월 파일(「2026 6 22」)을 골랐다 → 파일명 날짜순으로(8종 dry-run 전부 「2026 10 31」 확인).

## 이전 상태 · 재개 지점 (2026-11-20, **GHA 하이쿠 → 최신 하이쿠 자동 선택 · GHA 실패 점검 · MarkLines 10월 적재 상태**)

- 사용자 지시(2026-11-20): 「gha 사용되는 앤트로픽 api 모델이 하이쿠인데 이것도 하이쿠 최신버전을 알아서 사용하는 것으로 바꿔줘」 · 「계획서 필요 없어」.
- 바꾼 것: 모델 ID 를 박지 않고 실행 때 Models API 에서 `claude-haiku-*` 중 `created_at` 최신을 고른다 — 파이썬 `scripts/lib/anthropic_models.py` `latest_haiku()` · TS `lib/reports/anthropic.ts` `latestHaikuModel()`(조회 10초·재시도 1회 · 실패 시 `claude-haiku-5-5` 폴백). GHA 경로 6곳 적용: `analyze_board_sentiment.py` · `enrich_company.py`(onboard·humanoid 포함) · `collect_macro_outlook.py` · `collect_yt_report.py` · `enrich_products_customers_sonnet.py` · 감성 크론 `app/api/cron/sentiment/route.ts`(DB `board_sentiment.model` 에 실제 쓴 ID 기록). 환경변수 지정(`MODEL` 등)은 그대로 우선.
- 하이쿠 5.5 호환: 생각(thinking)이 기본 켜짐 → 첫 블록을 답으로 읽던 `collect_macro_outlook.py` 를 type 으로 고침 · 도구 강제 아닌 호출 `max_tokens` 16000 · 토큰이 약 30% 늘어 도구 강제 호출도 올림(감성 크론 4096→16000 · 제품 추출 2048→8000). 실호출로 5.5 선택·정상 응답 확인(2026-11-20).
- 후속(같은 날 「남은 일도 이어서 해」): 챗봇 `lib/chat/loop.ts`·보고서 업로드 요약 3곳(웹·PDF·카테고리 분류)도 `latestHaikuModel()` 로 — `CLAUDE_SUMMARY_MODEL` 상수는 지웠다. 하이쿠 5.5 대비로 챗봇 `MAX_TOKENS` 2048→8192 · 카테고리 분류 `max_tokens` 30→2048(생각이 한도를 다 써서 빈 답이 된다). 웹·PDF 요약은 이미 type 으로 읽고 한도가 커서 그대로. 로컬 전용 수집 스크립트 10여 개는 그대로.
- 실패 신호(같은 날): 감성 크론은 분류 실패·저장 실패 종목이 있으면 502(`ok:false`·`failed` 목록) → GHA `curl --fail-with-body` 가 빨간불. `classifyPosts` 는 실패를 `null` 로(빈 배열 = 0건 성공과 구분). `analyze_board_sentiment.py` 는 전 배치 실패(파싱 실패 포함)면 exit 1. 400 이면 폴백 재시도는 넣지 않았다(실패가 보이면 충분하다고 판단).
- 확인(2026-11-20 00:15 UTC 배포 직후 감성 크론): `board_sentiment.model` 에 `claude-haiku-5-5` 1건 저장 · 응답 `ok:true`.
- GHA 실패 점검(2026-11-20): 최근 실패 7종 전부 다음 실행부터 회복 — 감성 크론 401(11-19 수동 1회) · KG 11-15 · 두바이 11-14 · 금속 11-03~12. 조치 없음.
- MarkLines 10월(2026-11-20 DB 실측): 판매는 57개국 중 11개국만(미국·일본·독일 등 · 한국·중국·영·프 없음) · 생산·중국 3종은 9월까지 → 사용자가 엑셀 6종을 받아 `import_marklines_manual.py` 로 적재해야 한다(절차 = `docs/oem-collection.md`).
- 재개 지점: (1) 파이썬 GHA(거시 전망·회사 보강 등) 첫 실행 로그에서 「최신 haiku 모델: …」 줄 확인 — 감성 크론은 확인 끝 (2) 챗봇·보고서 업로드를 한 번 써 보고 답이 잘리지 않는지 (3) 사용자가 MarkLines 엑셀을 받으면 적재 결과 표 확인.

## 이전 상태 · 재개 지점 (2026-11-19, **경영표준 12장(CSR)·13장(BIQS)·부록 C 게시 — admin·holdings 만 · Codex `.env` 유출 수습**)

- 게시(2026-11-19): posts 176(12장)·177(13장)·178(부록 C) 새로, 162(부록 B 용어 71개 추가)·149(00장 표) 갱신. 계획·결정 = `docs/plans/2026-11-18-mgmt-standard-customer.md` + `_결정이행.md`. 원고·처리표·도구는 gitignore `참고/경영표준/`(처리표 확정본 `검토/처리표_12_13.md`)
- 확인(프로덕션): 경영표준 17편 전부 사외비 · anon 0행 · admin·holdings 목차 17줄(12→13→부록 A·B·C) · mobility·hmobility·guest 는 상세까지 첫 화면으로 돌려보내짐 · `/reports` 누출 0 · 별표 0 · Mermaid 12장 5·13장 4 렌더. 다시 재려면 `참고/경영표준/도구/verify_roles.py <레포 루트> <결과.json>`(venv python) · `verify_anon.py .env.local`
- 검토: 패널 5명 → 냉독이 치명 6건(「협력사」 1차·2차 두 뜻 · 품질지수 두 척도 · GM 거래 종료가 요약에 없음 · 「지킨다」 단정 · 공백 목록 일부만 · NBH 단정)을 잡아 반영. 13장 제목을 「GM이 부품 협력사에 요구한 29가지 품질 요소」로 바꿨다(다시 바꾸면 새 글이 생긴다)
- 🔴 보안(2026-11-18): Codex 를 `--cwd <레포>` 로 불러 `.env.local`·`.env.example` 전체가 OpenAI 로 나갔다(비밀 24개). Codex 기록 정리·`codex_run.py --stage` 격리·비밀 파일 거부를 넣었고(`~/.claude`), 경위 = `~/.claude/docs/history/codex-delegate-경위.md`
- 재개 지점: (1) 사용자가 키를 재발급(목록 `참고/보안_키교체_2026-11-19.md`)하면 값은 보지 않고 동작 확인 — 수집 dry-run 1 · GHA 수동 1 · 프로덕션 로그인 · `/api/revalidate`. 부록 B 의 RR·EF·OTS·Pilot·PSQ 행 근거 칸 PDQR·SPPS 는 그대로 둔다(사용자 결정 2026-11-19)

## 이전 상태 · 재개 지점 (2026-11-18, **보고서 회차 끝 작업방식 회고 · agents 지식노트 갈래와 교차 반영 — 강조 판정 정본화 · 창 숨김**)

- 사용자 지시(2026-11-18): 「보고서 작업이나 지식노트 작업 같은 경우 매번 작업이 모두 끝나면 작업방식을 업데이트 하게 해」 → `wrap-up` 3단계 「작업방식 회고」 + 안내형 훅 `~/.claude/rules/warn-work-method-retro.md`(게시·조립 명령·보고서 커밋에 뜸 · 막지 않음)
- 회차 폴더 도구를 레포로 올림 — `scripts/yt_report/`(미리보기·지시문 3개 · 480cebb5) · `scripts/pdf_report/`(게시·대조 틀 · b7c5d43c) · 회차 폴더는 삭제
- agents 와 교차 반영(28ed9dda): `verify_yt_report.py` 강조 판정을 사본 대신 정본(`~/.claude/scripts/hook_cjk_emphasis.py` `violations()`) import — 정본이 없으면 exit 2 · yt_report subprocess 11곳 `CREATE_NO_WINDOW` · 캡션 별표 이스케이프 · `prompts/write.md` 10~13번
- 정본 판정이 넓어졌다(78b59bb): `**` 안쪽 공백 · 「한글\*\*구두점」 꼴도 위반 — 기존 게시 보고서는 소급하지 않았다
- 재개 지점: 이 레포 쪽 남은 일 없음. agents 쪽 남은 결정 = agents `HANDOFF.md` 맨 위 블록
