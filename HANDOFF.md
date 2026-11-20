# HANDOFF

다음 세션이 그대로 이어받기 위한 인수인계 기록. **맨 위가 최신**이고, 새 블록을 쓸 때
직전 블록은 `## 이전 상태 …` 로 강등한다.

**여기엔 최근 10블록만 둔다.** 그보다 오래된 블록은 지우지 않고
[`docs/handoff-archive-2026.md`](./docs/handoff-archive-2026.md)(현재 **50블록** · 2026-11-20 실측)로 옮긴다.

---

## 최신 상태 · 재개 지점 (2026-11-20, **레포 코드 리뷰 · 1~5번 수정 · 다크모드 순서도**)

- 사용자 지시(2026-11-20): 「경영표준 보니까 다크모드에서 순서도 화살표가 잘 안보임. 전반적으로 확인해봐.」 → 「끝나고 이것도 해. - 레포 코드 리뷰를 해봐. 필요한 스킬 다 사용하고. 코덱스도 활용해」. 판정 원장·선택 = `docs/plans/2026-11-20-code-review.md`(지적 57건 · 수정 범위 「1~5번만」 · agents 레포 건 「따로 회차」).
- 다크모드: `components/reports/mermaid-block.tsx` — 다크면 mermaid `dark` 테마로 다시 그림 · `%%{init` 으로 색을 정한 도표는 흰 카드 위에. 규칙 = `report.md` §6.
- 고친 것: (1) mermaid `securityLevel` loose→strict(`click` javascript: 링크 차단 · `<br>`·`classDef`·init 은 그대로 — 헤드리스 확인) (2) 자금수지 ②·③ 은 EBITDA 가 비면 비움(④·미설명 차이 계산은 그대로) (3) 재무 `selectPeriods` — 12월 연간 행이 계정 미완이거나 손익월보다 앞서면 월별로(원래 입력 안 하는 계정이면 연말 유지 · 운영 DB 영향 0건 확인) (4) `MultiSeriesChart` 숨김 effect 에 라벨 의존성 (5) 네이버 리서치 0건 판정을 종류마다 · 하나라도 0이면 저장 없이 exit 3(`scripts/lib/test_collect_naver_research.py`).
- 🔴 커밋 당시 다른 세션이 `lib/finance/aggregate.ts` 에 「리스료 지급」을 넣는 중이었다 → 이 커밋은 내 hunk 만 담았다(그쪽 변경은 작업트리에 남김). 그쪽 미완 상태에선 `aggregate.test.ts` 「흐름 계정 10종」 시험이 실패한다(리스료가 목록엔 있고 계산엔 없음) — 내 변경 탓 아님.
- 재개 지점: 다음 회차 후보 6~11(사외비 4곳 1,000행 · 종목토론 반응 0 덮어쓰기 · 고객사 재적재·숫자 대조 검사기 7건 · UTC 날짜 · KOMIS 403) = 계획서 「다음 회차 후보」. 검사기 7건은 재현 입력을 MUST_HIT 시험으로 먼저 박을 것. agents `scan_all.py` 같은 날 정정본 49딜은 agents 세션에서.
- 기존 실패(이번 변경 무관): `verify_docs.py` 상한 초과 2건 — `Architecture.md` · `docs/gotchas-playwright-ui.md`.

## 이전 상태 · 재개 지점 (2026-11-20, **재무 3번 → 자금수지(Cash Bridge) · 더미 예시 적재 · 입력용 엑셀**)

- 사용자 지시(2026-11-20) 원문·결정 = `docs/plans/2026-11-20-finance-cash-bridge_최초지시.md` · `_결정이행.md`(결정 14 + 최종 검토 반영 표). 옛 「투하자본·자금조달」 표는 삭제.
- 화면: `/management/finance` 3번 = 최신 기간 폭포 차트 + 표(2024 연간 · 2025 연간 · 2026.09 누계 · 비고 칸). 칸 호버 = 비고, 항목 이름 호버 = 엑셀 입력 위치. 비고가 `[더미]`로 시작하면 주황 기울임(입력 예시).
- 리스(K-IFRS 16 · 같은 날 추가 · 결정 15): 사용자 확인 = 「차입」에 리스부채 없음 · 감가상각비에 사용권자산 상각 포함 · 이자비용에 리스 이자 제외 → 흐름 계정 「리스료 지급」(원금 + 이자 전액)을 ② 이자비용 바로 아래에서 뺀다. 위치는 사용자가 안 골라 권장안(②) — 자금조달 쪽으로 옮기라 하면 layout·계산 묶음만 바꾼다. 리스 더미 11행은 운영 DB 에 SQL 로 직접 넣었고 예시 엑셀 끝에도 11행(주황) 덧붙였다.
- 입력: '재무' 시트 하나(별도 시트 없음 · 사용자 지시). 새 흐름 계정 11종(정본 `lib/finance/aggregate.ts` `CASH_FLOW_ACCOUNTS`) · 현금 기준 부호(유출 음수) · **그 달까지 누계**(사용자 확정) · 8열 비고 → `finance_entries.note`(마이그레이션 `20261120000001`). 이자는 기존 「이자비용」 그대로.
- 🔴 DB 에 더미가 이미 들어가 있다(운영 DB · 흐름 계정 11종 × 2024·2025 연간 + 2026.01~09 · 비고 `[더미] …`). 적재는 upsert 만이라 원본 엑셀(새 계정 없음)을 다시 올려도 더미는 남는다 → 실제 값을 넣은 엑셀이 올라오면 그 칸만 바뀐다. 더미를 통째로 지우려면 `delete from finance_entries where note like '[더미]%'`(사용자 확인 뒤).
- 입력 담당자용 예시 엑셀(사용자 PC · gitignore 밖): `C:\Users\junghwan.yoon\Downloads\자료정리_월별손익_2026 10 31_자금수지예시.xlsx` — 주황 행 121 = 더미(리스료 11 포함) · 노란 칸 5 = 「[예시] 이런 걸 적는 칸」 · 회색 252 = 화면에서 안 쓰는 행(지워도 무방 — 사용자 판단 대기).
- 최종 검토(Codex·오퍼스 따로)에서 맞은 지적을 반영: 지난 연도 월별 행이 남으면 전기를 11월로 고르던 것(`selectPeriods` 가 연간 우선) · 재무가 손익보다 늦을 때 다른 달 영업이익 혼입 · 조회 1,000행 상한(`fetchFinanceRows` 페이지 나눔 — 2027 초 초과 예상이었다) 등. 안 고친 것 = 공용 `useRowHighlight` 의 행=버튼 접근성(다른 표 전부에 걸려 별도 과제).
- 배포 확인(2026-11-20 12:06 · `4f5bcad7`): 운영 화면 헤드리스 — 열 3개 · 더미 칸 38 · 비고 표시 31 · 막대 12 · 페이지 오류 0.
- 재개 지점: (1) 운영 화면 확인 끝 (2) 입력 담당자가 실제 값을 넣으면 「미설명 차이」 크기로 빠진 항목 점검 (3) 회색 행 삭제·더미 일괄 삭제는 사용자 결정 대기.

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

## 이전 상태 · 재개 지점 (2026-11-17, **유튜브 12편(163~174) + KIET 로봇 PDF(175) 게시 — 프로덕션 확인 끝 · Codex 비교 기록**)

> 사용자 지시(원문 = `docs/plans/2026-11-17-yt-reports_최초지시.md`): 영상 13개 → 12편(v10·v11 합침 · v12·v13 휴머노이드) · Codex 도 활용해 잘하고 못하는 것 기록 · 지시서·코드 계속 갱신 · 중복 영상 거르기 · 자세하고 쉽게. 추가: 「개발서버에서 확인하지 말고 바로 배포 → 프로덕션에서 확인」(디스크 부족) · 「남은일 끝나고 이 PDF 도 정리해 휴머노이드 보고서에 게시」.

**결과**:

- 게시 = 리포트 163~174(유튜브) · 175(KIET 『산업경제』 2026-10 「글로벌 로봇산업의 경쟁 구도 재편과 한국의 대응 전략」 · category 로봇 · 원문 링크 = 산업연구원 상세페이지). 연작 쌍 166↔165 · 167↔168 · 169↔170, 172 = 두 영상 합본, 173·174·175 = 로봇.
- 프로덕션 `verify.py` 전부 OK(별표 0 · 그림 깨짐 0) — 로봇 글은 `--route humanoid/reports` 로도 확인.
- 결정 이행 = `docs/plans/2026-11-17-yt-reports_결정이행.md`.

**이번에 뒤집힌 것 · 「이건 안 되더라」**:

- 합본 글은 본문에 두 번째 영상 주소가 없으면 중복 거르기(`already_published`)가 못 잡는다 → 본문에 `> 원본 영상:` 줄 필수(`docs/report-from-youtube.md` §2-K).
- `verify_yt_report.py` 강조 검사가 손으로 적은 부호 목록이라 `»` 와 「여는 `**` 뒤 공백」을 놓쳐 175 에 별표 2곳이 나갔다 → 유니코드 부호 전체·공백 형태로 고침(표본 추가). 원인은 정규식 일괄 치환이 짝을 잘못 잡은 것(`docs/report-from-pdf.md` §3-G).
- `verify_report_krw.py` 가 「2억1,000만 달러」 같은 복합 단위를 잘못 읽었다 → 정규식 수정·표본 추가.
- Codex 비교(경위 = `~/.claude/docs/history/codex-vs-opus-경위.md` §2 11-17 두 줄): 유튜브 지적 49 중 48 채택, PDF 10 중 9 채택 — 오퍼스는 **요약부(첫 인용·소제목·핵심 정리)에서만** 기준연도·조건을 뺀다. 그림 자리 고르기는 Codex 가 낫지 않다(31% 대 36%).

**재개 지점**:

- 11-18 회차 폴더 `scripts/_yt_report/2026-11-17/`(575MB) 통째 삭제(사용자 선택) — 재사용할 것은 먼저 레포로 올렸다: `scripts/yt_report/grab.py`(미리보기) · `prompts/answer.md`·`final.md`·`audit.md`(`<RUN_DIR>` 틀). 게시 명령·지식노트 커밋엔 안내 훅 `warn-work-method-retro`(전역). 남은 일 없음.
- 다음 유튜브·PDF 회차는 `docs/report-from-youtube.md` · `docs/report-from-pdf.md` 순서 그대로. 렌더 확인은 dev 서버가 아니라 게시 뒤 프로덕션 `verify.py`.
- (11-18 추가) 사용자 지시 「보고서·지식노트는 끝날 때마다 작업방식(지시서·코드 포함) 업데이트」 → 두 문서의 마지막 단계 = **작업방식 회고**(정본 = `wrap-up` 3단계). PDF 게시는 회차마다 새로 짜지 말고 `scripts/pdf_report/publish.py` + 대조 틀 `scripts/pdf_report/prompts/codex_check.md`(§1-A).

## 이전 상태 · 재개 지점 (2026-11-16, **협력사 페이지 폐기 — 코드·사외비 표 삭제 · 가림 fixup 합친 기록으로 재작성**)

> 사용자 지시(원문 = `docs/plans/2026-11-13-suppliers-page_최초지시.md` 5차): 「이건 쓸수 없겠다. 관련 내용 폐기하자 히스토리는 남겨놓고」 — 선택: 협력사 전체 폐기 · 가림 fixup 을 계획서 커밋에 합친 뒤 폐기 커밋.

**결과**:

- MarkLines 가 계정 정지 뒤 목적·경위·도구 해명을 요구했다(답장은 사용자). 실제 요청 수는 앞서 적은 「약 700회」가 아니라 **약 2,300회**(검색 198×2 · 상세 1,895 — 401 뒤에도 1,416회 계속)였다.
- 협력사 코드(화면·탭·권한·수집기·점수·조회) 삭제 · 고쳤던 공용 파일(`permissions.ts`·`confidential.ts`·캐시 태그·`app/oem/layout.tsx`·AGENTS·Architecture)은 서버판으로 복원 · 표 5개 삭제 마이그레이션 `20261116000001`.
- 기록은 남겼다: 협력사 커밋 전부 + 설계·계획·결정이행·지시 문서(맨 위에 「폐기됨」). 계획서 커밋의 실제 공급사 특징·품목 단어는 fixup 을 합쳐 기록에서 없앴다(커밋별 누출 검사 = 제품 이름 2개만).
- 이미 서버에 올라간 모빌리티 권한 커밋 3개(cb74982·215daf2·6494be7)는 로컬 사본을 빼고 그 핸드오프 기록만 남겼다.
- 교훈은 `docs/oem-collection.md` 맨 끝 절 · 전역 규칙(`~/.claude/CLAUDE.md` 보안 「외부 사이트를 긁기 전」).

**MarkLines 2차 메일(11-16)**: 약관 7조 9항(자동 다운로드 금지 · 양·목적 예외 없음) 위반 가능성 → 손 서명 재발 방지 확약서 요구. 그래서 같은 날 **엑셀 자동 수집 GHA 4개를 껐고**(`sync-oem-excel`·`sync-oem-production-excel`·`sync-oem-china-excel`·`marklines-adhoc-fetch` — `gh workflow disable`, 파일은 그대로) **쿠키를 지웠다**(`scripts/.env`·`.env.local`·GitHub 비밀값).

**같은 날 이어서 끝낸 것**: 수동 적재 `scripts/import_marklines_manual.py`(받은 파일을 내용으로 판별 · MarkLines 요청 0 · 절차 = `docs/oem-collection.md` 「수동 적재」) · 알림 = agents `da5c931a` `remind:marklines-excel`(월 09:00 · 봇 재기동 뒤부터) · `.env.local` 의 `MARKLINES_EMAIL`·`MARKLINES_PASSWORD` 삭제 · 로그인 브라우저 기록·시험 스크립트 삭제 · DB 표 5개 drop(`apply_migration`) · 확약서 PDF = `참고/협력사/MarkLines_Written_Statement_2026-11-16.pdf`(서명·발송은 사용자) · `Architecture.md` 상한 회복 · **원격 반영** `48032d2..dde5433`(fast-forward 30커밋 · Vercel 성공 · 옛 로컬 master = 브랜치 `backup/master-before-suppliers-discard`) · 봇 재기동(첫 알림은 다음 월요일 11-23 — 오늘 09:00 은 등록 전이라 만회 안 됨) · 마무리 때 **Vercel 운영 환경변수에도 `MARKLINES_COOKIE`·`MARKLINES_EMAIL`·`MARKLINES_PASSWORD` 가 남아 있어 지웠다**(이 커밋의 배포부터 적용) · **Codex·오퍼스 diff 검토 반영**: 적재 «뒤»에 제자리 복사(먼저 바꾸면 실패한 주가 「변경 없음」으로 영영 빠진다) · 판매 연도별 이력 파일 제외(롤링 파일로 덮으면 그 해가 두 번 더해진다 · 실물 21개 판별 확인) · 알림 만회 7일 · 전송 0건이면 실패로 남김 · **텔레그램 링크 미리보기 끔**(켜 두면 텔레그램 서버가 MarkLines 링크를 연다) · 명령을 PowerShell 에서도 도는 `-X utf8` 형태로. 기각: `.xls` 이름 판별(내용 검증은 `parse_nev_file` 이 한다) · 0행 성공(판매·생산은 구조 검증의 첫 달 문턱이 막고 중국은 기존 수집기 한계).

**🔴 재개 지점**: ① 워크플로 4개를 **다시 켜지 말 것**(확약 위반) · MarkLines 에 어떤 자동 요청도 보내지 말 것 ② 쿠키·로그인 정보가 없어 `collect_marklines*.py`·`enrich_with_marklines.py` 등 옛 수집기는 이제 돌지 않는다(일부러 둔 상태) ③ `참고/협력사/`(시드·대응표 · gitignore)는 남겨 뒀다 ④ 「웹 주소로 보고서 만들기」는 **MarkLines 주소를 거절한다**(사용자 지시 11-16 · `lib/reports/services/url-guard.ts` 의 `isMarklinesHost` · 리다이렉트도 같은 검사 · 쿠키·리퍼러 코드 삭제) — 풀지 말 것.

---

## 이전 상태 · 재개 지점 (2026-11-16, **KG모빌리티 판매 수집 GHA 실패 — networkidle → load · 원격 반영(협력사와 떼어 푸시)**)

> 사용자 지시 원문(2026-11-16): 「gha 실패 확인해봐」 → 진행 방식 선택 「CI 진단 후 수정」 · 이번 달 적재 「로컬에서 적재」 → `/wrap-up`

**결과**:

- 실패 1건 = 「KG모빌리티 차종별 판매 수집 (매월)」 11-15 정기 실행(재실행도 실패). `Page.goto(wait_until='networkidle')` 60초 타임아웃.
- 원인 = KG IR 페이지의 구글 광고 전환 요청(`googleadservices ccm/conversion`)이 응답 없이 열린 채 남아 networkidle 에 도달 못 함(간헐 · 로컬 4회 중 3회). 페이지·엑셀 버튼은 이미 떠 있다.
- 처방 = `scripts/collect_kg_mobility_sales.py` 의 대기를 `'load'` 로(버튼 visible 대기는 원래 있었다). 수정 후 로컬 dry-run 3/3 성공.
- 11월분은 로컬에서 실적재(1,135행) + 프로덕션 태그 `oem-kg-mobility-sales` 무효화.
- 함정 문서 상한 회복(KG·KOMIS·SHFE 경위를 `docs/history/gotchas-data-collection-경위.md` 로).
- **운영 반영 경로**: 원격 master 위 임시 작업 폴더로 두 커밋만 푸시 — 원격 `88a5fd4`(수정)·`48032d2`(문서) = 로컬 `2f9fe7c`·`5f8b5fc`. 협력사 커밋은 여전히 원격에 없다.
- CI 확인: 푸시 뒤 수동 실행 run `43790447746`(`48032d2`) 성공 — 엑셀 다운로드 · 1,135행 적재 · 캐시 무효화. 다음 정기 실행 12-15.

**🔴 재개 지점**:

1. **협력사 푸시 rebase 때** 로컬 `2f9fe7c`·`5f8b5fc` 는 원격 `88a5fd4`·`48032d2` 와 내용이 같다 → 빈 커밋이 되면 건너뛴다(`git rebase --skip`).
2. 진단 함정: 같은 페이지를 한 번 열어 둔 뒤 재진입하면 캐시로 통과해 「로컬 정상 → GHA IP 차단」으로 오진한다(이번에 한 번 그랬다). networkidle 을 쓰는 다른 수집기 6개(`collect_marklines.py`·`collect_uzbekistan_sales.py`·`collect_yahoo_playwright.py` 등)는 실패 기록이 없어 손대지 않았다.
3. `verify_docs` 의 `Architecture.md` 상한 초과(원격에도 있음)는 이번 변경 무관 · 미수정.

**검증**: `npm run check-all` 통과(vitest 777) · `verify_docs` = 수집 함정 문서 통과 · `Architecture.md` 1건(무관).

## 이전 상태 · 재개 지점 (2026-11-16, **모빌리티 계정 축소 — 경영관리는 스텔란티스만 · 비교·경영표준 차단 — 운영 반영(협력사와 떼어 푸시)**)

> 사용자 지시 원문(2026-11-16, 순서대로): 「모빌리티 경영관리 페이지 볼수 없게 막아. 사외비 보고서는 볼 수 있게 그대로 유지하고.」 → 「아 경영관리 페이지에서 스텔란티스만 볼 수 있게 해줘」 → 「모빌리티 계정으로 로그인해도 다 보이는데?」(미푸시가 원인) → 푸시 방식 선택 「권한 변경만 먼저」 → 「아 모빌리티 계정은 비교 페이지도 못 보게 해.」 · 「기타 경영표준도 못 보게 하고.」

**결과**:

- `lib/auth/permissions.ts` — mobility 는 `/management`(랜딩)·`/management/stellantis` 만 통과(`MOBILITY_MANAGEMENT_PATHS`), 첫 탭 = 스텔란티스. `/compare` 는 guest·mobility 차단. `/etc/mgmt-standard` 는 `canAccessConfidentialReports && role !== 'mobility'`. 조직도 이미지 API 는 admin·holdings 만.
- 그대로 둔 것: mobility 의 사외비 보고서 열람·게시 · 고객사 · 협력사 · 챗봇. holdings·hmobility·guest 변화 없음.
- 탭 줄(`ManagementTabs`)·왼쪽 메뉴(하위 메뉴 포함)·`proxy.ts` 가 전부 `canAccess` 라 판정 함수 한 곳으로 같이 바뀐다.
- **운영 반영 경로**: 원격 master(`c73fcec` 백업 봇) 위에 `.claude/worktrees/` 임시 작업 폴더로 `cb74982`(권한)·`215daf2`(조직도 문구) 두 커밋만 만들어 푸시. 협력사 커밋은 원격에 안 올라갔다. 로컬 master 에는 같은 내용을 cherry-pick(`6b57453`·`c51a21d`)으로 얹었다 — 핸드오프·메모리가 해시로 가리키는 협력사 fixup·KG 커밋 번호를 바꾸지 않으려고 rebase 는 하지 않았다.

**🔴 재개 지점**:

1. **협력사 푸시 때** origin/master 위로 rebase 하면 로컬의 `7fed786`·`6b57453`·`c51a21d` 가 원격 `cb74982`·`215daf2` 와 겹친다 → 충돌 나면 원격 쪽 권한 코드에 협력사 줄(`canAccessSuppliers`·「고객사·협력사」 문구)만 더한 것이 정답. 내용이 같아 빈 커밋이 되면 건너뛴다.
2. ~~남은 빈틈~~ **해결(사용자 「막아」)**: `/reports/<번호>` 직타로 경영표준 글이 열리던 것을 `canReadPost(role, post)`(사외비 + 경영표준 카테고리 판정)로 막았다 — 상세 화면·HTML·동영상 첨부 프록시 셋 다. 원격 `6494be7` · 로컬 cherry-pick `aa4b32d`. 협력사 푸시 rebase 때 이것도 원격과 겹친다(1번과 같은 방식으로 푼다).
3. 화면 눈 확인 안 함 — mobility 로 로그인해 경영관리 탭 줄 = 스텔란티스 하나, 왼쪽 메뉴에 비교·경영표준 없음.

**검증**: `npm run check-all` 통과(로컬 master vitest 774 · 원격 기준 작업 폴더 vitest 744) · `verify_docs` 는 기존 `docs/gotchas-data-collection.md` 상한 초과 1건(이번 변경 무관 · 미수정).

## 이전 상태 · 재개 지점 (2026-11-13 밤, **협력사 페이지 1단계 — 코드·화면 완성 · 적재 0곳(MarkLines 계정 정지 의심) · 미푸시(사용자 지시)**)

> 사용자 지시(원문 = `docs/plans/2026-11-13-suppliers-page_최초지시.md` · 실명판 `참고/협력사/`): `/oem` 아래 「협력사」 — 우리 제품(하프샤프트·얼터네이터)을 공급할 수 있는 업체를 지역별로 모으고 경쟁사 납품 업체부터 컨택 순위. 4차 지시(밤): 「너 때문에 아이디가 정지된것 같은데? … 일단 만들 수 있는것만 만들고 그만해. 정리는 하되 푸시는 하지말고」.

**결과** (계획서 `docs/plans/2026-11-13-suppliers-page-phase1.md` Task 1~10 · SDD 원장 `.superpowers/sdd/2026-11-13-suppliers-page-phase1/progress.md`):

- 사외비 표 5종 `sourcing_*`(시드: 제품 2 · 품목군 14 · 경쟁사 10 — 값은 `참고/협력사/sourcing_seed.json` 만) · 상세 파서 · MarkLines 검색 모듈 · 수집기(`--resume`·부분 저장 포함) · 점수·순위 순수 함수 · 조회 계층 · 권한(`canAccessSuppliers`) · OEM 탭 · 목록·상세 화면. 각 Task 검토 통과(Approved).
- **적재된 협력사 0곳.** 본 수집 1회차가 1초 간격 약 30분·요청 약 700회 뒤 401 로 끊겼고, 그 뒤 로그인이 되지 않았다(사용자: 계정 정지 의심). 화면은 빈 상태로 뜬다.

**🔴 재개 지점**:

1. **MarkLines 에 요청하지 말 것** — 계정 상태를 사용자가 확인하기 전까지. 재수집 전 확인 사항 = `docs/oem-collection.md` 「MarkLines 계정 정지 의심」 절(간격 상향·하루 상한은 사용자 승인 뒤).
2. **푸시 전 필수 2가지**: ① fixup 커밋 2개(`2e09752`·`3756fad`)를 `b7542d7` 에 합친다 — `b7542d7` 계획서에 실제 공급사 지문(종업원 수·지역·연도)과 실제 품목·공정 단어가 들어 있다(`git rebase -i --autosquash` 는 이 환경에서 못 쓰니 `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin/master` 를 사용자 확인 뒤 · 남의 미커밋 파일이 워크트리에 있으니 먼저 확인). ② 최종 전체 검토(SDD 마지막 단계 · Codex 와 오퍼스 따로)는 사용자 지시로 건너뛰었다 — 원장의 `minor (deferred)` 목록이 그 입력이다.
3. 첫 수집 뒤 할 일: Task 4 Step 5 DB 검증(지역별 건수·links·빈 이름 0) · 상세 화면 「점수 합계 = 목록 점수」·경쟁사 강조 확인 · 사용자 화면 확인(결정 12).
4. 남은 다듬기(원장 deferred): 라벨·배지 색 목록/상세 중복 → `lib/sourcing` 공용 · `regionCounts` 화면 미사용 · Architecture.md:95·:1045 탭 목록 위치가 옛 `app/oem/layout.tsx`.

**🔴 이번에 배운 것**:

- 유료 사이트에 대량 수집을 걸기 전에 이용 한도·속도를 확인하거나 사용자에게 묻지 않았다(교정 원장 기록). 「요청 간격 1초」는 서버 부하 예절일 뿐 계정 보호 기준이 아니다.
- 401 을 일반 실패로 세어 받은 479곳을 통째로 잃었다 → 로그인 풀림은 즉시 멈추고 저장(`exit 4`), Ctrl+C·실패율 초과도 저장.
- `PLATFORM_SESSION` 쿠키는 로그인 전에도 있다 — 로그인 판정은 상세 JSON 의 `profile` 로만.
- `npm run typecheck` 가 `.next/types/validator.ts` 로 실패하면 서브에이전트의 빌드·dev 가 남긴 낡은 생성 타입이다 → `npx next typegen`(지우지 않아도 됐다).
- 공개 레포 누출 검사는 「추적 파일 전체」가 아니라 **이 브랜치가 더한 줄**만 봐야 판정이 선다(전체는 기존 회사 데이터와 155파일 겹침).

**검증**: `check-all` 통과(lint·format·typecheck · vitest 769) · pytest `scripts/lib` 1076 · `verify_revalidate_tags` 0 · `verify_docs` 는 기존 `gotchas-data-collection.md` 상한 초과 1건(이번 변경 무관) · 화면은 헤드리스로 admin(빈 상태)·guest(차단) 확인.

---
