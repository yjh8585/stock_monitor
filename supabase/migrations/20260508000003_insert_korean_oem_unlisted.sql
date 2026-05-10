-- 비상장 OEM 추가: 한국지엠, 르노코리아
-- 둘 다 외감대상 비상장사라 DART 공시 있음 → 재무는 별도 스크립트로 백필
-- /related-stocks 페이지 노출 (비상장 토글에 포함)

INSERT INTO companies (
  ticker, name, name_kr, market, country, currency, data_source, status,
  company_type, region, products, customers, homepage_url
) VALUES
  (
    '한국지엠', 'GM Korea', '한국지엠', NULL, 'KR', 'KRW', 'dart', 'active',
    'OEM', '한국',
    '[{"name":"쉐보레 트레일블레이저"},{"name":"쉐보레 트랙스 크로스오버"},{"name":"이쿼녹스 EV"},{"name":"콜로라도/타호(수입)"}]'::jsonb,
    '[]'::jsonb,
    'https://www.chevrolet.co.kr'
  ),
  (
    '르노코리아', 'Renault Korea Motors', '르노코리아', NULL, 'KR', 'KRW', 'dart', 'active',
    'OEM', '한국',
    '[{"name":"그랑 콜레오스"},{"name":"QM6"},{"name":"SM6"},{"name":"XM3(아르카나)"}]'::jsonb,
    '[]'::jsonb,
    'https://www.renaultkorea.com'
  )
ON CONFLICT (ticker) DO NOTHING;

-- /related-stocks 페이지 매핑
INSERT INTO company_pages (company_id, page)
SELECT id, 'related-stocks' FROM companies
WHERE ticker IN ('한국지엠', '르노코리아')
ON CONFLICT (company_id, page) DO NOTHING;
