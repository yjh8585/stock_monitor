# 레포 코드 리뷰 (2026-11-20)

## 사용자 지시 원문

> 2026-11-20: 「경영표준 보니까 다크모드에서 순서도 화살표가 잘 안보임. 전반적으로 확인해봐.」
>
> 2026-11-20(작업 중 추가): 「끝나고 이것도 해. - 레포 코드 리뷰를 해봐. 필요한 스킬 다 사용하고. 코덱스도 활용해」
>
> 2026-11-20 선택(질문 대화상자): 수정 범위 = 「1~5번만」 · 반영 = 「커밋+운영 배포」 · 판정 원장 = 「레포에 저장」 · agents 레포 DART 대장 = 「따로 회차로」 · 이 문서 = 「새로 만듦」

## 범위·방법

- 범위: 지난 전수 리뷰(2026-09-08, `9f79851`) 이후 `HEAD`(`f77ea926`)까지 — 커밋 800개 · 약 4.8만 줄(테스트·픽스처·자동 생성 타입 제외).
- 세 갈래를 따로 돌려 합쳤다.
  - `code-review` 스킬(오퍼스, high) — 전체 범위.
  - Codex(GPT, high) — 공개 코드 diff 3묶음(TS · `scripts/lib`+`customer_parsers` · 나머지 scripts). **사외비 도메인(`lib/pnl` `lib/plan` `lib/inventory` `lib/personnel` `lib/finance` `lib/org-chart` `components/management` `app/management` `scripts/sync_*`)은 보내지 않았다.**
  - 오퍼스 서브에이전트 — 사외비 도메인 + 권한·보안 경로 전체.
- Codex 지적 45건은 오퍼스 서브에이전트 4명이 실제 코드로 검산했다(상당수 함수 직접 호출로 재현). 나머지는 메인이 직접 확인.
- 기계 검사: `npm run check-all` 통과(테스트 759) · `pytest` 1,102 통과.

판정 표기: **확인**(실제로 일어남) · **확인-잠재**(코드상 맞지만 현재 데이터·운영에선 아직 안 일어남) · **부분** · **기각**.

## 이번 회차에 고치는 것 (1~5)

| #   | 위치                                       | 판정       | 내용                                                                            |
| --- | ------------------------------------------ | ---------- | ------------------------------------------------------------------------------- |
| 1   | `components/reports/mermaid-block.tsx`     | 확인       | `securityLevel: 'loose'` 면 mermaid 가 `click` 링크를 `sanitizeUrl` 하지 않는다 |
| 2   | `lib/finance/aggregate.ts` 자금수지        | 확인       | 영업이익이 비면 EBITDA 는 비우지만 ②·③ 소계는 나머지 항목만으로 숫자를 낸다     |
| 3   | `lib/finance/aggregate.ts` `selectPeriods` | 확인(코드) | 연간(12월) 행이 있으면 `requiredAccounts`·`cap` 을 건너뛴다                     |
| 4   | `components/charts/MultiSeriesChart.tsx`   | 확인       | 숨긴 선의 종목을 바꾸면 새 선이 숨겨진 채 남는다                                |
| 5   | `scripts/collect_naver_research.py`        | 확인       | 산업·종목 목록 중 하나만 0건이어도 exit 0                                       |

#### 상세

1. 근거: `node_modules/mermaid/dist/chunks/mermaid.core/chunk-5ZQYHXKU.mjs` `formatUrl` 이 `securityLevel !== "loose"` 일 때만 `sanitizeUrl`. 본문은 외부 원문의 LLM 요약이라 악성 블록이 섞일 수 있다. 게시된 92블록 중 `click` 사용 0 · `<br>` 사용 11(엄격 모드에서도 보이는지 확인할 것).
2. `sumCells` 가 null 을 건너뛰어(`aggregate.ts:280`) ② = 운전자본·이자·세금만의 합(대개 큰 음수)이 된다. 손익 최신월 ≠ 재무 기준월이면 매번.
3. `sync_finance.py:71-85` 가 월=12 를 annual/12 로 적재하므로, 12월 마감 중 일부 계정만 먼저 넣으면 연간 열이 비거나 손익 11월과 섞인다.
4. effect 의존성(`MultiSeriesChart.tsx:137`)에 종목 라벨이 없다. `/etc/stock-prices` 에서 「선 숨김 → 그 종목 교체」로 재현.
5. `collect_kind` 는 1쪽 옛 글까지 세므로 정상 목록은 0일 수 없다 — 한 종류만 0이면 그 목록이 고장 난 것.

## 다음 회차 후보 (6~11)

| #   | 위치                                                    | 판정      | 내용                                                          |
| --- | ------------------------------------------------------- | --------- | ------------------------------------------------------------- |
| 6   | 사외비 조회 4곳                                         | 확인-잠재 | 페이지 나눔 없이 단건 조회 → 1,000행 넘으면 조용히 잘림       |
| 7   | `lib/naver/board.ts` + `scripts/collect_naver_board.ts` | 확인-잠재 | 반응 조회 실패 시 기존 실값을 0 으로 덮음                     |
| 8   | `scripts/lib/customer_breakdown.py`                     | 부분·확인 | 재처리 실패 시 영구 빈 문서 · 검증 성공 행이 실패 행에 가려짐 |
| 9   | 고객사 숫자 대조 검사기                                 | 확인-잠재 | 같은 갈래 구멍 7건 — 층 = 증명                                |
| 10  | `scripts/collect_customer_docs.py:356`                  | 확인      | GHA(UTC) `date.today()` → 일정 날짜 하루 이르게               |
| 11  | `scripts/lib/komis.py:139`                              | 확인      | 403 을 빈 결과로 보고 3회 재시도                              |

#### 상세

6. `lib/pnl/source.ts` `getFixedVariable` · `lib/inventory/source.ts` · `lib/personnel/source.ts` · `lib/plan/source.ts`. 2026-11 실측 537·552·408·310행, 고정비는 2027 3분기 추정. `lib/finance/source.ts` 처럼 PK 전체 정렬 + 1,000행 페이지.
7. `board.ts:191` 의 `catch { continue }` 로 0 이 남고 `collect_naver_board.ts:59-66` 이 7일치를 upsert 해 실값을 덮는다(현재 해당 0행). 실패한 글은 반응 칸을 빼고 저장하거나 exit 3.
8. (가) `--doc-id`·`--load` 재처리 중 insert 실패 시 옛 `breakdown_at` 이 남아 정기 실행(`breakdown_at is null`)이 영영 안 집는다 — 코드 SHORTCUT 주석의 「다음 실행이 다시 넣는다」가 이 경우 틀림. RPC 로 묶거나 지우기 전에 `breakdown_at` 을 null 로. (나) `:203` 같은 키·같은 값이면 먼저 온 검증 실패 행이 이긴다(재현).
9. 근거 없는 ×1000 환산 통과(`quote_check` 첫머리에 한계로 적힘 · 가이던스는 `scale_mismatch` 로 막았으나 breakdown 엔 없음) · `-$50` 부호 소실 · 모델이 적은 외화 미대조 · 미래 연도 오기 통과 · 대수에 `million` 단위 · 다른 문장 연도로 날짜 확인 · PDF `page=null` 이면 문서 전체를 근거로 + `double_read` 가 실패 사유를 안 봄. 하나씩 고치기 전에 재현 입력을 MUST_HIT 시험으로 먼저 박는다. 현재 DB 발생 0건.
10. 이미 있는 `ir_lists.seoul_today()` 로.
11. 「401·403·429 즉시 멈춤」 규칙 위반. 공개 API·총 9회라 차단 위험은 작다.

### 낮음·참고

- 감성 분류가 빈 배열이면 `ok:true`(다음 실행이 다시 집어 자가 복구) · 고객사 YoY(지적 방향은 `ir.ts:693` 의 의도된 설계, 반대 방향 — 당해 회사 공시·전년 시장 값 — 이 실제 결함) · 순이익 정의 섞인 누계(현재 회사별 정의 고정) · 통화 빈 종목에 상대 통화(현재 0종목) · 네이버 같은 offset 반복(중복 키 upsert 를 PG 가 거부해 exit 3) · 고객사 요약 링크가 상세에 없는 카드 · 쪽 번호 3자리 상한 불일치(최대 188쪽).
- 스텔란티스 FY 전망 상자 일부만 읽으면 LLM 보완 안 함(라벨이 바뀌면 이익률 전망 조용히 누락 · 중간) · GM 판매 0건 시 실적까지 실패(기본 400일이라 미발생) · 중국 엑셀 월 이름 중복(생산 시트 188줄이 더 실질) · 뉴스 요약 `rc=1` 에 링크 3개 허용 · 명시된 0 누락 · 비차량 반도체를 `기타` 로 내리는 변경 거부 · IR 수집기 외부 링크 호스트 검사 없음(모든 어댑터 공통 · 빈패스트 상대경로면 `MissingSchema` 로 목록 전체 실패 — 검산 중 추가 발견).
- 가이던스 선삭제 후 upsert 실패(재처리 때만, 오류가 화면에 뜸) · 중국 import 가 엑셀에 없는 연도까지 삭제 후보(현재 5% 상한이 막음) · `--add-file` 회사 불일치 미검사 · 감사보고서 주석 열 휴리스틱 · 제품 분류 변경안이 최신 값을 덮음(일회성, 적용 끝 · 170줄 주석이 거짓) · 고객사 문서 첫 조회 페이지 없음(최대 43행) · `settle.py` 실패 시 `KeyError` · `grab.py` 옛 미리보기를 성공으로.
- 게시글 API `GET /api/posts/[id]`·목록이 `canReadPost` 를 안 씀(경영표준 17편 전부 `is_confidential=true` 라 현재 영향 없음 — 방어 보강) · 종목토론 자동 글만 있는 쪽이면 10쪽까지 · `latest_haiku()` 모듈 최상단 · 엑셀 적재 apply 동시 두 번 · 로그인 시도 제한 없음·30일 토큰 · 비밀값 `?secret=` 허용 · 보고서 HTML iframe `sandbox` 없음(관리자 스크립트만 씀).
- `AGENTS.md` 「`<Toaster />` top-center 고정」 ↔ 코드 `top-right`(`app/layout.tsx:54-56` 주석이 의도 설명) — 문서가 낡음.

### 다른 레포 (agents — 따로 회차)

- `scripts/dart_eval/scan_all.py`(agents 477줄): 같은 날 원공시·정정본이면 `r["dt"] > best["dt"]` 비교라 먼저 온 원공시가 `is_latest` 로 남는다. agents 대장 `docs/data/ma-valuation-params.json` 실측 **49딜**. `(dt, rcp)` 튜플 비교 후 대장 재계산. 같은 폴더 `restore_contract_pages.py`(경로 검사 · 중단 후 명세 누락)·`fetch_contracts.py`(`--rcp` 가 최신본 거름 뒤)도 agents 쪽에서.
- 이 레포의 `scripts/dart_eval/*` 사본은 2026-10-14 이관 뒤 실행 가드로 멈춰 있다.

## 기각

- 「최신 하이쿠 + 강제 `tool_choice` 가 400」 — `claude-api` 스킬 `model-migration.md` Haiku 5.5 절: 「Claude Haiku 5.5 accepts a forced tool_choice, with thinking on too」. 400 은 Opus 5.5·Sonnet 5.5·Fable 5.1/5.2.
- IR PDF 다운로드 미완성 파일 — 유일한 호출부가 매번 `TemporaryDirectory`.
- `verify_call_contracts.py` 필수 키워드 인자 누락 — 바로 다음 줄(173)이 이미 검사한다.

## 경위 메모

- Codex 는 diff 만 봐서 심각도를 높게 매기는 경향(높음 7건 → 검산 후 높음 0). 대신 검산자가 Codex 가 놓친 피해를 둘 찾았다(종목토론 0 덮어쓰기 · 빈패스트 상대경로 예외).
- 사외비·권한 갈래는 Codex 에 안 보냈고, 중간 등급 2건(1번 보안 · 6번 1,000행)이 이 갈래에서만 나왔다.
