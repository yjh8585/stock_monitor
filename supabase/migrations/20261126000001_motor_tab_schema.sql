-- 휴머노이드 「모터」 탭(/humanoid/motor) 스키마
--
-- 설계 = docs/superpowers/specs/2026-11-26-motor-tab-design.md (5-1)
-- 계획 = docs/superpowers/plans/2026-11-26-motor-tab.md (Task 3)
--
-- 1) companies.motor_types  — 모터 유형 4값(겸업이면 여러 개). 라벨 정본은 lib/types.ts MOTOR_TYPE_LABELS.
-- 2) companies.supply_history — 공급 이력(자동차·로봇·산업 고객). 등급 「확인」·「추정」을 둘 다 저장하고
--    화면용 뷰는 「확인」만 내보낸다. 기존 customers(완성차 화이트리스트 정규화)와는 별개 칸이다.
-- 3) company_pages.page 에 'motor' 허용.
-- 4) trg_auto_page_mapping — motor_types 가 있는 새 회사는 'motor', 자동차 납품사면 'domestic' 도.
--    🔴 motor_types 가 없는 회사는 지금 규칙(data_source 분기)을 그대로 따른다(일반 부품사 회귀 방지).
--    본문은 2026-11-26 운영 정의(pg_get_functiondef)를 기준으로 고쳤다. uzauto-pdf 갈래는 운영에
--    이미 없으며 되살리지 않는다(범위 밖 · Architecture.md 부록 B-1 정정).
-- 5) motor_stocks_view — humanoid_stocks_view 골격 + group_name·customers 는 companies 값 그대로.

-- ── 1·2) 컬럼 ────────────────────────────────────────────────────────────
ALTER TABLE companies
  ADD COLUMN motor_types text[],
  ADD COLUMN supply_history jsonb;

ALTER TABLE companies
  ADD CONSTRAINT companies_motor_types_check
    CHECK (motor_types IS NULL
           OR motor_types <@ ARRAY['auto_motor','robot_motor','actuator','control']::text[]),
  ADD CONSTRAINT companies_supply_history_array_check
    CHECK (supply_history IS NULL OR jsonb_typeof(supply_history) = 'array');

COMMENT ON COLUMN companies.motor_types IS
  '모터 유형(auto_motor·robot_motor·actuator·control). /humanoid/motor 유형 버튼. 라벨 = lib/types.ts MOTOR_TYPE_LABELS';
COMMENT ON COLUMN companies.supply_history IS
  '공급 이력 [{customer, product?, field: auto|robot|industrial, grade: 확인|추정, source_url, as_of?}]. 납품·양산 수주·공급 계약만. append-only. 화면(motor_stocks_view)은 「확인」만';

-- ── 3) page CHECK ───────────────────────────────────────────────────────
ALTER TABLE company_pages DROP CONSTRAINT company_pages_page_check;
ALTER TABLE company_pages ADD CONSTRAINT company_pages_page_check
  CHECK (page = ANY (ARRAY['related-stocks','domestic','oem','parts-top100','hanse','compare','humanoid','motor']::text[]));

-- ── 4) 자동 페이지 매핑 트리거 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_auto_page_mapping()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  pages text[];
  has_motor boolean := NEW.motor_types IS NOT NULL AND array_length(NEW.motor_types, 1) > 0;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  IF NEW.robot_roles IS NOT NULL AND array_length(NEW.robot_roles, 1) > 0 THEN
    pages := ARRAY['humanoid'];
  ELSIF has_motor THEN
    -- 모터 회사는 data_source 로 domestic 을 받지 않는다 — 자동차 납품사일 때만 아래에서 붙인다
    pages := ARRAY[]::text[];
  ELSE
    pages := CASE NEW.data_source
      WHEN 'dart' THEN ARRAY['domestic']
      WHEN 'fnguide' THEN ARRAY['domestic']
      WHEN 'yfinance' THEN ARRAY['parts-top100']
      WHEN 'marklines' THEN ARRAY['parts-top100']
      WHEN 'pykrx+dart' THEN ARRAY['domestic']
      ELSE NULL
    END;
  END IF;

  IF has_motor THEN
    pages := COALESCE(pages, ARRAY[]::text[]) || 'motor'::text;
    IF 'auto_motor' = ANY(NEW.motor_types)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.supply_history, '[]'::jsonb)) e
         WHERE e->>'field' = 'auto' AND e->>'grade' = '확인'
       ) THEN
      pages := pages || 'domestic'::text;
    END IF;
  END IF;

  IF pages IS NULL OR array_length(pages, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO company_pages (company_id, page)
  SELECT NEW.id, unnest(pages)
  ON CONFLICT (company_id, page) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ── 5) motor_stocks_view ───────────────────────────────────────────────
CREATE VIEW motor_stocks_view AS
 WITH latest_fin_currency AS (
         SELECT DISTINCT ON (financials.company_id) financials.company_id,
            financials.currency
           FROM financials
          WHERE financials.period_type = 'annual'::text AND financials.currency IS NOT NULL
          ORDER BY financials.company_id, financials.fiscal_year DESC
        ), motor_base AS (
         SELECT c.id,
            c.ticker,
            c.name,
            c.name_kr,
            c.market,
            c.country,
            c.currency,
            c.status,
            c.company_type,
            c.group_name,
            c.products,
            c.customers,
            c.motor_types,
            -- 🔴 화면에는 「확인」 공급 이력만 — 「추정」은 덱(명단 정본 파일)에서만 다룬다
            COALESCE((
              SELECT jsonb_agg(e.elem ORDER BY e.ord)
                FROM jsonb_array_elements(COALESCE(c.supply_history, '[]'::jsonb)) WITH ORDINALITY AS e(elem, ord)
               WHERE e.elem->>'grade' = '확인'
            ), '[]'::jsonb) AS supply_history,
            c.valuation_usd,
            c.funding_total_usd,
            c.valuation_asof,
            c.last_price,
            c.last_change_pct,
            c.last_updated_at,
            c.market_cap,
            c.homepage_url,
            COALESCE(er.rate,
                CASE
                    WHEN c.currency = 'KRW'::text THEN 1
                    ELSE NULL::integer
                END::numeric) AS fx_to_krw,
            ( SELECT jsonb_object_agg(f.fiscal_year::text, jsonb_build_object('revenue', f.revenue, 'operating_income', f.operating_income, 'operating_margin', f.operating_margin, 'total_liabilities', f.total_liabilities, 'total_equity', f.total_equity, 'debt_ratio', f.debt_ratio, 'inventory', f.inventory, 'eps', f.eps, 'per', f.per, 'pbr', f.pbr, 'ev_ebitda', f.ev_ebitda)) AS jsonb_object_agg
                   FROM financials f
                  WHERE f.company_id = c.id AND f.period_type = 'annual'::text AND f.fiscal_year >= 2020 AND f.fiscal_year <= (EXTRACT(year FROM now())::integer + 1) AND (f.period_end_date IS NULL OR f.period_end_date <= now()::date)) AS financials_by_year,
            ( SELECT jsonb_build_object('fiscal_year', f.fiscal_year, 'fiscal_quarter', f.fiscal_quarter, 'revenue', f.revenue, 'operating_income', f.operating_income, 'operating_margin', f.operating_margin, 'prev_revenue', ( SELECT p.revenue
                           FROM financials p
                          WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'::text AND p.fiscal_year = (f.fiscal_year - 1) AND p.fiscal_quarter = f.fiscal_quarter
                         LIMIT 1), 'prev_operating_income', ( SELECT p.operating_income
                           FROM financials p
                          WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'::text AND p.fiscal_year = (f.fiscal_year - 1) AND p.fiscal_quarter = f.fiscal_quarter
                         LIMIT 1), 'prev_operating_margin', ( SELECT p.operating_margin
                           FROM financials p
                          WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'::text AND p.fiscal_year = (f.fiscal_year - 1) AND p.fiscal_quarter = f.fiscal_quarter
                         LIMIT 1)) AS jsonb_build_object
                   FROM financials f
                  WHERE f.company_id = c.id AND f.period_type = 'quarterly'::text AND f.revenue IS NOT NULL
                  ORDER BY f.fiscal_year DESC, f.fiscal_quarter DESC NULLS LAST
                 LIMIT 1) AS latest_quarter,
            COALESCE(er_fin.rate,
                CASE
                    WHEN COALESCE(lfc.currency, c.currency) = 'KRW'::text THEN 1
                    ELSE NULL::integer
                END::numeric) AS fx_fin_to_krw,
            ( SELECT f.revenue * COALESCE(er_fin.rate,
                        CASE
                            WHEN COALESCE(lfc.currency, c.currency) = 'KRW'::text THEN 1
                            ELSE NULL::integer
                        END::numeric)
                   FROM financials f
                  WHERE f.company_id = c.id AND f.period_type = 'annual'::text AND f.revenue IS NOT NULL AND (f.period_end_date IS NULL OR f.period_end_date <= now()::date)
                  ORDER BY f.fiscal_year DESC
                 LIMIT 1) AS latest_revenue_krw
           FROM companies c
             JOIN company_pages cp ON cp.company_id = c.id AND cp.page = 'motor'::text
             LEFT JOIN exchange_rates_live er ON er.base = c.currency AND er.quote = 'KRW'::text
             LEFT JOIN latest_fin_currency lfc ON lfc.company_id = c.id
             LEFT JOIN exchange_rates_live er_fin ON er_fin.base = COALESCE(lfc.currency, c.currency) AND er_fin.quote = 'KRW'::text
          WHERE c.status = 'active'::text
        )
 SELECT id,
    ticker,
    name,
    name_kr,
    market,
    country,
    currency,
    status,
    company_type,
    group_name,
    products,
    customers,
    motor_types,
    supply_history,
    valuation_usd,
    funding_total_usd,
    valuation_asof,
    last_price,
    last_change_pct,
    last_updated_at,
    market_cap,
    homepage_url,
    fx_to_krw,
    financials_by_year,
    latest_quarter,
    fx_fin_to_krw,
    latest_revenue_krw,
    row_number() OVER (ORDER BY latest_revenue_krw DESC NULLS LAST, name_kr) AS sales_rank
   FROM motor_base d;

ALTER VIEW motor_stocks_view SET (security_invoker = true);

COMMENT ON VIEW motor_stocks_view IS
  '/humanoid/motor 모터 회사 목록. company_pages.page=''motor''. supply_history 는 「확인」 등급만 노출(「추정」은 명단 정본 파일·덱 전용). humanoid_stocks_view 골격, group_name·customers 는 companies 값 그대로.';
