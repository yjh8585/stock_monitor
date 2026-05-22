-- customers 정규화 트리거에 customers_updated_at 자동 SET 추가.
--
-- 기존 trg_normalize_customers()는 customers JSONB만 정규화하고 customers_updated_at은 안 건드렸다.
-- enrich/seed 스크립트 7개(enrich_company.py, enrich_top100_meta.py, enrich_products_customers_sonnet.py,
-- enrich_customers_websearch.py, seed_customers_extended.py 등)도 customers_updated_at을 SET 안 함.
-- 결과: customers_updated_at 컬럼이 100% NULL → enrich 여부 추적 불가.
--
-- 정책: customers 값이 의미 있게 변경(OLD와 다름)되면 customers_updated_at = now().
--   - INSERT: customers 비어있지 않으면 SET
--   - UPDATE: NEW.customers IS DISTINCT FROM OLD.customers이면 SET

CREATE OR REPLACE FUNCTION trg_normalize_customers() RETURNS trigger AS $$
DECLARE
  new_customers jsonb;
BEGIN
  IF NEW.customers IS NULL OR jsonb_typeof(NEW.customers) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT
    CASE
      WHEN COUNT(*) = 0 THEN '[]'::jsonb
      ELSE jsonb_agg(DISTINCT jsonb_build_object('name', n))
    END
  INTO new_customers
  FROM (
    SELECT DISTINCT unnest(expand_customer_name(elem->>'name')) AS n
    FROM jsonb_array_elements(NEW.customers) AS elem
  ) AS distinct_names
  WHERE n IS NOT NULL AND length(n) > 0;

  NEW.customers := COALESCE(new_customers, '[]'::jsonb);

  -- customers_updated_at 자동 SET — 값이 실제로 바뀐 경우만
  IF TG_OP = 'INSERT' THEN
    IF jsonb_array_length(NEW.customers) > 0 THEN
      NEW.customers_updated_at := now();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.customers IS DISTINCT FROM OLD.customers THEN
      NEW.customers_updated_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trg_normalize_customers() IS
  'customers JSONB를 화이트리스트로 정규화하고, 값이 변경되면 customers_updated_at도 now()로 자동 SET.';
