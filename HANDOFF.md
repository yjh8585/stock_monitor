# HANDOFF

다음 세션이 그대로 이어받기 위한 인수인계 기록. **맨 위가 최신**이고, 새 블록을 쓸 때
직전 블록은 `## 이전 상태 …` 로 강등한다.

**여기엔 최근 10블록만 둔다.** 그보다 오래된 블록은 지우지 않고
[`docs/handoff-archive-2026.md`](./docs/handoff-archive-2026.md)(현재 **22블록** · 2026-11-11 실측)로 옮긴다.

---

## 최신 상태 · 재개 지점 (2026-11-11, **고객사 IR 확장 계획 전부 끝 — Task 1~13 · 최종 검토 · 2년 백필 · 푸시 완료**)

> 이 세션의 관통 주제: IR 확장 계획서(`docs/plans/2026-11-10-customers-ir-expansion.md`)의 Task 9·10·13·11 → 최종 검토(Codex) → Task 12(2년 백필·다시 처리·화면 확인)를 끝냈다. 도중에 사용자 지시 「이제 더이상 api 쓰지말고 직접 해」로 **구현은 메인 직접 · 검토는 Codex** 로 돌아왔다.

**결과**: Task 9 `4c32bbe`~`ff288d3` · Task 10 `0bbe93c`~`e2df5a6` · Task 13 `43c7a7c`·`ea2e896` · Task 11 `4f5428f` · E9·E10 `58b8a80`·`50a54f8`·`750f382` · 최종 검토 반영 `79250ca` · Task 12 포르쉐 옛 서식 `6ac2060`. 결정 이행 E3·E6 = 그대로(`_결정이행.md` 상세에 실측).

**🔴 재개 지점**: 계획·푸시·GHA 확인까지 끝 — 남은 일 없음. SDD 원장(`.superpowers/sdd/2026-11-10-customers-ir-expansion/progress.md` · gitignore)은 `Task 12: complete`.

**사용자 결정 (2026-11-11)**: E9 VW 중국 인도 = 분기 표 위에 «중국 작은 차트» · E10 합작사 영업이익 몫 = 실적 칸 한 줄 · 「수집기 LLM은 허용」(Task 12 의 LLM 호출) · 「이제 더이상 api 쓰지말고 직접 해」(헤드리스 API 구현자 중단).

**Task 12 실측 (재조사 금지)** — 건수·행 수 전후 = `_결정이행.md` 상세 E3·E6 · 함정·한계·비용 = `docs/customers-collection.md`(정기 실행 줄 · 약속 절 · 수집 함정 절):

- 기아 2건은 원 출처 404 라 `--close`(2408·2409). 포르쉐 옛 판 4건 failed → `6ac2060`.
- 🔴 `--reparse` 한 1740 이 `not_target` 이라 옛 345 행이 남아 손으로 지웠다(정기 실행은 해당 없음).
- 방향 빈 검증 행 = VW FY2025 `revenue_growth` 2행(글 전망 · 설계대로).
- LLM 이번 32회 ≈ $0.90 · GHA 정기 실행 추정 연 약 $0.6(러너 0원).

**푸시 전 결정 — 사용자 선택 2026-11-11**: 지금 푸시 · 빈패스트 `sig=` 값이 `da1260f` 히스토리에 남은 것은 그대로(만료 2026-11-10 04:00 UTC) · 수집 주기 유지 · GM 빈 목록 허용 = 1월 한 달(`GM_FIRST_SALES_BY = (2, 1)`).

- **푸시 완료**(`6c72157` · 백업 봇 스냅샷은 병합으로 수용 — 리베이스하면 문서가 가리키는 커밋 번호가 바뀐다) · Vercel success.
- GHA GM 러너 확인 = 실행 42963234533(`probe_gm_ir`): Chrome 156 · IR 문서 14 · 11 job success → D1 「사용자 PC」 불필요.

**검증**: 마무리 시점 `pytest scripts/lib` 901 통과·3 건너뜀 · 포르쉐 자가 시험 0건 실패 · `npm run check-all` 통과(vitest 640 · exit 0).

## 이전 상태 · 재개 지점 (2026-11-11, **고객사 IR 확장 계획 실행 중 — Task 1~8 완료 · 다음 Task 9 · 미푸시**)

> 이 세션의 관통 주제: IR 확장 계획서(`docs/plans/2026-11-10-customers-ir-expansion.md` · Task 1~13 · 결정 기록 `_결정이행.md` D1~D9·E1~E8)를 SDD 로 이어 실행. 구독 한도가 12% 로 떨어져 사용자 지시로 **구현자 = API 키 과금 헤드리스 · 검토자 = Codex** 로 바꿨다. 컴팩트 전 정리.

**결과**: Task 4 `da1260f`·`98302a7` · Task 5 `f9d2ae9`·`288d6fa` · Task 6 `d978770`·`2683f21` · Task 7 `51e5f70`·`b452cfc`·`83f238b` · Task 8 `5116661`·`5cd9717`·`a2c48ec`·`9f54546` · 결정 E7 `64b92db`. **푸시 안 함.**

**🔴 재개 지점**: SDD 원장 `.superpowers/sdd/2026-11-10-customers-ir-expansion/progress.md`(gitignore) 맨 끝. 다음 = **Task 9**(지시문 준비됨 · `scratchpad` 는 세션과 함께 사라지므로 아래 «실행 방식»대로 다시 만든다) → 10 → 13 → 11 → 최종 검토 → Task 12.

- Task 10 에 **더할 항목**(원장 「Task 5 걱정 ④」): LLM 이 어휘에 없는 지표(총주주환원율 35%+)를 `free_cash_flow` 로 실어 `verified=true` 가 됐다(`customer_guidance` id 345 · 문서 1740 · 현대 CID). 지시문(`llm_guidance.py` 「맞는 지표가 없으면 만들지 않는다」)은 이미 있어 코드 가드(라벨↔지표 정합)가 필요 → 고친 뒤 `--reparse 1740` 으로 행 345 가 사라지는지.
- Task 11 에 **더할 항목**: `docs/customers-collection.md` 의 「GM IR 차단·어댑터 없음」 서술(38·74행)을 Task 8 결과로 고친다 · `porsche.py:48` 인도 정의 문구(Task 3 이월).

**실행 방식(사용자 지시 2026-11-11 「한도가 12% … codex나 앤트로픽 api 쓸 수 있는 것은 써봐. api도 같은 모델과 같은 effort 사용하고」)**:

- 구현자 = `ANTHROPIC_API_KEY=<루트 .env.local 의 값> claude -p --model claude-opus-5-5 --effort high --permission-mode bypassPermissions --output-format stream-json --verbose < 지시문.md > 로그.jsonl`(레포 루트에서 · 키를 출력하지 않는다). 로그의 init 줄 `apiKeySource=ANTHROPIC_API_KEY` 로 API 과금을 확인. 수정 회차는 `--resume <session_id>`(로그 result 줄). 비용 실측: Task 7 첫 구현 $5.99 · Task 8 $7.53 · 수정 회차는 이어받기라 누적이 크다($9~13).
- 지시문 = SDD `implementer-prompt.md` 틀 + 브리프 경로(`scripts/task-brief <plan> N`) + 이 계획의 제약(공개 레포 · 커밋 규칙 · DB 쓰기 금지 · 남의 미커밋 파일 · `참고/` 금지) + 보고서 경로. HANDOFF.md 는 구현자가 고치지 않는다(「HANDOFF 에 넣을 것」 절로 보고).
- 검토·재검토 = Codex(`python -X utf8 ~/.claude/scripts/codex_run.py run <지시문> <결과> --cwd <레포> --tag diff-review`) · 지시문은 SDD `task-reviewer-prompt.md`·`re-review-prompt.md` 를 한국어로 옮긴 것 · 읽기 전용 · `참고/` 금지.
- 같은 파일을 고치는 두 구현자를 동시에 돌리지 않는다(`--only` 커밋에 남의 hunk 가 섞인다) — 검토(읽기 전용)와 다음 구현은 겹쳐도 된다.

**사용자 결정 (2026-11-11)**: E7 모비스 Script 목표 문장 없음 = «서식 미인식» 경고(상태는 not_target + note · 2단계 P4 와 같은 방식) · E8 KGM CEO IR설명회·Pressday = 날짜 없음 유지(행사일은 공시 본문에만 · 3단계로).

**비자명한 사실 (재조사 금지)**:

- 현대 CID 목록에 행사일 칸이 없다 → 같은 사이트 `pastIrEvent.list.do` 로 붙임(2019 는 CID 두 번이라 날짜 없음). 모비스 영문 Script 링크엔 `fileNm` 이 없어 키 = 분기 이름.
- D6 실측: 현대 CID 25,957자 · 기아 CID 56,237자 — 둘 다 12만 자 상한 안(잘림 없음). 현대 CID LLM 1회 = 입력 25,690 · 출력 113 토큰, 행 1개(위 오분류 행).
- KGM 은 분기 실적 공시와 월 판매 공시의 제목·종류가 같다 → 정정공시의 원공시는 «IR 실적 발표일과 같은 날 낸 같은 제목 공시»로만 확인, 아니면 날짜 없음(Task 7).
- 포르쉐 EQS 피드는 XML 이 아니라 JSON. 일정만 403 이면 수집 상태를 blocked 로 올린다(Task 6).
- GM: 이 PC 에서 실제 Chrome(CDP)로 페이지·PDF 전부 200 · 드라이런 새 문서 14(덱 5·서한 5·Deliveries 4) · 일정 2. Chrome 받기 URL 당 120초 상한(`CHROME_URL_TIMEOUT_S`).
- 고친 결정 기록: `_결정이행.md` E8 줄은 이 마무리 커밋에 들어갔다.

**푸시 전 사용자 확인 항목(누적)**:

- 빈패스트 픽스처에 들어갔던 실제 서명(`sig=`) 값이 `da1260f` 히스토리에 남아 있다(만료 1794283200 · 푸시하면 공개) — 커밋 합치기 여부.
- GHA 매일 실행의 GM 문서 목록이 러너의 Chrome 에 기댄다 — 러너에 Chrome 이 없으면 GM 행이 매일 `error`(사유 「Chrome 없음」). 푸시 뒤 `probe_gm_ir` 수동 실행으로 확인 · 막히면 D1 「사용자 PC」 갈래.
- GM 올해 판매 목록의 빈 표식은 서울 기준 1월 1·2일만 허용(`GM_FIRST_SALES_BY`) — 첫 보도가 늦은 해엔 1월 3일~첫 보도일 GM 행이 error 로 뜬다(조용한 0건보다 시끄러운 실패 · 컨트롤러 판정 · E7 방향).
- 사용자 질문(2026-11-11 「분기별 실적이 나오는데 왜 매일 수집해?」)에 답함: 매일은 «새 문서 확인»만, AI 는 새 문서가 있는 날만 돈다(평일 08:00 KST · 공개 레포라 GHA 무료) — 주기를 줄일지 사용자 답 대기(줄이면 Task 11 에서 cron 한 줄).

**남은 사소 지적**: 원장의 `minor (deferred)` 줄(Task 1~8) — 최종 검토에서 가린다.

**검증**: 마무리 시점 `pytest scripts/lib` 873 통과·3 건너뜀(exit 0) · `npm run check-all` 통과(vitest 633 · exit 0).

## 이전 상태 · 재개 지점 (2026-11-11, **API 크레딧 일회성 작업 끝 — DB 반영·커밋 완료 · 미푸시(사용자 확인 대기)**)

> **이 작업에서 남은 코드 일은 없다.** 고객사 IR 확장(바로 아래 블록)은 다른 세션의 진행 중 작업이니 그쪽 재개 지점은 아래를 본다.
> 지시 원문·선택·판정 = [`docs/plans/2026-11-10-api-credit_최초지시.md`](./docs/plans/2026-11-10-api-credit_최초지시.md)

**끝난 것(DB 는 이미 운영에 반영 · 캐시 갱신 완료)**

- 증권사 리포트 미요약: 원인은 「작성 가치 없음」이 아니라 선별 점수 문턱(5점) 미달 — 내려받은 파일 정리, 밀린 4편 요약
- `enrich_customers_websearch.py`: 트리거가 `[{"name":..}]` 객체 배열만 읽는데 문자열 배열을 넘겨 조용히 `[]` 가 되던 버그 수정 · LLM 이 짐작한 고객사 3곳은 원래 값으로 되돌림
- Cox 딜러 재고일수 과거분 백필(46개월) · 2022-10 은 차급 차트라 제외 · 대소문자 표기 변형(`Nation`·`INFINITI`·`Mini`)을 `BRAND_ALIASES` 로 흡수(시험 70개 통과) · 함정 = `docs/gotchas-data-collection.md` 「Cox 과거분을 다시 읽을 때」
- 스텔란티스 화면 헤드리스 확인: 최근 24개월 재고 항목 23건 = Cox 21 + 수동 2(24.12·26.06, 수동 우선 설계대로) · 전부 업계 평균 붙음
- 휴머노이드 기업가치 4건 + 홀리데이 7,000억원(4.6714억 달러)·1X 기준일 2025-01-31 정정 · 애질리티 → 나스닥 AGLT 상장사 전환, 일봉 2026-11-05 부터만(그 전은 SPAC 시세)

**남은 것**

1. **푸시 안 함** — master 의 미푸시 커밋 67개(2026-11-11 실측) 대부분이 다른 세션의 고객사 작업(`da1260f` 등, 배포·유료 수집 시작이라 사용자 확인 대기)이라 함께 나간다. 사용자 확인 뒤 한 번에 푸시
2. 검증: `npm run check-all` exit 0(테스트 633개 · 2026-11-11) · `verify_docs.py` 오류 0 — 함정 문서가 상한을 넘어 08-13·08-14 Cox 경위와 이번 절 원문을 `docs/history/gotchas-data-collection-경위.md` 로 옮겼다
3. AGLT 는 정기 수집이 이어 받았다 — 일봉 11-05·06·09, 현재가 11-10 갱신(2026-11-11 확인)

## 이전 상태 · 재개 지점 (2026-11-10, **고객사 IR 확장 계획 실행 중 — Task 1~3 완료 · Task 4 수정 1회차 도중 중단 · 미푸시**)

> 이 세션의 관통 주제: 고객사 2단계 위에 얹는 IR 확장(계획서 `docs/plans/2026-11-10-customers-ir-expansion.md` · Task 1~13 · 결정 기록 `_결정이행.md` D1~D9·E1~E6)을 작업별 서브에이전트(SDD)로 실행. 사용자가 PC 를 꺼서 Task 4 수정 도중 멈췄다.

**결과**: 커밋 `888db50`(계획) · `dd6bd3a`(Codex 대조 반영) · `a13374c`(E6) · Task 1 `c7f386a` · Task 2 `559fd05`·`84ab2b7` · Task 3 `ea02611` · Task 4 `da1260f`(첫 구현 · 검토 「수정 필요」). **푸시 안 함**(원격보다 60여 커밋 앞섬).

**🔴 재개 지점**: SDD 원장 `.superpowers/sdd/2026-11-10-customers-ir-expansion/progress.md`(gitignore) 맨 끝부터. 지금은 `Task 4: fix round 1 dispatched`.

1. Task 4 수정 1회차는 **커밋됨 `98302a7`**(pytest 784 통과 · 마무리 직후 도착). 남은 것 = 그 수정의 범위 좁힌 재검토(`review-package <plan> da1260f 98302a7` → 재검토 프롬프트 = SDD 스킬 `re-review-prompt.md`) → 통과면 원장에 `Task 4: complete`. 수정 지시(재검토 대조용) = Important 1(`fetch_vinfast` PDF 받기 실패가 VFS 목록 전체를 죽임 → `TooLarge`·`requests.RequestException`·PDF 파싱 오류를 잡아 날짜만 비움 + 시험 2건) + Minor 5(`_RESULTS_LAG_DAYS` 100→120 · `edgar_quarter_dates` docstring 한 줄 · `parse_vinfast_event` 날짜 ValueError → None · 픽스처 `sig=` 값 가림 · PDF 만든 날 SHORTCUT 주석). 이어받는 법: 변경을 읽어 지시와 맞는지 보고, 모자라면 새 구현자에게 브리프(`task-4-brief.md`)·보고서(`task-4-report.md`)·이 지시를 주고 끝내게 한 뒤 → 커밋 → 범위 좁힌 재검토(`review-package <plan> da1260f HEAD`).
2. 그다음 Task 5 → 6 → 7 → 8 → 9 → 10 → 13 → 11 → 최종 검토(Opus 검토 + Codex diff 검토 따로) → Task 12(메인 직접 · Step 0 = `collect_customer_docs.py --backfill` 본 적재 + 숫자 수집 본 실행 · LLM 아끼지 않음).

**사용자 지시·선택 (2026-11-10 · 원문 = `참고/고객사/2026-11-09-customers-page_최초지시.md` 끝 세 절)**: 폭스바겐 중국 동향 = 숫자+문서 목록(Task 13) · 노사 갈등·파업 = 별도 계획서의 새 기능(E5) · 「코덱스 한도 다 차면 재설정해서 사용량 복구할 거니까 코덱스 사용해」(게이트에 걸려도 Codex 를 쓴다 — 메모리 `feedback_use_codex_despite_gate`) · 「프로모션 API 크레딧 … 과거~최신 자료 등 찾거나 정리할 때 지금 최대한 써」 → 과거 2년치 백필+LLM 을 푸시 전 이 PC 에서(E6 · 푸시 뒤 GHA 백필은 불필요해짐).

**비자명한 사실 (재조사 금지)**:

- 목록 드라이런은 새 문서를 DB 에 저장하지 않고 숫자 수집기는 DB 문서만 읽는다 → «새 문서의 숫자 수집 드라이런» 확인은 성립하지 않는다. 시험(`mod.wants`·`parse`)으로 대신하고 실물은 Task 12 Step 0(Codex 대조 · 계획서 Global Constraints 마지막 줄).
- 공개 레포라 계획서에 «고객사 노조 + 우리 생산량 + 특정 OEM 공장» 원문을 그대로 두면 그 OEM 이 우리 고객임이 드러난다 → 공개 판에서 가림(원문은 `참고/`).
- 화면(`lib/customers/ir.ts`)은 실적 행 단위를 `bn()` 으로 환산하고 `quarterize` 가 실측 분기 행을 누계 차이보다 우선한다 — 포르쉐 팩트시트(million)와 EQS(billion) 공존은 결함 아님(Task 3 검토).
- 빈패스트 2분기 실적 6-K 가 3분기 끝 뒤(2026-10-19)에 나온다 → EDGAR 회사 IR 날짜는 «숫자 수집기가 그 문서에서 읽은 실적 기간 → 그 문서 접수일»(Task 4 · 계획 규칙은 실물에서 틀림).
- 화면 회사 목록 `customer_accounts` 에 수집 대상 11곳 밖 회사 0건(대상 밖 `customer_collect_status` 행 5건은 남지만 안 보임).
- 노사 조사 = `참고/고객사/research/labor_2026-11.md`(⑧절 = Codex 원문 대조: 조합원 9,000명 초과가 기준 · C$529m 은 연방 약정만 · no board 뒤 16일 지나 17일째 · 기아 08-21 파업 실행 여부 확정 불가 · 현대차 5.5만 대는 누적).

**남은 사소 지적(최종 검토에서 가림)**: 원장의 `minor (deferred)` 줄 — Task 1 4건 · Task 2 7건 · Task 3 4건(그중 `porsche.py:48` 인도 정의 문구는 Task 11/12 에서 고칠 것).

**검증**: Task 별 — Task 3 시점 `pytest scripts/lib` 763 통과 · Task 4 첫 구현 779 통과 · `npm run check-all` 각 Task 통과(구현자 보고 · 검토자 확인). 마무리 시점 전체 재검증은 PC 종료 때문에 못 돌림(Task 4 수정분이 미커밋이라 지금 트리는 검증 대상 아님).

**푸시 뒤 사용자가 할 일(변경)**: GHA `probe_gm_ir` 수동 실행만(GM IR 접근 시험) — 2년 백필은 E6 으로 이 PC 에서 한다.

## 이전 상태 · 재개 지점 (2026-11-10, **고객사 페이지 2단계 끝 — 공식 문서 수집·가이던스·물량·실적 일정 + 최종 검토 수정 전량 · 미푸시**)

> 이 세션의 관통 주제: 「고객사」 페이지(`/customers`) 2단계 — 11개 상장 자동차 고객사의 공식 문서(EDGAR·DART·IR 사이트)를 모아 회사별 코드 파서(+코드로 못 뽑는 칸만 LLM)로 가이던스·물량·실적·실적 일정을 뽑고, 인용·숫자 대조를 통과한 행만 화면에 띄운다. 태스크 15개 → 최종 검토 3명 → 수정 22건 + 잔여 Minor 5건까지 끝냈다.

**결과**: 커밋 `bba925e..e4a9e05`(master · **푸시 안 함** — 1단계 화면 커밋부터 원격보다 54개 앞섬). 계획서 `docs/plans/2026-11-09-customers-page-phase2.md` · 결정 기록 `docs/plans/2026-11-09-customers-page_결정이행.md`(2단계-a~ah) · 수집 규칙 `docs/customers-collection.md` · 종료 코드 `docs/commands.md` 「고객사 수집 종료 코드」 · GHA `.github/workflows/collect-customer-docs.yml`(평일 KST 08:00 · 회사별 matrix). SDD 원장 `.superpowers/sdd/2026-11-09-customers-page-phase2/progress.md`(gitignore · 맨 끝 「최종 검토 complete」).

**사용자 지시·선택 (2026-11-10)**: 워크플로 커밋 승인 · GM IR 은 GHA 에서 먼저 시험하고 막히면 사용자 PC · PDF 상한 50MB · 현대·기아 CEO Investor Day 는 AI 가 읽는다 · D7 「넣어도 돼」(NDA 문구 있는 기아 PDF 캡처 허용) · D8 「가로 해」(스텔란티스 IR 자료실 = 3단계, 설계서 「2단계에서 넘어온 것」 절에 기록) · `SEC_USER_AGENT` Secret 은 따로 등록 안 함(기존 스텔란티스 EDGAR 수집기가 `lib/edgar.py` 기본 UA 로 GHA 에서 성공 중 — 2026-08-27 정기 실행).

**비자명한 사실 (재조사 금지)**:

- 공개 레포라 손익 고객명·매출 비중·공급 품목·「○○는 우리 고객」 문장은 코드·시험·주석·커밋 메시지에 금지(OEM 이름은 허용 · 약칭 KGM · 포르쉐 원문 라벨 `Porsche` 는 승인된 예외 · 시험 데이터는 `가나자동차`·`Acme Motors`). 원본 명단·IR 조사는 `참고/고객사/`(gitignore · 이 PC 에만).
- GM IR 사이트(Akamai)는 실제 Chrome `--headless=new` + 일반 UA + CDP + 페이지 안 fetch 로만 열렸다(이 PC). GHA IP 에서는 미확인 — 스크립트 원형은 세션 scratchpad 였으니 IR 확장 때 `참고/고객사/research/ir_us.md` 를 보고 다시 짠다.
- 같은 날 DART 공시(code)와 IR 자료(llm)가 같은 전망을 내면 화면(`lib/customers/ir.ts` foldHistory)과 방향 판정(`scripts/lib/guidance_direction.assign`) 둘 다 code 행을 그날의 전망으로 본다 — 한쪽만 바꾸면 화면 배지와 DB direction 이 갈린다.
- LLM `stated`(상향·유지·하향·철회)는 인용에 근거 낱말이 없으면 지운다(`llm_guidance._STATED_WORDS`). 이미 DB 에 있는 행은 `--reparse` 전까지 옛 값 — PII 문서 303·304 · STLA 317·318 의 4행은 다시 처리하면 stated 가 지워지는 것이 옳다(원문 확인 끝 · 아직 안 돌림).
- DART 원문 받기: status 013·014(자료·파일 없음)만 영구 실패로 닫고, 키 없음·한도·점검·비-zip 응답은 pending 으로 두어 다음 실행이 다시 집는다.
- `Architecture.md` 여유 36B(150,939/150,975) · `docs/gotchas-data-collection.md` 여유 30B · AGENTS.md 36,529/36,600 — 고객사 내용을 더 적을 땐 `docs/customers-collection.md` 로.
- Codex 는 이번 주 한도 게이트(90%)에 걸려 2단계 후반 점검은 서브에이전트가 대신했다.

**재개 지점**: IR 확장 계획서 작성부터. 재료 = `참고/고객사/research/ir_expansion.md`(태스크 T1~T6 · 결정 D1~D9) + 원장 `progress.md` 의 `minor (deferred)` 줄 + `final-fix-list.md` 「받지 않음 / 나중」. 새 계획서는 공개 판 규칙으로 `docs/plans/2026-11-10-customers-ir-expansion.md`. 넣을 것: D1 GM 은 GHA 에서 Chrome CDP 경로 먼저 → 막히면 PC · D2 50MB · D6 기아 CID 는 AI 가 읽고 첫 문서에서 비용 실측 · D4 새 문서 종류 없음 · D9 증권사 리포트 없음 · Codex 표본에서 빠진 연간 가이던스(GM 순이익·조정 전 EPS·자동차 영업현금흐름·capex · VW 조정 마진 약 4%·특별 항목 약 €10bn) · 영구 받기 실패 문서를 사람이 not_target 으로 닫는 절차 · P4 「서식 미인식」 오탐 정리(폴라리스·리비안 expects_numbers) · raised 어간 `increas` 로 느슨해진 stated 거르기(guidance·outlook 낱말과 함께) · 스텔란티스 `TOTAL_LABEL` 대조 · 포드·비상장 OEM 이 matrix 밖 · VW approximately/about.

**푸시 뒤 사용자가 할 일**: GHA `collect-customer-docs.yml` 수동 실행 두 번 — ① `probe_gm_ir` 체크(GM 행만) ② `backfill` 체크(2년 백필 · 첫 실행 회사별 소요로 `timeout-minutes: 40` 확정). 필요하면 `--reparse` 로 위 4행 교정.

**따로 할 일(이번 범위 밖)**: GM 뉴스에 MP Materials 기사 섞임 · 폴라리스 뉴스 · 화면 `-0` 표시 · 스텔란티스 MarkLines 2020 YTD=1.

**검증**: `npm run check-all` EXIT 0(vitest 633) · pytest 750 통과 · `verify_call_contracts`·`verify_revalidate_tags`·`verify_docs` exit 0 · 최종 검토 재검토 P1~P14·T1~T8 전부 해결 · 헤드리스 화면 확인(T 수정분).

## 이전 상태 · 재개 지점 (2026-11-09, **알루미늄 미국·국제·한국·중국 비교 차트 + 수집기 3종 일반 이름으로**)

> 이 세션의 관통 주제: 구리·열연 비교 차트를 끝낸 뒤 「알류미늄도 동일하게 조사해서 그래프 그려봐」 지시로 알루미늄 원천 4개를 붙이고, 금속마다 따로 있던 수집기 3개를 일반 이름으로 합쳤다.

**결과**: 이번 커밋(마이그레이션 `20261109000002` · 수집기 `collect_komis_lme.py`·`collect_pps_metals.py`·`collect_shfe.py`(옛 `collect_copper_lme`·`collect_copper_pps`·`collect_shfe_hrc` 에서 `git mv`) · 원자재 화면 세 번째 카드 · 문서). 계획서·사용자 선택·검토 반영 표 = `docs/plans/2026-11-09-iron-copper-prices_최초지시.md` 「## 알루미늄」.

**사용자 지시**: _"알류미늄도 동일하게 조사해서 그래프 그려봐"_ → 선택: 미국 선 = 중서부 실거래가(LME + `AUP=F` 프리미엄) · 조달청 = 서구산 · 기존 `ALU` 라벨 → 「알루미늄 (COMEX)」 · 수집기 = 일반 이름으로 (2026-11-09).

**비자명한 사실 (재조사 금지)**:

- 새 시리즈: `ALU_LME`(KOMIS `MNRL0009` — 페이지에 광종 이름이 없어 DB 와 맞대 판별) · `ALU_KR`(조달청 「알루미늄(서구산)」 원/t 부가세 포함) · `ALU_CN`(SHFE `al` 위안/t 증치세 포함) · `ALU_MWP`(야후 `AUP=F` USD/lb — `collect-market-series` 가 모은다 · 라이브 수집에선 제외).
- 미국 알루미늄 가격은 COMEX `ALI=F` 가 아니다 — 관세가 빠져 LME 와 거의 같다. 화면의 미국 선 = LME + 프리미엄 ×2204.62262, 프리미엄이 10일보다 오래되면 그 점을 그리지 않는다(`lib/commodityUnits.ts` `PREMIUM_MAX_LAG_DAYS`).
- 조달청은 알루미늄 서구산도 아예 안 파는 날이 있다(5년 28일 · 원문 4편 확인). 판매 안 함 = 「알루미늄」 글자가 없거나, 그 글자가 든 칸이 전부 비서구산. 「알루미늄 (서구산)」 같은 표기 변경은 실패(exit 1)로 잡힌다(자가 시험에 변형 3종).
- 🔴 이 PC 에서 yfinance 가 모든 심볼을 「possibly delisted」 0행으로 내면 `PYTHONUTF8=0` 으로 다시 돌린다(한글 레포 경로와 겹칠 때만 · GHA 는 해당 없음 · gotchas 에 기록).
- (같은 날 후속 지시) 열연은 중국, 알루미늄은 미국 선을 왼쪽 보조축으로 · `MultiSeriesChart` 범례 클릭 토글(경제지표·주식 비교 카드에도 적용). **미국 구리엔 웃돈을 더하지 않는다** — 정제 구리는 232조 관세 면제이고 2027·2028 단계 관세는 미시행(2026-11-06 기사), COMEX 가 곧 미국 가격(사용자 선택 「그대로 + 설명」 · 근거 링크 = 계획서 「## 보조축 · 범례 토글 · 구리 미국 가격」). 정제 구리 관세가 실제로 시행되면 그때 다시 본다.
- (같은 날 후속 지시) 주식 비교 카드(`DualStockCard`·`CrossMarketCard`)는 선택기가 「좌축」이라 부르는 첫 종목을 실제로는 오른쪽 눈금에 그리고 있었다 → `secondaryFor={[0]}` 로 차트를 라벨에 맞췄다(국내×해외 = 국내가 왼쪽). 카드 머리 현재가 단위도 박지 않고 `companies.currency` 로 종목마다(해외는 USD·EUR·JPY·CNY 등이 섞인다 — 전엔 폭스바겐이 「USD」로 떴다).
- `Architecture.md` 상한(150,975B)은 같은 날 두 번 깨졌다 — 고객사 세션이 라우트 표에 긴 칸 하나를 넣자 16행 전체의 정렬 공백이 늘었다(AGENTS.md 「표 셀에 긴 서술 금지」의 실례). 두 번 다 날짜 경위를 `docs/history/Architecture-경위.md` 로 옮겨 맞췄다(부록 A 통째 포함) · 다음에 또 넘치면 그 표의 `/customers` 칸을 줄이는 것이 가장 싸다(고객사 세션 것이라 이번엔 안 건드림).
- 공용 `collect_market_series.py` 는 한 심볼이 0행이어도 exit 0 이다(기존 동작 · 이번에 안 바꿈). 그래서 `AUP=F` 가 끊기면 메일은 안 오고, 화면의 미국 알루미늄 선이 끊기는 것으로만 드러난다.

**재개 지점**: 끝났다. 내일 06시대 정기 GHA `collect-steel-kr.yml` 이 새 파일명 세 단계로 초록인지 본다. `AUP=F` 가 월평균 정산 선물이라 「그날 실거래가」와 다를 수 있다는 검토 의견은 미확인으로 남겼다(라벨은 「LME+프리미엄」). 한국 열연은 여전히 보류.

**검증**: `npm run check-all` EXIT 0(vitest 544) · `verify_call_contracts.py` 위반 0 · 실패 경로 시험 20건 통과 · 수집기 3종 기본 실행 EXIT 0 · 백필(ALU_KR 1,133일 · ALU_CN 1,204일 · 오류 0) · 헤드리스 캡처(라이트·다크)로 4선 확인 · Codex·오퍼스 diff 검토 지적 반영. `verify_docs.py` 는 기존부터 있던 `gotchas-ci-deploy.md` 상한 초과 1건(이번 변경과 무관).

## 이전 상태 · 재개 지점 (2026-11-09, **STEEL_KR GHA 실패 수정 + 구리·열연 미국·국제·한국·중국 비교 차트**)

> 이 세션의 관통 주제: GHA 실패 메일(철광석)을 고친 뒤, 「철·구리 가격을 미국·한국·국제로 모두 보고 싶다 · 단위를 통일해 한 차트에」 요청으로 원천 3개를 새로 붙이고 원자재 화면 맨 위에 USD/t 비교 차트 2개를 넣었다.

**결과**: 커밋 `256a0c4`(KOMIS 가격기준 코드를 이름으로 조회) · `7c7ce5f`(수집기 3종 + 비교 차트 + 문서) + 이번 마무리 커밋(조달청 판매 중단일 처리 · LME 색 · 계획서 실행 결과). 계획서·사용자 선택·검토 반영 표 = `docs/plans/2026-11-09-iron-copper-prices_최초지시.md`.

**사용자 지시**: _"메일에 gha 실패 알림이 자꾸 오는데 확인해서 수정해"_ → _"철, 구리는 미국, 한국, 국제가격이 다 궁금한데 모두 수집해서 표시할 수 있나? 단위가 다르면 단위 통일해서 한 차트에 그리면 좋을텐데."_ → 선택: 달러/톤 · 한국 철강은 일단 뺌(무료 일별 출처 미확인) · 세금 빼고 비교 · 맨 위 추가·기존 차트 유지 (2026-11-09).

**비자명한 사실 (재조사 금지)**:

- KOMIS 철광석 가격기준 코드가 예고 없이 793→878 로 바뀌어 옛 코드가 **HTTP 200 빈 배열**을 줬다 — 이제 `scripts/lib/komis.py` 의 `resolvePriceCode` 가 이름으로 찾는다.
- 새 시리즈: `COPPER_LME`(KOMIS, USD/t) · `COPPER_KR`(조달청 비축 판매가, 원/t **부가세 포함**) · `HRC_CN`(SHFE 주력월물 결산가, 위안/t **증치세 포함**). DB 는 원값 그대로, 환산은 `lib/commodityUnits.ts` 에서만.
- 조달청은 **구리를 아예 안 파는 날**이 있다(5년 중 17일) — 실패가 아니다(`collect_pps_metals.py` 의 `isNoSale`). 「구리」 글자가 있는데 행을 못 읽거나 목록이 0건이면 exit 1.
- SHFE 는 장중엔 파일이 있어도 결산가가 비고, `小计` 소계 행이 미결제약정 최대라 숫자 월물만 본다. **GHA(미국 IP)에서도 열린다**(11-09 수동 실행 4단계 전부 성공).
- 수집기 3종은 받은 값을 저장한 «뒤» 실패를 exit 1 로 드러낸다 — 기본 조회 범위(조달청 1쪽 ≈ 10영업일 · SHFE 10일)보다 오래 끊기면 `--backfill-years N` 으로 메운다.
- dev 화면에서 새 선이 잘려 보이면 낡은 캐시다 — `scripts/.env` 무효화 주소가 3000 인데 dev 가 3001 에 뜬다(`gotchas-playwright-ui.md` 에 이미 있음).

**재개 지점**: 끝났다. 내일 06시대 정기 GHA(`collect-steel-kr.yml`)가 4단계 모두 초록인지만 본다. 한국 열연(철강) 가격은 사용자 선택으로 보류 — 무료 일별 출처를 찾으면 같은 비교 차트에 한 선을 더한다.

**검증**: `npm run check-all` EXIT 0(vitest 542) · `verify_call_contracts.py` 위반 0 · 실패 경로 시험 11건 통과(실물 판매 중단 글 3건 포함) · GHA 수동 실행 성공 · 헤드리스 캡처로 5선 확인. `verify_docs.py` 는 기존부터 있던 `gotchas-ci-deploy.md` 상한 초과 1건(이번 변경과 무관).

## 이전 상태 · 재개 지점 (2026-11-03, **financials 결산일 중복 29묶음 정리 + 재발 경로 차단**)

> 이 세션의 관통 주제: 11-02 회차가 「자빌만」이라 넘긴 중복이 실제로는 비-12월 결산 9개사 29묶음이었다. 원인을 재현으로 확정하고, 정본을 회사마다 판정해 정리한 뒤, 검사기와 수집기 양쪽에 다시 못 생기게 막았다.

**결과**: 커밋 `a69e50b`(마이그레이션 `20261103000001` · `verify_financials_sanity.py` 5번 「결산일 중복」 · gotchas) + 이번 마무리 커밋(`collect_financials.py` 연간 손익이 비면 그 회사 스킵 · 회귀 `scripts/lib/test_yf_fiscal_offset.py` 4건 · gotchas 2편). DB: 8개사 24행 삭제 · 헬라 5행 삭제 + 4행 fiscal_year +1 → 결산일 중복 0.

**사용자 지시**: 상위 세션 위임(조사 → 원인 재현 → 정리안 승인 후에만 삭제) → _"중복 검사 포함 진행"_ → _"남은 위험도 고치고 wrap-up으로 마무리 해"_ (2026-11-02~03).

**비자명한 사실 (재조사 금지)**:

- 원인: 2026-05-21 -1 보정을 마이그레이션 `20260521000003`(기존 행)과 수집기 `243eeb1`(새 행)에 따로 넣은 사이, **일본만 보정하던 `dfad7c8` 수집기가 한 번 돌았다**(GHA run 26201157660 · 로그 만료). 현재 yfinance 로 `fy_offset=0` 을 돌리면 남은 키와 정확히 일치. 정상 실행이 같은 키를 새 기간으로 덮어 가서 «덮일 차례가 안 온 최근 키»만 남아 있었다.
- 정본: 8개사는 -1 쪽. **헬라(HLE.DE)는 반대** — 2023년부터 12월 결산이라 수집기 `fy_offset=0` 이 맞고, 마이그레이션이 옛 5월 결산 행 때문에 헬라 전체를 -1 했다. 헬라 연간 2022-05-31 은 관례상 2021 이지만 수집기가 2022 키를 다시 만들어 2021 쪽을 지웠다.
- 기존 `verify_financials_sanity.py` 는 연간 값만 봐서 29묶음이 있어도 exit 0 이었다(5번 신설로 정리 전 29건 검출 확인).
- 🔴 MCP `apply_migration`·`execute_sql` 은 DELETE 를 `declined` 로 돌려준다(권한 모드를 바꿔도). 이번엔 postgrest(`WriteSession`)로 적용했다 — 트랜잭션이 필요하면 Management API 끝점(`gotchas-ci-deploy.md` §3). 데이터 마이그레이션은 이력 표에 없다(5월 것도 없음).
- 워크트리엔 `.env`·`node_modules`·`참고/손익` 엑셀이 없다 — 본 체크아웃 것을 `set -a; . ../../../scripts/.env` · `PATH=../../../node_modules/.bin` 으로 빌려 썼다. `test_sync_pnl_sil.py` 는 엑셀이 없어 워크트리에서 수집 오류(무관).

**재개 지점**: 끝났다. 다음 분기 재무 수집(2027-01-14) 뒤 `verify_financials_sanity.py` 가 exit 0 인지만 보면 된다(결산일 중복이 생기면 5번이 잡는다). 수집 로그의 「연간 손익이 비어 … 스킵」 경고가 같은 회사에 연속으로 뜨면 yfinance 쪽 문제다.

**검증**: `npm run check-all` EXIT 0(vitest 535) · `pytest scripts/lib`(엑셀 의존 1개 제외) 520 passed · `verify_financials_sanity.py` 위반 0 · DB 결산일 중복 0묶음.

## 이전 상태 · 재개 지점 (2026-11-02, **GHA 실패 점검 — Stellantis 3분기 · 2월 결산 재무 복구**)

> 이 세션의 관통 주제: 「GHA 오류 확인」 요청에서 오늘 실패 1건(일시 장애)보다 **10월에 실패한 채 다음 분기까지 방치될 뻔한 분기 워크플로 2건**이 더 컸다. 분기 1회 워크플로는 마지막 실행이 실패면 그 분기 데이터가 3개월 빈다 — 실패 목록은 「오늘」이 아니라 **워크플로별 최신 실행**으로 본다.

**결과**: 커밋 `a9713ad`. ① `collect_stellantis_na_sales.py` — 회사 합계 줄 이름 `STELLANTIS US` 추가 · Dodge 허용치 Q 25→40 · YTD 100→200(PR 원문 자체의 차이) · 회귀 2건 → GHA 수동 실행(41448376816)으로 2026-Q3 29행 적재. ② 마이그레이션 `20261102000001` — `financials_period_semantic_check` 허용 결산월에 2 추가(야스카와 6506.T) → 10-14 재무 수집 실패 작업만 재실행, 2,275행 적재 · 야스카와 연간 5개년 확인.

**사용자 지시**: _"GHA 오류가 있던데 확인해봐"_ → _"둘 다 고쳐"_ → _"커밋하고 적재"_ (2026-11-02).

**비자명한 사실 (재조사 금지)**:

- 11-02 `verify-fnguide` 실패는 `ConnectTimeout`(응답 0) — 계약 변경 아님. 로컬 36/36 OK · 재실행 성공. 검사기 안내문(「계약이 바뀌었을 수 있다」)은 접속 실패에도 같은 문구를 낸다.
- 글로벌(yfinance) 경로는 `companies.fiscal_year_end_month` 를 쓰지 않는다(데이터 첫 연간 결산일로 판단). 글로벌 비-12월 결산사 36곳이 12 로 남아 있는 것이 현행이라 **야스카와만 고치지 않았다**. CHECK 허용 월 목록은 이제 Architecture §7-J 에 있다.
- 비-12월 결산사의 분기 번호는 「달력 분기 + 회계연도 -1」(덴소 2025-06-30 = FY2024 Q2) — 기존 규칙. 자빌(JBL)에만 같은 `period_end_date` 가 `fiscal_year` 만 달리 두 번 있는 중복 행이 있다 → 별도 세션(「비-12월 결산 글로벌사 재무 분기 중복 행 정리」, 워크트리)이 맡았다.
- `collect_stellantis_na_sales.py --auto-discover` 는 dry-run 에서도 `scripts/lib/stellantis_pr_urls.json` 을 CRLF·끝 줄바꿈 없이 다시 써서 `format:check` 를 깬다 → `npx prettier --write` 로 맞춘다.
- `collect_financials.py` 엔 dry-run 이 없다. 회사별 결산월 대조는 일회용 읽기 스크립트로 했다(scratchpad · 남지 않음).

**재개 지점**: 끝났다. 남은 것은 별도 세션의 JBL 중복 행 정리뿐. 다음 분기(2027-01)에 Stellantis 이름표가 또 바뀌면 같은 처방(gotchas-data-collection 「판매」 줄).

**검증**: `npm run check-all` EXIT 0(시험 535) · `test_stellantis_na_parsing.py` 25 passed · `verify_financials_sanity.py` 위반 0 · `verify_fnguide.py` 로컬 36/36 · DB 2026-Q3 29행(회사 합계 324,277 = 원문) · 야스카와 annual 5행.

## 이전 상태 · 재개 지점 (2026-10-31, **「기타 > 경영표준」 신설 — 그룹웨어 경영표준 종합 보고서 14편(리포트 149~162) 게시**)

> 이 세션의 관통 주제: 그룹웨어 경영표준 514건을 「분야별 지식노트 19편 → 회사 운영체계 보고서 12장+부록 2」 두 단계로 정리했다. 원고 → 검사기 → 검토 패널 6명(지적 약 160건) → 장별 수정자 6명이 원문 대조로 반영·기각 → 장 사이 넘김을 메인이 중계했다. Codex 는 전 장이 사외비라 원고 대조에 쓰지 않았고 코드 diff 검토에만 썼다.

**결과**: `/etc/mgmt-standard`(장 목차 · 사외비 — admin·holdings·mobility 만) · `/etc/mgmt-standard/[id]`(`PostDetail` 공용). posts 149~162, category '경영표준', 전부 `is_confidential=true`, `source_published_at=2026-10-30T00:00:00Z`, `source_url`=그룹웨어 경영표준 화면. `/reports` 목록·카테고리·출처 드롭다운에서 감춘다(`HIDDEN_CATEGORIES`). 지식노트 19편 = 볼트 `20_경영/사내표준`(지식 폴더 아님 — Voyage 색인 대상 밖).

**사용자 지시**: 원문 = `docs/참고/_최초지시_경영표준_2026-10-30.md`(gitignore) · 확정 결정 8개 = `docs/plans/2026-10-30-mgmt-standard.md`(이행 = `_결정이행.md`).

**비자명한 사실 (재조사 금지)**:

- 원고·도구는 레포 안 gitignore 폴더 `참고/경영표준/`(보고서/·도구/·묶음/·원본/) — 커밋되지 않는다. 다시 게시 = `npx tsx scripts/_mgmt_standard_publish.ts [--dry-run] 00 01 … 11 A B`(gitignore `scripts/_*.ts` · 같은 제목이면 UPDATE). 게시 전 검사 = `verify_report.py`·`verify_translationese.py`·`verify_report_krw.py`·`node 참고/경영표준/도구/verify_mermaid.mjs`·`verify_docnos.py`.
- 검사기 둘(`verify_mermaid.mjs`·`verify_report.py`)은 CRLF 원고를 실패로 친다 — 파이썬 `write_text` 가 07장을 CRLF 로 바꿔 Mermaid 3개가 조용히 빠진 사고 뒤 넣었다(전역 gotchas §5).
- 원문끼리 다른 값은 판정하지 않고 각 장 「확인이 필요한 곳」에 나란히 적었다(모으는 장: EPC·초기유동관리 종료·PQC·사내 R@R = 10장, PM 선정 = 07장). 경영검토 주기 = MS-A10 「정기적으로」·QM-A9.0 「최소한 매년」.
- 07장 제목을 「일감에서 수금까지」로 바꿨다(장 경계는 그대로 · 제1원리 검토 지적). 장 번호는 사용자 결정 4로 고정.
- 처리표(반영 177 · 기각 10 · 메인 결정 5 · 넘김 6 · 미결 0)·검토 원본은 세션 scratchpad 에만 있다 — 다음 세션엔 없다.
- `revalidateTag(t, 'max')` 라 게시 직후 첫 요청은 옛 캐시 — 두 번 열어 확인한다.
- 지식노트 07·11편에 고객사 이름이 남아 있다(노트 규칙엔 이름 금지가 없고 개인 볼트 사외비라 그대로 둠 — 사용자에게 알림, 답 없음).
- 커밋 전 diff 검토(오퍼스·Codex 따로) — Critical·Important 0. 기각한 Minor(휴머노이드 상세와 같은 기존 방식이라 공용 컴포넌트를 건드려 세 화면을 함께 바꾸지 않았다): ① 상세가 카테고리를 확인하지 않는다(권한자가 남의 글 id 를 쳐도 이 경로에 보인다 — 권한 상승은 아님) ② `PostDeleteButton` 이 삭제 뒤 `/reports` 로 간다 ③ 사이드바 하위 메뉴 활성 표시가 정확 일치라 상세에서 꺼진다 ④ `/etc/mgmt-standard` 경로 문자열이 목차·상세·권한·사이드바 네 곳.

**재개 지점**: 끝났다. 남은 선택지만 있다 — ① 운영 배포 뒤 운영 화면을 헤드리스로 한 번 열어 보기(로컬 3001 에서는 확인 완료) ② 노트 07·11 고객사 이름 정리 여부(사용자 판단).

**검증**: `npm run check-all` EXIT 0(시험 535) · anon REST 경영표준 0행 / service 14행 전부 사외비 · 로컬 헤드리스(admin 목차 14·Mermaid SVG·별표 0·가로 넘침 0 · hmobility·guest 차단 · `/reports` 누출 0) · 원고 검사 다섯 종 EXIT 0(Mermaid 53/0).
