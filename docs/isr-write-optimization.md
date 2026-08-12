# ISR Write 최적화 — 측정 이력과 조치 (재개용)

> Vercel Hobby ISR Writes 한도(200K/월) 초과 대응 기록.
> 관련 메모리: `project_vercel_isr_write_2026_06_04`.

## 0. 🔴 먼저 읽을 것 — 이메일로 진척을 판단하지 말 것

Vercel 의 "Approaching your limits" 메일은 **100% 에서 문구가 고정**되고 **14일마다 자동 재발송**된다.
사용량이 293K 든 201K 든 **똑같은 메일**이 온다.

| 메일 날짜                                  | 표시     | 직전과 간격        |
| ------------------------------------------ | -------- | ------------------ |
| 2026-05-26                                 | 50%      | —                  |
| 2026-05-28                                 | 75%      | 2일                |
| 2026-06-11 · 06-25 · 07-09 · 07-23 · 08-06 | **100%** | 각 **정확히 14일** |

그래서 두 번 손을 보고도 "또 왔네, 소용없었나"가 반복됐다. **실제로는 개선되고 있었다.**
진척은 **대시보드 Usage 탭에서만** 확인된다(Vercel MCP 에 사용량 조회 도구 없음).

## 1. 측정 이력

| 시점           | ISR Writes | 한도 대비  | 비고                        |
| -------------- | ---------- | ---------- | --------------------------- |
| 2026-06-04     | 293K       | 147%       | 최초 진단                   |
| 2026-07-14     | 267K       | 134%       | 1차 조치 후                 |
| **2026-08-06** | **201K**   | **100.5%** | 2차 조치 후 · 3차 조치 직전 |

참고(2026-08-06 동시 측정): ISR **Reads 36K**/1M · Function Invocations 60K/1M · Fluid CPU 57분/4h ·
Fast Origin Transfer 2.42GB/10GB. **초과 지표는 ISR Writes 하나뿐.**

🔴 **Writes(201K) : Reads(36K) = 5.6 : 1** — 한 번 읽힐 때마다 여섯 번 다시 만든다. 크론이 매시간
무효화하는데 실제 방문은 하루 ~1,200건이라, 아무도 안 보는 사이 재생성만 돈다. 이 비율이
1 미만으로 내려가지 않는 한 구조적 낭비는 남아 있다.
⚠️ Reads 가 6/4 의 102K → 36K 로 **65% 줄었다**. 쓰기 감소분에 트래픽 감소 몫이 섞여 있다는 뜻이라,
**한도에 간당간당하게 맞추지 말고 여유를 확보할 것**(방문이 6월 수준으로 돌아오면 다시 넘친다).

## 2. 과금 메커니즘 (전략의 전제)

- **ISR Write = 크기 기준.** 1 write unit = 자동압축 후 8KB. 재생성 1회 = `⌈압축 payload / 8KB⌉` unit.
- **dedup: 재생성이 돌아도 내용이 이전과 같으면 write 0.**
- **배포마다 캐시가 리셋된다** — 캐시 키에 Build ID 가 들어가 이전 배포 캐시를 재사용하지 않는다
  (`node_modules/next/dist/docs/.../use-cache.md`, Vercel ISR 문서). 배포 1회 = 전 라우트 full 재기록.
- 따라서 레버는 **(a) payload 바이트 축소** + **(b) 라우트 무효화 횟수 축소** + **(c) 불필요한 배포 제거**.

## 3. 완료된 조치

| #   | 날짜      | 조치                                                                | 효과                                                               |
| --- | --------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| ①   | 06-04     | cacheLife 상향 12파일                                               | **거의 없음**(dedup 탓). 7-14 자체 조사로 확인                     |
| ②   | 07-14     | `vercel.json` `ignoreCommand` 로 백업 봇 커밋 배포 스킵 (`8957162`) | 작동 중 — 배포 이력에서 백업 커밋 11건 전부 `CANCELED` 확인(08-06) |
| ③   | 07-14     | `/oem` 집계를 DB 뷰로 이관 (`644a576`)                              | 프리렌더 timeout 해소                                              |
| ④   | **08-06** | **재무 JSONB 슬림화** — `lib/types.ts` `trimFinancialYears()`       | 3뷰 재무 645KB → 374KB (**-42%**)                                  |
| ⑤   | **08-06** | **FX 태그를 주식 뷰 4곳에서 분리**                                  | FX 수집(하루 ~5회)이 무거운 라우트를 더는 재기록하지 않음          |
| ⑥   | **08-06** | **`business_summary` 지연 로딩**                                    | 3뷰 payload 에서 283KB 제거                                        |

### ④ 재무 JSONB 슬림화 (UI 변화 0)

뷰가 **평균 4.9개년 × 11필드**를 담는데 화면은 **4개년 × 8필드**만 읽는다.
**뷰 마이그레이션이 아니라 매퍼(`lib/types.ts` `trimFinancialYears`)에서 자른다** — ISR 과금 대상은
캐시 payload(=매퍼 반환값)라 효과가 같으면서 뷰 재작성 위험이 없고 순수 함수라 테스트가 쉽다.

- 제거: `eps` · `total_liabilities` · `total_equity` (`FinancialYear` 타입에서도 삭제) + 최신-4년 이전 연도
- 🔴 **`operating_income` 은 남길 것** — `financialFormatter.ts:83-88` 이 펼침 행의 "영업이익 ▲x%" 에 쓴다
- 🔴 **연도 폭을 좁히지 말 것** — `StockCells.FinancialCells` 의 부채비율·재고회전율이 최신-3년까지 fallback
- 🔴 **매출이 있는 최신 연도는 4년 폭 밖이어도 보존** — `stockSort.getFinancialSortValue` 가
  `rev_${latestYear}` 정렬에서 **전 연도를 훑어** 매출이 있는 가장 최근 연도를 찾는다.
  해당 회사는 현재 0곳이지만 데이터가 변하면 생기고, 그때 **정렬이 조용히 바뀐다**
- 회귀 테스트 `lib/types.test.ts` 8건

### ⑤ FX 태그 분리 (⚠️ 원래 설계가 틀렸었다)

**옛 문서의 옵션② 는 "환율 fetch 를 별도 `'use cache'` 함수로 분리"였는데 이는 효과가 없다.**
`app/domestic/page.tsx` 등은 페이지 레벨 `'use cache'` 없이 `getDomesticData()` 를 await 하므로,
라우트의 프리렌더 결과가 그 캐시 엔트리에 **의존**한다. 함수를 쪼개도 페이지가 여전히 await 하니
무효화되면 **라우트 전체가 재기록**된다. (같은 문서 §1 이 이미 "라우트 안에서 쪼개도 소용없다"고
적어 두고 실행 단계에서 스스로를 뒤집고 있었다. 근거:
`node_modules/next/dist/docs/01-app/02-guides/how-revalidation-works.md:45`,
`.../01-directives/use-cache.md:310-328`)

실제로 듣는 것은 **라우트가 그 태그에 의존하지 않게 만드는 것**이다 — 함수 분리는 불필요.

1. `lib/{related-stocks,domestic,parts-top100,plan}/source.ts` 에서 `cacheTag('exchange_rates_live')` 제거
2. `scripts/lib/revalidate.py` `COLUMN_TO_TAGS['exchange_rates_live']` 에서 뷰 태그 3개 제거

🔴 **양쪽을 함께 봐야 한다** — 한쪽만 되돌리면 조용히 원상복구된다.
`lib/series.ts:79` 의 태그는 **유지**(`/etc` 차트용, payload 가 작다).
트레이드오프: 환산 시총·매출이 최대 ~1시간 지연. 주가·등락률은 각 뷰 태그로 즉시 갱신되어 무영향.

### ⑥ `business_summary` 지연 로딩

펼침 행에서만 쓰는데 전 행(도메스틱 406행)에 실려 3뷰 합 283KB 였다.

- `RelatedStockRow`·`DomesticStockRow` 에서 `business_summary`·`summary_updated_at` 제거
- `GET /api/companies/[id]/summary` (보호 라우트) + `components/common/useCompanySummary.ts` 훅
- `buildDescription(row, latestYear, businessSummary)` — summary 를 row 가 아니라 **인자로** 받는다
- 검증(08-06, dev): payload 에서 `business_summary`·`total_equity`·`eps` **0건**, 표 정상 렌더,
  펼침 시 로딩 표시 → API 1회 → 설명 도착, 콘솔 에러 0건

## 4. 기각된 옵션 (다시 꺼내지 말 것)

- **옵션③ `select('*')` → 컬럼 목록**: **효과 0으로 실측 기각**(2026-08-06). `related_stocks_view` 는
  정확히 23컬럼을 반환하고 `mapRelatedStockRow` 가 **그 23개를 전부** 읽는다. 뺄 컬럼이 없다.
  옛 문서가 "효과폭 불확실 → 먼저 감사"라 적어 둔 것을 감사한 결과다.
- **옵션④ cacheLife 상향**: dedup 탓 실효 미미.
- **옵션② 원안(함수 분리)**: 위 ⑤ 참조 — 라우트 의존이 남아 무효.
- **옵션⑥ 뷰 수술(재무를 뷰 payload 에서 제거)**: Runtime Cache 과금 단가 미확정 + 광범위 수정. 최후.

## 5. 남은 옵션 (다음 측정 후 판단)

1. **`/domestic` 은 406행을 payload 에 싣지만 화면엔 126행만 그린다**(`enableRankCutoff`).
   컷오프가 클라이언트 조작이라 단순 서버 제한은 불가하나, 검토 가치 있음.
2. **24/7 시장 크론 야간 저빈도화** — `/etc` 가 최다 무효화. 신선도 트레이드오프.
3. **Vercel Pro($20/월)** — 200K → 2M. Supabase 도 Free 로는 구조적 해결 불가 상태
   (메모리 `project_supabase_quota_2026_08_03`)라, 무료 티어 졸업 여부를 함께 판단할 것.

## 6. 재개 트리거

**2026-08-20 전후에 대시보드 Usage → ISR Writes 를 재측정하고 이 표에 한 줄 추가할 것.**
(메일은 14일마다 계속 오므로 판단 근거가 되지 못한다.)

- 200K 아래로 내려갔으면 종료 — 다만 §1 의 트래픽 감소 주의사항을 함께 볼 것.
- 여전히 초과면 §5 순서로.

---

## 진척 판단·배포 스킵 (AGENTS.md에서 이관, 2026-08-12)

### 🔴 Vercel 경고 메일은 진척 판단의 근거가 못 된다

ISR Write 한도 경고 메일은 **100%에서 문구가 고정되고 14일마다 재발송된다.** 즉 사용량을 절반으로
줄였어도 같은 메일이 같은 문구로 또 온다. **"메일이 또 왔으니 안 고쳐진 것"이라고 읽으면 오진이다.**

→ 실제 수치는 **대시보드 Usage 탭에서만** 확인한다(Vercel MCP 에는 usage/과금 조회 도구가 없다).

### `vercel.json` `ignoreCommand` 가 제거하는 것 = baseline write

`ignoreCommand` 는 `data/backups` 외에 diff 가 없는 커밋(= 일일 백업 봇의
`chore(backup): daily JSONB snapshot`)의 프로덕션 배포를 스킵한다.

이게 왜 한도에 영향을 주냐면 — **배포마다 ISR 캐시가 배포 단위로 리셋되고, 그러면 전 라우트가
dedup 없이 full-payload 로 재기록된다.** 이 "배포할 때마다 한 번씩 무조건 발생하는 쓰기"가
baseline write 이고, 백업 봇 커밋을 스킵해서 그 baseline 을 통째로 제거한 것이다.

⚠️ 부작용: **재배포를 트리거하려고 빈 커밋을 밀어도 소용없다**(diff 가 없으면 스킵된다).
실제 변경 diff 가 있어야 빌드가 돈다 → [`gotchas-ci-deploy.md`](./gotchas-ci-deploy.md) §2.
