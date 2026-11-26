# 디렉터리 지도

> 2026-11-27 `Architecture.md` 부록 C 에서 분리했다(문서 상한 초과 · 사용자 선택 · [경위](./history/Architecture-경위.md) 「부록 C」). 폴더가 무엇을 맡는지·라우트·모듈 구성의 정본은 이 문서다.
>
> ⚠️ 이 문서의 **약속(금지·반드시·말 것)은 AGENTS.md 「폴더별 약속」에 원문 발췌**돼 있다.
> 문구가 갈리면 **이쪽(원문)이 정본**이고, 발췌를 고칠 때는 여기도 함께 고친다.

폴더는 "어떤 책임을 맡는지" 중심으로 본다. 폴더별 컨벤션·약속은 아래 기준을 따른다.

## `app/` — Next App Router (라우트 = 페이지 단위 책임)

| 라우트                    | 책임 / 약속                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `/related-stocks`         | 21개사 메인 표(`related_stocks_view`). **컬럼 추가는 뷰부터 수정** |
| `/compare`                | 다중 회사 비교                                                     |
| `/domestic`               | 국내자동차 (421개사 + 매크로)                                      |
| `/oem`                    | OEM "전체" 탭 — MarkLines 대시보드                                 |
| `/oem/competition`        | 핵심 차종 경쟁 분석 (10종 · 월 1회 갱신) — **↓ 상세**              |
| `/oem/<slug>`             | OEM 회사별 차종 판매 — **↓ 상세**                                  |
| `/parts-top100`           | 부품사 TOP100 (Marklines 매핑)                                     |
| `/humanoid`               | 휴머노이드 완성품·부품 기업 (`humanoid_stocks_view`) — **↓ 상세**  |
| `/humanoid/motor`         | 모터 회사 (`motor_stocks_view`) — 공급 이력은 「확인」만           |
| `/humanoid/reports`       | 로봇 보고서 (`posts` category='로봇' 고정) — **↓ 상세**            |
| `/humanoid/reports/[id]`  | 로봇 보고서 상세 (`PostDetail` 공용)                               |
| `/humanoid/research`      | 증권사 리포트 (`research_reports`) — **↓ 상세**                    |
| `/humanoid/research/[id]` | 리포트 상세 (요약 마크다운)                                        |
| `/hansae`                 | 한세그룹 대시보드 + intraday                                       |
| `/etc`                    | 기타정보 (해운·철강·환율·매크로·두바이유)                          |
| `/etc/mgmt-standard`      | 경영표준 장 목차 (사외비 `posts`) — **↓ 상세**                     |
| `/etc/mgmt-standard/[id]` | 경영표준 장 본문 (`PostDetail` 공용)                               |
| `/reports`                | 보고서 + youtube-summary — **↓ 상세**                              |
| `/management`             | 경영관리 10탭 (사외비) — **↓ 상세**                                |
| `/login`                  | 세션 로그인                                                        |
| `/stock-popup/[id]`       | 주식 팝업 (3/4 주식 + 1/4 뉴스)                                    |

`/oem` 탭 네비는 `app/oem/layout.tsx`, 차트 카탈로그는 `docs/chart-guide.md`. **`/oem/<slug>`(hyundai·kia·kg-mobility·stellantis-na·uzbekistan·china) 수집 상세 → [`docs/oem-collection.md`](../docs/oem-collection.md).** `/management`는 `confidentialDb` 필수, `/reports`는 `'use cache'`+`generateStaticParams`+`updateTag`.

#### `/oem/competition` 상세

스코어보드 + 차트 10종(`components/oem/competition/`). 화면 → [`Architecture.md §5`](../Architecture.md) · 수집 → [`docs/oem-collection.md`](../docs/oem-collection.md) · 차트 → [`docs/chart-guide.md §3`](../docs/chart-guide.md). 약속만:

- 🔴 **SSOT 3개를 코드에 다시 박지 말 것** — 경쟁군 `oem_competitor_set` · 모델→Cox 브랜드 `oem_model_brand`(바꾸려면 새 마이그레이션) · 신호등 임계값 `signals.ts`의 `SIGNAL_THRESHOLDS`(판정·툴팁 문구 모두). 종합 라벨은 **AI 판단 그대로** 쓴다.
- 다중 시장은 **시장 탭**(유럽은 `countries` 배열). 순서 = `MODEL_DISPLAY_ORDER`.
- 🔴 Cox(브랜드 **유통재고**)·NHTSA는 **미국 전용** — **USA·GLOBAL 탭에만**, **GLOBAL은 등급 제외**(`usMetricsBasis`). 이상치 제외=**2배 초과 RED**. `metrics` 키를 바꾸면 차트가 조용히 비니 `types.ts`와 같이 고칠 것.

#### `/humanoid` 상세

표는 `DomesticTable` 을 `variant="humanoid"` 로 재사용한다(새로 만들지 않는다). 약속만:

- 🔴 **역할은 `robot_roles text[]`(`humanoid`/`parts`) 다중 태그** — 겸업사는 양쪽 버튼에 뜬다. 제품군 필터의 "부품 공급사" 판정도 `company_type` 이 아니라 `robot_roles` 로 한다.
- 🔴 **고객사는 수집하지 않는다**(사용자 결정 · 상위 계획서 확정 결정 12). 뷰가 `customers` 를 빈 배열로 내보내 매퍼만 호환시키고, 표는 그 자리에 비상장 기업가치를 그린다.
  🔴 **화면에 안 보이므로 위반이 조용히 일어난다**(실례 = [경위](../docs/history/Architecture-경위.md)). 판정은 `enrich_company.py` 의 **`_skips_customers()`**(로봇 역할 + **다른 페이지에 없음**)가 맡는다. ⚠️ **겸업사는 제외** — 현대차·현대모비스는 관련주·국내자동차에서 고객사를 쓴다.
- 🔴 **제품군 11종의 정본은 `product_category_map`**(`lib/types.ts` 의 `ROBOT_PRODUCT_CATEGORIES` 는 UI 사본). **카테고리를 늘릴 때 정규화 결과값을 raw 키로도 넣을 것** — 함정 4종(왕복 뭉갬·자동 페이지 매핑·`data_source` NOT NULL·트랜잭션 롤백) → [`docs/gotchas-data-collection.md`](../docs/gotchas-data-collection.md) 「휴머노이드 기업 데이터 함정」.
- 🔴 **비상장 기업가치(`valuation_usd`·`funding_total_usd`·`valuation_asof`)의 유일한 수집 경로는 `enrich_company.py`** 다(경위 = [history](../docs/history/Architecture-경위.md)). `valuation_asof` 가 **기존보다 최신일 때만** 덮어쓴다 — 오래된 라운드로 덮으면 조용히 후퇴한다.

#### `/humanoid/reports` 상세

`posts` 중 `category='로봇'` 만 본다. 목록·상세 모두 `/reports` 와 **같은 컴포넌트**를 쓴다
(`components/reports/post-list.tsx` · `components/reports/post-detail.tsx`). 약속만:

- 🔴 **로봇 글은 `/reports` 목록에서 감춘다**(사용자 지시 2026-09-11 "로봇 관련된 것은 다 휴머노이드로"). 카테고리 문자열·제목 판정의 SSOT 는 **`lib/reports/robot.ts`** — 페이지마다 다시 박으면 한쪽만 고쳐져 글이 두 곳에서 동시에 사라지거나 동시에 나타난다.
- 🔴 제외는 `PostRepository.list({ excludeCategories })` 가 `category is null OR category not in (…)` 으로 편다(게시판이 넘기는 배열 = `app/reports/page.tsx` 의 `HIDDEN_CATEGORIES` — 로봇·경영표준). **`.neq()`·`not.in` 단독으로 바꾸지 말 것** — `NULL <> '로봇'` 은 참이 아니라 카테고리가 빈 글(실측 5건)까지 조용히 사라진다. 🔴 **드롭다운 둘(`getDistinctCategories`·`getDistinctSourceNames`)에도 같은 배열을 넘긴다**(경위 → [`docs/history`](../docs/history/Architecture-경위.md)).
- 🔴 새 글의 카테고리는 LLM 이 제목 한 줄로 고르는데(`classifyCategory`), **제목에 로봇어가 있으면 `isRobotTitle()` 이 LLM 을 건너뛰고 로봇으로 고정한다.** 분류가 새면 그 글은 휴머노이드에 영영 안 나오는데 오류도 로그도 없다.
- 목록·상세 컴포넌트는 `basePath` 를 인자로 받는다. **하드코딩하지 말 것** — 정렬 헤더가 `/reports` 로 튄다.

#### `/etc/mgmt-standard` 상세

그룹웨어 경영표준(매뉴얼·규칙·기준서)을 정리한 보고서 14편(00~11장 + 부록 2). 계획 = `docs/plans/2026-10-30-mgmt-standard.md`. 약속만:

- 🔴 **카테고리 SSOT 는 `lib/reports/mgmtStandard.ts`** — 게시판(`/reports`)은 이 카테고리를 감춘다(로봇과 같은 방식).
- 목차는 `PostList` 가 아니라 장 번호 순 목록이다 — 게시판 정렬(게시일·원문 발행일)로는 장 순서를 못 세운다(`compareChapterTitle`). 제목은 `00.`~`11.`·`부록 A.` 로 시작해야 순서가 선다.
- 🔴 **글은 전부 사외비**(`is_confidential = true`) — 라우트·사이드바 하위 메뉴가 `canAccessConfidentialReports` 역할 중 **mobility 를 뺀** admin·holdings 에만 열린다(`canAccessMgmtStandard` · mobility 제외는 사용자 지시 2026-11-16 — 사외비 보고서 열람 권한과는 따로 간다). 🔴 **글 단위로도 막는다** — `/reports/<번호>` 직타·HTML·동영상 첨부 프록시가 모두 `canReadPost` 를 거친다(메뉴·목록에서 감추기만 하면 번호로 열린다). 목차 조회도 `includeConfidential` 을 인자로 넘겨 역할별 캐시를 가른다.
- 글은 게시 스크립트가 카테고리를 직접 넣는다(자동 분류기 미경유). 원문은 그룹웨어 2026-10-30 스냅샷(갱신은 수동).

#### `/humanoid/research` 상세

목록(`components/humanoid/research-list.tsx` — **보고서 게시판과 같은 표 UI**, 리포트 1건 = 1행) + 상세(`app/humanoid/research/[id]`, `MarkdownView` 재사용). 약속만:

- 🔴 **필터·페이지 넘김은 클라이언트에서 건다**(사용자 결정 2026-09-11). URL 파라미터로 옮기면 증권사×종목×기간×페이지 조합마다 `'use cache'` 엔트리가 쌓여 ISR Write 한도가 다시 문제가 된다 → [`docs/isr-write-optimization.md`](../docs/isr-write-optimization.md).

- 🔴 **선별은 수집 단계에서 끝난다** — `scripts/lib/naver_research.py` 의 `is_relevant()` 에 걸리지 않는 리포트는 **저장 자체를 안 한다**(화면에서만 걸러 두면 지운 행이 다음 수집에 되살아난다). **두 번 뒤집힌 판정이니 함수 docstring 을 읽고 고칠 것.**
- 🔴 목표주가는 `parse_target_price()` 경유 · 요약 저장 전 `clean_summary()` 통과 → 경위·수치 = [`docs/gotchas-data-collection.md`](../docs/gotchas-data-collection.md) 「증권사 리포트 수집 함정」.
- 🔴 **리포트 수집·요약을 GHA 로 옮기지 말 것** — 스케줄은 agents 오케스트레이터(`NAVER_RESEARCH_CRON` 평일 15:00, `naverResearchJob.ts` 가 수집→요약을 이어 돌린다). 기준은 **요금**이다: 요약은 구독 헤드리스라 0원이고 GHA 로 옮기면 API 키 과금이 생긴다. 회사 수집·보강처럼 **요금 쟁점이 없는 것은 GHA 로 무방**(`collect-humanoid.yml`).

#### `/reports` 상세

보고서 + youtube-summary(`'use cache'`+`generateStaticParams`+`updateTag`). **본문 규칙·사외비 게시 절차(§2-C)·유튜브 경로(§2-A·§7) → [`report.md`](../report.md) 정독.** 약속만 여기 싣는다:

- **사외비 보고서**(`posts.is_confidential`)는 RLS가 anon 읽기를 막고 `canAccessConfidentialReports`(admin·holdings·mobility)가 service_role 조회를 게이트한다 — 목록·상세 `'use cache'` 함수에 `includeConfidential`을 **인자로** 넘겨 역할별 캐시를 분리하므로 **새 호출부에서 이 인자를 빠뜨리지 말 것**.

#### `/management` 상세

경영관리 10탭(pnl·plan·stellantis·inventory·production·personnel·finance·org-chart·upload·companies). **탭별 차트·섹션 구조 → [`Architecture.md §5-A`](../Architecture.md#5-a-경영관리management-탭-구조).** 약속만 여기 싣는다:

- 사외비 테이블은 **반드시 `confidentialDb.from(...)`로 조회**. 🔴 **명단 정본은 `lib/supabase/confidential.ts`의 `CONFIDENTIAL_TABLES`**(여기 다시 나열하지 말 것 (경위 = [history](../docs/history/Architecture-경위.md))).
- 탭 노출은 `ALL_TABS` + `canAccess` 자동 필터라 **신규 경영관리 탭에 `permissions.ts` 수정은 불필요**(guest·hmobility 자동 차단). 더 좁은 권한만 명시 — `/management/upload`는 admin 전용(`ADMIN_ONLY_PATHS`).
- **단위**: DB 백만원 원본(`value_mwon`) → 화면 억원(÷100). USD는 `value × fx_rate / 100`(plan·inventory), 대여금만 억원 원본(`loan_eok`). 조직도 이미지·프록시 구성 → [`Architecture.md §5-A`](../Architecture.md#5-a-경영관리management-탭-구조).

`app/api/`:

- **공개는 `api/cron/*`·`api/revalidate*` 뿐이고 나머지는 세션 필수.** 새 `route.ts` 를 만들면 `proxy.ts` 의 `PUBLIC_PATH_PREFIXES` 와 [`Architecture.md §5`](../Architecture.md) 의 라우트 목록을 **함께** 갱신한다(목록 정본은 Architecture — 여기 중복하지 않는다. 두 곳에 두면 갈린다).
- `api/revalidate*`은 SSRF·쿠키 가드 패치 이력(commit `ea090be`). 회귀 주의.

## `components/`

폴더가 페이지 책임과 1:1 매핑. 새 컴포넌트는 같은 페이지 폴더에.

- `ui/` — shadcn 원자 컴포넌트 (수동 수정 금지, shadcn CLI로 추가). **Select는 base-ui 기반**이라 `value`≠라벨이면 root에 `items`가 필요 → [`docs/gotchas-playwright-ui.md`](../docs/gotchas-playwright-ui.md)
- `layout/`, `common/`, `charts/` — 공용 / 나머지는 페이지별(`related-stocks/`, `oem/`, `hansae/`, `management/` 등)
- **그림 클릭 확대는 `components/common/ImageLightbox.tsx` 를 재사용**(인라인 재구현 금지) — `ZoomableImage`(클릭하면 열리는 그림) / `ImageLightbox`(열림을 바깥에서 제어할 때. 조직도가 이 쪽). 원본 해상도 스크롤 + 화면 맞춤 전환 + grab-to-pan + Esc 닫기가 한 벌로 붙어 있다. 쓰는 곳은 보고서 본문(`MarkdownView` 의 `img`) · 증권사 리포트 하단 갤러리 · 조직도.
- **`<Toaster />`(sonner)는 `app/layout.tsx` body 끝 `position="top-right"` 고정 — 제거·이동 금지.** 자리 옆에 붙어야 하는 검증 오류는 toast 말고 인라인 `<p role="alert">`. 경위·이유 → [`docs/gotchas-playwright-ui.md`](../docs/gotchas-playwright-ui.md)
- `components/customers/` — 고객사 요약·실적 표·지역·차종·점유율 절

## `lib/`

도메인 모듈 + 공용 유틸. 각 하위 폴더는 응집된 책임 단위.

- 공용 유틸·React 훅 목록 → [`Architecture.md §6`](../Architecture.md). **표 행 클릭 강조는 `useRowHighlight` 훅을 재사용**(인라인 재구현 금지 — `ROW_HIGHLIGHT_CLASS`+aria/Enter·Space. sticky 셀은 행 bg를 명시적으로 덮어야 따라온다)
- `lib/supabase/` — 클라이언트 4종 (**혼용 금지**):
  - `client.ts`(클라이언트 컴포넌트) / `admin.ts`(`service_role`, 서버 전용 RLS 우회 — 사외비는 직접 X, `confidential.ts` 경유) / `anon.ts`(공개 SELECT, `'use cache'` 안 권장) / `confidential.ts`(**사외비 테이블 전용 facade** — TS union으로 명단 외 접근 컴파일 차단 + service_role 자동 라우팅. 🔴 명단은 여기 나열하지 않는다)
  - **`.range()` 다중 페이지 fetch는 `.order()` 필수** · **집계 뷰의 `SUM`은 `::bigint` 캐스팅 필수** (각각 행 누락·문자열 직렬화를 부른다) → [`docs/gotchas-data-collection.md`](../docs/gotchas-data-collection.md)
  - `fetchAllPages.ts` — 1,000행(max-rows)을 넘는 표를 끝까지 읽는 공용 반복. 호출부가 `.order()` 를 **PK 전체로** 걸어 넘긴다(고객사·손익·계획·재고·인원 조회가 쓴다 · 2026-11-23)
- `lib/auth/` — 세션·권한·사용자. **5역할**(admin/holdings/mobility/hmobility/guest) 정의는 `roles.ts`가 SSOT. 🔴 **역할을 추가하면 `roles.ts`·`users.ts`·`permissions.ts` 3곳을 모두 갱신**해야 한다(빠뜨리면 세션 거부 → `/login` 무한 리다이렉트). 계정 env 키·랜딩 redirect 주의 → [`Architecture.md 부록 B-2`](../Architecture.md). 새 라우트 권한은 `permissions.ts`.
- **도메인 폴더** (페이지·기능 단위, 각각 `source.ts`로 fetch+cache+mapping 격리. 페이지는 호출만). 폴더 목록·모듈 구성 정본 = [`Architecture.md §6`](../Architecture.md). 약속만:
  - `lib/reports/` — **레이어드**: `dto/`(Zod) + `repositories/post.repository.ts` + `services/*`. 단순 CRUD는 caller가 `PostRepository` 직접, 라이프사이클만 `PostService`.
  - `lib/pnl/` · `lib/plan/` · `lib/inventory/` · `lib/personnel/` · `lib/finance/` · `lib/org-chart/` — **전부 사외비**라 `confidentialDb` 경유 필수.
  - `lib/stellantis-forecast/` — ⚠️ **`country`의 의미가 생산=공장 국가 · 소매=판매 시장으로 정반대**이고 MarkLines 도착 시점이 달라 공통 최신월(`lastCompleteMonth`)까지만 쓴다 — **수정 전 [`Architecture.md §5-A`](../Architecture.md#5-a-경영관리management-탭-구조) 정독.** 옛 회귀·시차 상관·조건부 빈도 KPI 는 사용자 판정으로 삭제됐으니 되살리지 말 것.
  - `lib/oem/` — `source.ts` + `aggregate.ts`(pure, `aggregate.test.ts`). country×month 대용량은 **구체화 뷰**로 사전 집계하고, 🔴 **구체화 뷰는 자동 갱신되지 않으므로 원본 적재 후 `refresh_oem_agg_views()` RPC 필수**(빼먹으면 `/oem`이 옛 값을 조용히 보여준다). 경위·수치 → [`Architecture.md §7-E`](../Architecture.md)
  - `lib/humanoid/` — `/humanoid` 조회 계층(`source.ts`) + `/humanoid/research` 조회 계층(`research.ts` — `research_reports` 를 발행일 내림차순 평면 목록으로 내려준다. 수집=`collect_naver_research.py` · 요약=`summarize_naver_research.py`가 agents 레포의 헤드리스 CLI 를 부른다). 매핑은 `lib/types.ts` 의 `mapHumanoidStockRow`(내부에서 `mapDomesticStockRow` 재사용). 🔴 `cacheTag('exchange_rates_live')` 를 붙이지 말 것(ISR Write).
  - `lib/motor/` — `/humanoid/motor` 조회 계층(`source.ts`) + 공급 이력 셀 순수 로직(`supply.ts`). 매핑은 `lib/types.ts` 의 `mapMotorStockRow`·`parseSupplyHistory`(「확인」만 · http(s) 링크만). 명단 정본은 git 밖 JSON → `scripts/build_motor_seed.py`. 🔴 `cacheTag('exchange_rates_live')` 를 붙이지 말 것(ISR Write).

    **`research_reports` 컬럼 주의(2026-08-25 개편)** — 요약 규격이 「세 꼭지·900~1,500자」에서 `report.md` §3 과 같은 「6~10섹션·3,000~6,000자」로 바뀌었다(실측 산출물 8,000자대). 그에 따라 컬럼 둘이 붙었다.

    | 컬럼                      | 뜻                                                                       | 주의                                                       |
    | ------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
    | `images jsonb`            | PDF 에서 뽑아 Storage `reports/research/<kind>_<nid>/` 에 올린 차트 목록 | 본문에 실린 것은 이 중 일부(헤드리스가 고른 2~5장)         |
    | `summary_excerpt text`    | `left(summary, 800)` GENERATED                                           | 목록 전용. 직접 UPDATE 금지                                |
    | `is_delta boolean`        | **뜻이 바뀌었다**                                                        | 예전 「변화만 실린 요약」 → 지금 「전체 정리본 + 변화 절」 |
    | `excluded_at timestamptz` | 요약 대상에서 영구 제외한 시각                                           | NULL 이면 대상. 되살리려면 NULL 로 되돌린다                |

    🔴 `excluded_at` 이 필요한 이유는 **요약 대상 판정이 「summary 가 비어 있는가」이기 때문**이다. 사용자가 뺀 리포트의 요약을 지우는 순간 그것들이 도로 대상이 된다. 사람이 내린 「빼라」는 판단은 선별 규칙과 별개로 데이터에 남겨야 규칙이 완화돼도 안 딸려 온다.

    🔴 목록(`getResearchData`)은 `summary` 를 select 하지 않는다 — 144편 본문을 담으면 캐시·payload 가 1MB 를 넘어 ISR Write 한도를 다시 건드린다(`docs/isr-write-optimization.md`).

  - `lib/oem-companies/<slug>/` — `source.ts`(`'use cache'`+`cacheTag`) + `aggregate.ts`(pure) + 테스트. 상세 → `docs/oem-collection.md`
    - `china/` 는 차트를 새로 만들지 않고 **기존 차트가 받는 입력 모양**(`OemSalesGroupMonth`·`CompanyPtMixPoint`·`KgRegionSeriesPoint` 등)으로 줄여 내준다 — 화면은 「전체」 탭·회사 탭 차트 재사용(짝짓기 표 = `docs/plans/2026-10-29-oem-china-tab.md` 「화면」). 순위용 (묶음, 월) 행은 앵커 연도 − 2 부터만 싣는다(ISR Write).
  - `lib/oem-competition/` — `/oem/competition` 조회 계층(`types.ts` + `source.ts`). `'use cache'` 함수엔 **`cacheLife('days')`를 반드시 붙일 것** — 빠뜨리면 기본값 15분마다 재생성돼 ISR Write를 낭비한다(월 1회 갱신 데이터). JSONB 컬럼은 형태가 어긋날 수 있어 배열 아니면 버린다.
  - `lib/customers/` — 고객사 페이지 조회·계산(손익·명단은 `confidentialDb`, 결과만 반환)

## `scripts/` — Python 데이터 수집

prefix 컨벤션. 신규 스크립트는 같은 카테고리 prefix 사용.

- `collect_*.py` — 외부 → DB 수집. **Stellantis 북미 출하(도매)** → `stellantis_shipments`는 **수집기 2개, IR 홈페이지(`collect_stellantis_shipments_ir.py`)가 primary·EDGAR(`collect_stellantis_shipments.py`)가 보완·백필**(사용자 지시 2026-07-16). 🔴 **fnguide 접근은 반드시 `scripts/lib/fnguide_client.py` 경유**하고, **계약이 깨졌는지는 `scripts/verify_fnguide.py`로 먼저 확인**한다(주 1회 `verify-fnguide.yml`). Cox 재고일수·PDF-only(UzAuto)·현대 분기 IR 등 개별 수집기 세부 → **[`docs/gotchas-data-collection.md`](../docs/gotchas-data-collection.md)** · `docs/oem-collection.md` · 계약표 [`docs/fnguide-wcomp-migration.md`](../docs/fnguide-wcomp-migration.md).
- **`scripts/customer_parsers/`**(회사별 숫자 파서) · `collect_customer_docs.py`(목록) · `collect_customer_numbers.py`(내용)·`collect_customer_breakdown.py` · `summarize_customer_docs.py`·`summarize_customer_news.py`(문서·뉴스 주간 요약) — 고객사 수집. 약속 → [`docs/customers-collection.md`](../docs/customers-collection.md).
- `enrich_*.py` — 기존 행 보강(외부 LLM·검색). **append-only**. `onboard_company.py`는 신규 회사 추가 직후 1회 실행하며 **멱등**이라 부분 실패 시 같은 명령을 재실행하면 된다(비-12월 결산은 `--fiscal-year-end-month`).
- `e2e_smoke.py` — 9개 보호 라우트 자동 로그인 + 콘솔/네트워크 에러 + 스크린샷. 결과 `data/_e2e_screenshots/` + `scripts/_e2e_smoke_report.json`.
- **`scripts/yt_report/`**(수동 고품질 툴킷 — **커밋돼 있으니 새로 짜지 말 것**) / **`collect_yt_report.py`**(완전 자동, GHA `collect-yt-report.yml`) → [`report.md §7-B·§2-A`](../report.md) · PDF 는 **`scripts/pdf_report/`**(`report-from-pdf.md` §1-A).
- `analyze_*` / `recheck_*` / `recollect_*` / `find_*` / `inspect_*` / `debug_*` — 진단·복원. 종료 후 **`scripts/_archive/`** 이동.
- `seed_*` / `import_*` / `sync_*` / `gen_*` / `normalize_*` / `migrate_*.ts` — 시드·일회성. 종료 후 `_archive/` 이동. **단 정기 재실행 16종은 유지**(목록 → [`Architecture.md 부록 B-3`](../Architecture.md)). ⚠️ MarkLines 판매량·생산량 sync는 **페이지·레이아웃·파일명이 서로 달라 한쪽 코드를 복제하지 말 것**(→ [`docs/oem-collection.md`](../docs/oem-collection.md)) · `sync_org_chart.py`는 **로컬 전용**(Excel COM).
- `build_motor_seed.py` — 휴머노이드 「모터」 탭 명단 정본(git 밖 `참고/모터회사/motor_companies.json`) 검사 → 시드 SQL 생성. 명단을 고칠 때마다 다시 돌리므로 `_archive/` 로 옮기지 않는다.
- **사외비 적재 정책**(월별손익 sync 8종): 입력은 `참고/손익/자료정리_월별손익*.xlsx` 최신 glob. 🔴 **stdout에 금액·인원수 비노출** — dry-run 출력은 행수·연도·월·null 카운트만(합계 금지). dry-run 확인 후 본 적재. 🔴 **`sync_longterm_revenue.py`는 별개라 오케스트레이터에 등록하지 않는다**. 세부 → **[`docs/gotchas-data-collection.md`](../docs/gotchas-data-collection.md)**.
- `_*.json` / `_*.log` / `_*.py` / `_*.md` / `_*.ts(x)` — 임시 산출물. 비활성이면 `_archive/` 이동. `scripts/` **최상위의 이 확장자들**은 `.gitignore`가 패턴으로 무시한다(사외비 본문이 담긴 산출물의 커밋 방지). 새 산출물 *폴더*는 여전히 `.gitignore`에 명시 추가해야 한다.

`scripts/lib/` (공용 모듈, 모든 스크립트 재사용) — **모듈 목록은 [`Architecture.md §6`](../Architecture.md), 각 모듈의 배경·함정은 파일 docstring이 정본이다.** 여기엔 **지켜야 할 약속만** 싣는다(줄인 설명 원문 = [history](../docs/history/Architecture-경위.md)).

- `db.py`(**모든 DB 접근이 경유**. 분 단위 수집 테이블을 새로 만들면 `purge_older_than()` 보존 정책을 **반드시 함께** 붙일 것 — 없으면 무한 누적) · `revalidate.py`(**수집 후 캐시 무효화 — 필수**) · `financial_sources.py`(**financials에 행을 쓰는 수집기는 `source`를 반드시 채운다**. 문자열 직접 입력 금지 — 상수만) · `fnguide_client.py`(**fnguide URL을 스크립트에 직접 박지 말고 이 모듈 경유**) · `nhtsa_client.py`(NHTSA 무료 API — 리콜·불만 데이터, 매핑+폴백 로직) · `competition_metrics.py`(OEM 차종 경쟁 지표 계산 — 순수 함수. **대상·경쟁군의 기준월을 공통 앵커로 맞출 것**) · `perplexity_client.py`(웹 검색. 🔴 **키가 없으면 검색만 조용히 건너뛰고 수집은 성공**한다) · `product_categories.py`(제품군 카테고리 목록을 **DB 정본**(`product_category_map`)에서 읽어 LLM enum 으로 준다. 🔴 **목록을 수집기에 박지 말 것** · `split_domains()` 로 자동차/로봇을 **반드시 가를 것** — 경위 = [history](../docs/history/Architecture-경위.md)) · `model_segment.py`·`outlook_prompt.py`(세그먼트 매핑 · 프롬프트 조립) · `china_excel.py`(MarkLines 중국 엑셀 3종 → `oem_china_*` 행. 순수 함수, `test_china_excel.py`. 🔴 **그룹 표기 정규화는 `GROUP_ALIASES` 한 곳**) · `krx_auth.py`(pykrx **import 전** `disable_pykrx_autologin()`) · `naver_market_cap.py`(시가총액 대체 출처. 🔴 **KRX 시총 계열이 죽었을 때 쓴다**(경위 = [history](../docs/history/Architecture-경위.md)). 🔴 **반환값은 이미 억원 단위**라 `EOK` 로 나누면 자릿수가 통째로 어긋난다. 파싱 자가 시험(`self_test()`)을 수집 시작 «전에» 부를 것) · `komis.py`(KOMIS 광물 가격 일별 조회 — 철광석·LME 구리 공용. 🔴 **가격기준 코드는 박지 말고 이름으로 조회**: KOMIS 가 예고 없이 바꾸며 옛 코드는 HTTP 200 빈 배열을 준다(2026-11 초 793→878)) · `market_series.py`(`existing_trade_dates()` — 백필 때 이미 적재된 날짜를 건너뛴다) · `anthropic_models.py`(최신 하이쿠 ID · TS 짝 `latestHaikuModel()`) · `bootstrap.py`(boilerplate `init_script(__file__)`) · `retry.py`(외부 요청 1회 실패로 수집 전체가 죽지 않게 — 5xx·연결 끊김만 재시도, **4xx는 즉시 raise**. `upsert_rows` 적용됨) · `pdf_figures.py`(PDF 에서 차트·도표 영역을 찾아 PNG 로 잘라낸다. 🔴 **표준 재무제표 부록·컴플라이언스 페이지는 통째로 건너뛴다**(사용자 지시 2026-08-25). 본문 이미지 판정은 **쪽당 밀도**(`is_image_body`). 순수 함수는 `test_pdf_figures.py`) · `research_priority.py`(요약할 리포트를 고른다. **평소 = `select_ongoing`(점수 문턱만)이 기본**. 🔴 **선별은 반드시 기본값이어야 한다**) · `doc_text.py`·`edgar.py`·`dart_api.py`·`ir_lists.py`·`quote_check.py`·`guidance_direction.py`·`llm_guidance.py`·`customer_summary_prompt.py`·`customer_summary_check.py`·`customer_doc_pages.py`·`customer_breakdown.py`·`llm_breakdown.py`(고객사 수집·요약 공용 — 약속 → [`docs/customers-collection.md`](../docs/customers-collection.md))

## `supabase/migrations/`

- 한 마이그레이션 = 한 변경 단위(View/function/RLS/constraint 모두). 명명·순서 규칙은 「데이터 / DB 규칙」의 **마이그레이션 컨벤션** 참조(두 곳에 적지 않는다).

## `.github/workflows/`

> 워크플로 전체 목록·카테고리·주기는 [`Architecture.md §10`](../Architecture.md) 참고. 신규/제거 시 §10 갱신.

- 대부분 GHA가 Python을 직접 호출한다(로컬 venv 불필요). 짧은 간격 cron은 curl 트리거(Hobby 제약 회피, `cron-sentiment`), 한세 종목토론은 Vercel 60s timeout 우회로 GHA runner에서 Node tsx 직접 실행(`collect-naver-board.yml`).
- 신규 onboarding `onboard-company.yml`은 `workflow_dispatch` 전용 — `/api/companies` POST가 INSERT 성공 후 GitHub API로 자동 트리거. Vercel env `GITHUB_PAT` 필요.
- **`marklines-adhoc-fetch.yml`** — **2026-11-16 꺼짐**(약관 7조 9항 자동 다운로드 금지 · 다시 켜지 말 것).
- **`collect-yt-report.yml`**(`workflow_dispatch` 전용 · **기본 활성**, 끄려면 Vercel env `YT_AUTO_REPORT=0`) — `/reports/new` 유튜브 제출 시 자동 트리거. 배선·필요 Secrets·봇차단 한계 → [`report.md §2-A`](../report.md).

## 루트 설정

- `proxy.ts`(라우트 미들웨어, 구 middleware) / `next.config.ts` / `vercel.json`(배포 — **vercel.ts로 옮기지 말 것**. `ignoreCommand`로 백업 봇 커밋의 배포를 스킵하며, 근거·부작용 → [`docs/isr-write-optimization.md`](../docs/isr-write-optimization.md)) / `.claude/agents/`(서브 에이전트 4종) / `.mcp.json`(MCP 서버)
