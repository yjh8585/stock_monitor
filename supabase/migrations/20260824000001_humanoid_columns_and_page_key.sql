-- 휴머노이드 페이지(/humanoid) 기반 스키마 — 페이지 키 + 역할 태그 + 비상장 지표.
--
-- 배경: 국내외 휴머노이드 완성품·부품 기업을 정기 추적하는 페이지를 신설한다.
--       기업 리스트는 자동차 도메인(companies)과 테이블을 공유하되, 로봇 역할은 별도 태그로 표현한다.
--
-- 1) company_pages CHECK 에 'humanoid' 추가 — 페이지 매핑 키
-- 2) companies.robot_roles text[] — 'humanoid' / 'parts' 다중 태그
--    🔴 다중인 이유: 로보티즈·현대모비스처럼 완성품과 부품을 함께 다루는 겸업사는
--       휴머노이드 버튼과 부품 버튼 양쪽에 모두 등장해야 한다(사용자 결정 2026-08-24).
-- 3) 비상장 지표 3컬럼 — Figure AI·1X·유니트리처럼 재무제표가 없는 회사는
--    매출 대신 기업가치·누적조달액으로 규모를 보여 준다(사용자 결정: 기업가치만 있는 곳까지 포함).
--
-- ⚠️ companies.company_type CHECK 는 일부러 건드리지 않았다.
--    현행은 ('OEM','부품사') 둘뿐이라 순수 로봇사(Figure AI·유니트리)를 넣을 값이 없지만,
--    새 값을 추가하면 lib/types.ts 의 TS union 과 lib/companies/schemas.ts 의 Zod enum 까지
--    함께 고쳐야 하고 한 곳만 빠져도 조용히 갈린다(AGENTS.md 「enum형 한글 컬럼」 규칙).
--    대신 자동차와 무관한 로봇사는 company_type = NULL 로 둔다(CHECK 가 NULL 을 허용한다).
--    휴머노이드 화면은 company_type 을 쓰지 않고 robot_roles 로 판정하므로 잃는 것이 없다.

-- 1) 페이지 키 추가 (기존 6개 + 'humanoid' = 7개)
ALTER TABLE company_pages DROP CONSTRAINT IF EXISTS company_pages_page_check;
ALTER TABLE company_pages
  ADD CONSTRAINT company_pages_page_check
  CHECK (page IN ('related-stocks','domestic','oem','parts-top100','hanse','compare','humanoid'));

-- 2) 로봇 역할 다중 태그
ALTER TABLE companies ADD COLUMN IF NOT EXISTS robot_roles text[];

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_robot_roles_check;
ALTER TABLE companies
  ADD CONSTRAINT companies_robot_roles_check
  CHECK (robot_roles IS NULL OR robot_roles <@ ARRAY['humanoid','parts']::text[]);

-- 배열 포함 검색(robot_roles && ARRAY['humanoid'])용 GIN 인덱스
CREATE INDEX IF NOT EXISTS idx_companies_robot_roles
  ON companies USING gin (robot_roles);

-- 3) 비상장 지표 (상장사는 NULL — 재무는 financials 테이블이 정본)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS valuation_usd      numeric;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS funding_total_usd  numeric;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS valuation_asof     date;

COMMENT ON COLUMN companies.robot_roles IS
  '로봇 도메인 역할 다중 태그: humanoid(완성품 개발사) / parts(부품 공급사). 겸업사는 둘 다. NULL=로봇과 무관.';
COMMENT ON COLUMN companies.valuation_usd IS
  '비상장사 최신 기업가치(USD). 상장사는 NULL — 시가총액은 market_cap 이 정본.';
COMMENT ON COLUMN companies.funding_total_usd IS
  '비상장사 누적 조달액(USD).';
COMMENT ON COLUMN companies.valuation_asof IS
  'valuation_usd / funding_total_usd 의 기준일. 값이 언제 것인지 모르면 숫자가 거짓말을 한다.';
