# Tier 4 DB schema 리뷰

## 🚨 Critical
- [supabase/migrations/20260506000001_add_companies_meta.sql:21](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260506000001_add_companies_meta.sql:21) `companies.company_type` CHECK가 `OEM`, `부품사`만 허용합니다. 그런데 [20260509000003_seed_marklines_top100_new.sql:10](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260509000003_seed_marklines_top100_new.sql:10), [line 11](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260509000003_seed_marklines_top100_new.sql:11), [line 21](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260509000003_seed_marklines_top100_new.sql:21), [line 25](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260509000003_seed_marklines_top100_new.sql:25)에서 `반도체`를 insert합니다. 깨끗한 DB에서 migration 적용 시 이 파일이 실패합니다. CHECK에 `반도체`를 추가하거나 seed 값을 `부품사`/별도 category 컬럼으로 분리해야 합니다.

## ⚠️ High
- [supabase/migrations/20260507000005_drop_unused_tables_and_view.sql:9](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260507000005_drop_unused_tables_and_view.sql:9) `watchlist`, `shareholders`, `credit_ratings`를 DROP합니다. 요구사항의 append-only 원칙과 충돌하고, 운영 데이터가 있으면 복구 불가능합니다. “미사용”이라도 데이터 보존 테이블이면 deprecate 플래그/뷰 제거/권한 차단 후 별도 백업 migration이 더 안전합니다.
- [supabase/migrations/20260511000001_drop_oem_sales_monthly.sql:11](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260511000001_drop_oem_sales_monthly.sql:11) OEM raw long 테이블을 DROP합니다. 현재 비어 있다는 주석에 의존하지만, 이후 raw 분석이나 재적재 추적성을 잃습니다. append-only 정책이면 DROP 대신 `deprecated_at` 문서화 또는 view 미노출이 맞습니다.
- [supabase/migrations/20260428000003_create_financials.sql:5](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260428000003_create_financials.sql:5) `financials`에 `period_type='annual'`이면 `fiscal_quarter IS NULL`, `quarterly`면 `fiscal_quarter IS NOT NULL` 제약이 없습니다. [20260428000008](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260428000008_financials_nulls_not_distinct.sql:8)에서 NULL 충돌은 해결했지만, annual Q1 같은 잘못된 행은 여전히 들어갈 수 있습니다.

## ⚠️ Medium
- [supabase/migrations/20260514000001_create_posts.sql:7](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260514000001_create_posts.sql:7), [20260515000001_create_pnl_entries.sql:5](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260515000001_create_pnl_entries.sql:5), [20260519000002_create_pnl_cost_structure.sql:6](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260519000002_create_pnl_cost_structure.sql:6) 최신 테이블 3개가 `CREATE TABLE IF NOT EXISTS`가 아닙니다. 인덱스/트리거/정책도 `IF NOT EXISTS` 또는 DO guard가 없어 재적용/부분 실패 복구에 취약합니다.
- [supabase/migrations/20260515000001_create_pnl_entries.sql:9](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260515000001_create_pnl_entries.sql:9), [20260519000002_create_pnl_cost_structure.sql:9](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260519000002_create_pnl_cost_structure.sql:9) `period_month` 주석은 0 또는 1~12지만 CHECK가 없습니다. `period_kind='annual'`이면 0, `monthly`면 1~12 같은 제약이 필요합니다.
- [supabase/migrations/20260519000002_create_pnl_cost_structure.sql:14](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260519000002_create_pnl_cost_structure.sql:14) PK에 `category`가 빠져 있습니다. 같은 `account`명이 다른 category에서 재사용되면 충돌합니다. 의도적으로 account가 전역 유니크가 아니라면 PK에 `category`를 포함해야 합니다.
- [supabase/migrations/20260428000001_create_companies.sql:27](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260428000001_create_companies.sql:27) 등 다수 `service_write_*` 정책이 `WITH CHECK (true)` 없이 작성되어 있습니다. Supabase service key는 보통 RLS bypass지만, 정책 표준화를 요구한다면 OEM 쪽처럼 명시하는 편이 일관됩니다.

## 📝 Low / Nit
- [supabase/migrations/20260507000006_add_domestic_page_support.sql:10](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260507000006_add_domestic_page_support.sql:10) `companies.market DROP NOT NULL`은 비상장사 지원 목적상 이해되지만, 이후 listed/unlisted 구분 CHECK가 없습니다. `market IS NULL`은 `data_source='marklines'` 등으로 제한하는 제약을 고려하세요.
- [supabase/migrations/20260514000001_create_posts.sql:55](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260514000001_create_posts.sql:55) posts는 SELECT 정책만 있고 주석으로 service_role 쓰기 가능을 설명합니다. 보안상 큰 문제는 아니지만, 다른 테이블과 정책 네이밍/명시성이 다릅니다.

## 📦 카테고리별 요약
- companies / financials: `company_type` CHECK와 seed 값 불일치가 즉시 실패 요인입니다. `financials`는 annual/quarterly 의미 제약을 보강해야 합니다.
- stock_prices / market series: PK 기반 upsert 구조는 대체로 양호합니다.
- OEM / marklines: raw table DROP이 append-only 원칙과 충돌합니다. `security_invoker` 설정은 3개 view에 적용되어 방향은 좋습니다.
- news / sentiment: PK/FK/RLS 구조는 큰 문제는 안 보였습니다.
- pnl: 최신 PNL 테이블은 idempotency, service write 정책 명시, period CHECK가 약합니다.
- 뷰: `related_stocks_view`, `parts_top100_stocks_view`는 `company_pages` 조인으로 범위를 제한하는 구조는 명확합니다.

## 🔧 우선 수정 제안
1. `companies_company_type_check`에 `반도체`를 추가하거나 seed 값을 기존 enum으로 정리.
2. DROP migration은 운영 데이터 보존 정책에 맞게 백업/폐기 절차를 명시하거나 soft-deprecate로 변경.
3. `financials`에 period semantic CHECK 추가.
4. `posts`, `pnl_entries`, `pnl_cost_structure` migration을 idempotent하게 보강.
5. PNL `period_month`/`period_kind` CHECK와 `pnl_cost_structure` PK 재검토.

정적 리뷰만 수행했습니다. 현재 환경이 read-only라 migration 실제 적용 테스트나 DB diff 실행은 하지 못했습니다.