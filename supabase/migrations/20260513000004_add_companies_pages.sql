-- /compare 페이지 지원: 기존 company_pages 다대다 매핑 재사용.
-- company_pages_page_check 제약에 'compare' 키 허용 + 비교 대상 4개사 시드.

-- 1) CHECK 제약 재정의 (기존 5개 키 + 'compare' = 6개)
ALTER TABLE company_pages DROP CONSTRAINT IF EXISTS company_pages_page_check;
ALTER TABLE company_pages
  ADD CONSTRAINT company_pages_page_check
  CHECK (page IN ('related-stocks','domestic','oem','parts-top100','hanse','compare'));

-- 2) 비교 대상 4개사 시드 (한세모빌리티 + 비교 후보 3개)
INSERT INTO company_pages (company_id, page)
SELECT id, 'compare'
FROM companies
WHERE name_kr IN ('한세모빌리티', '서한이노빌리티', '한국무브넥스', '남양넥스모')
ON CONFLICT (company_id, page) DO NOTHING;
