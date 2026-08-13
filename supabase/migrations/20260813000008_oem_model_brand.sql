-- MarkLines 모델명 → Cox Automotive 브랜드 매핑.
--
-- 배경:
--   /oem/competition 이 재고일수를 "경쟁 브랜드와 비교"해 보여주려면 경쟁차종이 어느 브랜드인지
--   알아야 한다. oem_sales_model_country_month.oem_group 은 그룹(예: GM)이라 Cox 브랜드
--   (Chevrolet·GMC)와 입도가 다르고, cox_brand_inventory 는 브랜드 단위다.
--
-- 왜 oem_competitor_set 의 배열 컬럼이 아니라 별도 표인가:
--   같은 모델이 여러 경쟁군에 등장한다(Explorer 는 grand_cherokee·atlas 양쪽, HR-V 는
--   niro·seltos 양쪽). 배열이면 같은 값을 여러 행에 중복 입력하게 되고 갈린다.
--
-- ⚠️ Cox 에 없는 브랜드(Tesla·Rivian·Lucid·Jaguar)는 행을 만들지 않는다.
--    매핑이 없는 모델은 재고일수 비교에서 조용히 빠진다(화면이 "데이터 없음" 처리).
--
-- ⚠️ Cox 재고일수는 미국 시장 · 브랜드 단위다. 차종 단위가 아니므로 같은 브랜드의 두 차종에
--    같은 값이 쓰인다 — 화면 문구에 반드시 "미국·브랜드 기준"을 남긴다(AGENTS.md 약속).

CREATE TABLE IF NOT EXISTS oem_model_brand (
  model     text PRIMARY KEY,
  cox_brand text NOT NULL
);

ALTER TABLE oem_model_brand ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oem_model_brand_read ON oem_model_brand;
CREATE POLICY oem_model_brand_read ON oem_model_brand
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS oem_model_brand_write ON oem_model_brand;
CREATE POLICY oem_model_brand_write ON oem_model_brand
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO oem_model_brand (model, cox_brand) VALUES
  -- 대상 차종
  ('Grand Cherokee (Jeep (2009-))', 'Jeep'),
  ('Ram P/U',                       'Ram'),
  ('Pacifica (Chrysler (2009-))',   'Chrysler'),
  ('VW Atlas',                      'Volkswagen'),
  ('Porsche 911',                   'Porsche'),
  ('SELTOS',                        'Kia'),
  ('NIRO',                          'Kia'),
  ('Avante (Elantra)',              'Hyundai'),
  ('Avante',                        'Hyundai'),
  -- 3열 SUV (grand_cherokee · atlas 경쟁군)
  ('Explorer',                      'Ford'),
  ('Traverse',                      'Chevrolet'),
  ('Grand Highlander',              'Toyota'),
  ('Telluride',                     'Kia'),
  ('Palisade',                      'Hyundai'),
  ('Honda Pilot',                   'Honda'),
  ('Highlander',                    'Toyota'),
  -- 준중형 세단 (avante_ex_china 경쟁군)
  ('Civic',                         'Honda'),
  ('Corolla',                       'Toyota'),
  ('Sentra',                        'Nissan'),
  ('Jetta',                         'Volkswagen'),
  ('K4',                            'Kia'),
  -- SUV-C (niro · seltos 경쟁군)
  ('HR-V',                          'Honda'),
  ('Kona',                          'Hyundai'),
  ('Corolla Cross',                 'Toyota'),
  ('Crosstrek',                     'Subaru'),
  ('Trailblazer',                   'Chevrolet'),
  -- 미니밴 (pacifica 경쟁군)
  ('Odyssey',                       'Honda'),
  ('Sienna',                        'Toyota'),
  ('Carnival (Sedona)',             'Kia'),
  -- 풀사이즈 픽업 (ram_truck 경쟁군)
  ('Ford F-Series',                 'Ford'),
  ('Silverado',                     'Chevrolet'),
  ('GMC Sierra',                    'GMC'),
  ('Tundra',                        'Toyota'),
  ('Nissan Titan',                  'Nissan'),
  -- 프리미엄 전기 (rivian_r1 경쟁군) — Tesla·Lucid·Rivian 은 Cox 미보유라 제외
  ('Hummer SUV',                    'GMC'),
  ('Hummer Pickup',                 'GMC'),
  ('EV9',                           'Kia'),
  ('IONIQ 5',                       'Hyundai'),
  -- 스포츠카 (porsche_911 경쟁군) — F-Type(Jaguar)은 Cox 미보유라 제외
  ('Corvette',                      'Chevrolet'),
  ('Boxster/Cayman',                'Porsche'),
  ('Supra',                         'Toyota'),
  ('Nissan Z',                      'Nissan')
ON CONFLICT (model) DO NOTHING;

COMMENT ON TABLE oem_model_brand IS
  'MarkLines 모델명 → Cox 브랜드. /oem/competition 재고일수 비교용. Cox 미보유 브랜드는 미등록.';
