-- Security advisor cleanup
-- 1) 3 views: SECURITY DEFINER -> SECURITY INVOKER
-- 2) 3 tables: enable RLS + anon read / service write
-- 3) 12 functions: lock search_path = public, pg_temp

-- ============================================================
-- 1. SECURITY INVOKER 뷰 전환
-- ============================================================
-- base 테이블(companies, company_pages, exchange_rates_live, financials)에
-- 이미 anon SELECT 정책이 있으므로 호출자(anon) 권한으로 읽어도 동작한다.
ALTER VIEW public.related_stocks_view     SET (security_invoker = true);
ALTER VIEW public.parts_top100_stocks_view SET (security_invoker = true);
ALTER VIEW public.domestic_stocks_view    SET (security_invoker = true);

-- ============================================================
-- 2. 3개 테이블 RLS enable + 공개 정책
-- ============================================================
-- 패턴: anon SELECT + service_role ALL (다른 공개 테이블과 동일)

-- oem_sales_model_country_month (OEM 페이지 월별 판매 데이터, 공개)
ALTER TABLE public.oem_sales_model_country_month ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_oem_sales_model_country_month ON public.oem_sales_model_country_month;
CREATE POLICY anon_read_oem_sales_model_country_month
  ON public.oem_sales_model_country_month
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS service_write_oem_sales_model_country_month ON public.oem_sales_model_country_month;
CREATE POLICY service_write_oem_sales_model_country_month
  ON public.oem_sales_model_country_month
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- oem_model_outlook (OEM 모델별 전망, 공개)
ALTER TABLE public.oem_model_outlook ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_oem_model_outlook ON public.oem_model_outlook;
CREATE POLICY anon_read_oem_model_outlook
  ON public.oem_model_outlook
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS service_write_oem_model_outlook ON public.oem_model_outlook;
CREATE POLICY service_write_oem_model_outlook
  ON public.oem_model_outlook
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- product_category_map (제품군 카테고리 매핑, 공개)
ALTER TABLE public.product_category_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_product_category_map ON public.product_category_map;
CREATE POLICY anon_read_product_category_map
  ON public.product_category_map
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS service_write_product_category_map ON public.product_category_map;
CREATE POLICY service_write_product_category_map
  ON public.product_category_map
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 3. 12개 함수 search_path 고정
-- ============================================================
-- search_path를 'public, pg_temp'로 고정해 동일 이름의 가짜 객체 주입 차단.
-- 함수 본문은 변경하지 않는다 (대부분 public 스키마 객체만 참조).
ALTER FUNCTION public.normalize_customer_name(text)         SET search_path = public, pg_temp;
ALTER FUNCTION public.posts_set_updated_at()                SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_product_category(text)      SET search_path = public, pg_temp;
ALTER FUNCTION public.merge_company(uuid, uuid)             SET search_path = public, pg_temp;
ALTER FUNCTION public.kis_tokens_set_updated_at()           SET search_path = public, pg_temp;
ALTER FUNCTION public.clean_company_legal_form(text)        SET search_path = public, pg_temp;
ALTER FUNCTION public.companies_clean_legal_form_trg()      SET search_path = public, pg_temp;
ALTER FUNCTION public.expand_customer_name(text)            SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_normalize_customers()             SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_products_categories()       SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_auto_page_mapping()               SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_set_dart_collection_status()      SET search_path = public, pg_temp;
