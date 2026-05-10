-- 신규 OEM 테이블 5종에 RLS enable + 표준 정책 (anon SELECT + service_role ALL)
-- + 모든 public view를 security_invoker=true로 변경 (호출자 권한으로 RLS 평가)
--
-- 배경: anon key가 client에 노출된 환경에서 OEM 5개 테이블이 RLS 없이 생성되어
-- 외부 무방비 상태였음. 기존 companies/financials 등과 동일 패턴으로 보호.
-- view 3개도 default(security_definer) 모드면 view 정의자 권한으로 RLS 우회 위험 →
-- security_invoker=true로 호출자(anon/service_role) 권한이 적용되도록 변경.

-- ============================================================
-- 1) OEM 5개 테이블 RLS enable + 표준 정책
-- ============================================================
ALTER TABLE oem_sales_monthly                ENABLE ROW LEVEL SECURITY;
ALTER TABLE oem_sales_group_month            ENABLE ROW LEVEL SECURITY;
ALTER TABLE oem_sales_group_pt_month         ENABLE ROW LEVEL SECURITY;
ALTER TABLE oem_sales_group_country_month    ENABLE ROW LEVEL SECURITY;
ALTER TABLE oem_sales_type_seg_month         ENABLE ROW LEVEL SECURITY;

-- anon read
CREATE POLICY anon_read_oem_sales_monthly             ON oem_sales_monthly             FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_oem_sales_group_month         ON oem_sales_group_month         FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_oem_sales_group_pt_month      ON oem_sales_group_pt_month      FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_oem_sales_group_country_month ON oem_sales_group_country_month FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_oem_sales_type_seg_month      ON oem_sales_type_seg_month      FOR SELECT TO anon USING (true);

-- service_role write/read 일체
CREATE POLICY service_write_oem_sales_monthly             ON oem_sales_monthly             FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_write_oem_sales_group_month         ON oem_sales_group_month         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_write_oem_sales_group_pt_month      ON oem_sales_group_pt_month      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_write_oem_sales_group_country_month ON oem_sales_group_country_month FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_write_oem_sales_type_seg_month      ON oem_sales_type_seg_month      FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 2) public view 3종을 security_invoker=true로 (호출자 권한으로 RLS 평가)
-- ============================================================
ALTER VIEW related_stocks_view    SET (security_invoker = true);
ALTER VIEW domestic_stocks_view   SET (security_invoker = true);
ALTER VIEW parts_top100_stocks_view SET (security_invoker = true);
