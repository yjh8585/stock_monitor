-- 자동 분류 정책:
-- 1) companies.company_type DEFAULT '부품사' — OEM으로 명시 안 한 회사는 부품사.
-- 2) products[].category 자동 정규화 트리거 — products INSERT/UPDATE 시
--    normalize_product_category(item.category) 자동 적용. category 누락 시 '기타'.

-- 1. 컬럼 DEFAULT 설정 (신규 INSERT 시 자동 적용)
ALTER TABLE companies ALTER COLUMN company_type SET DEFAULT '부품사';

-- 2. products JSONB 항목별 category 정규화 트리거
CREATE OR REPLACE FUNCTION normalize_products_categories()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.products IS NOT NULL AND jsonb_typeof(NEW.products) = 'array' THEN
    NEW.products := (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN item ? 'category'
            THEN jsonb_set(item, '{category}', to_jsonb(normalize_product_category(item->>'category')))
          ELSE jsonb_set(item, '{category}', to_jsonb('기타'::text))
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(NEW.products) AS item
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_normalize_products ON companies;
CREATE TRIGGER companies_normalize_products
  BEFORE INSERT OR UPDATE OF products ON companies
  FOR EACH ROW
  EXECUTE FUNCTION normalize_products_categories();

COMMENT ON FUNCTION normalize_products_categories() IS
  'products JSONB 항목의 category를 normalize_product_category()로 정규화. 누락 시 ''기타''.';
COMMENT ON TRIGGER companies_normalize_products ON companies IS
  '신규/UPDATE 시 products[].category 자동 정규화 — 마이그레이션 1회성 대신 상시 적용.';
