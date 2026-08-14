-- oem_model_brand 에 화면 표기용 브랜드(display_brand)를 추가하고, 미국 미판매 차종까지 채운다.
--
-- 배경: 화면의 차종 라벨이 'Explorer'·'Traverse'·'Brezza' 처럼 **차종명만** 나와 누구 차인지
-- 알 수 없었다(사용자 지시 2026-08-14). 브랜드 매핑은 이미 이 테이블에 있었지만 두 가지 한계가
-- 있었다: (1) 이름이 `cox_brand` 라 **미국 딜러 재고 조회 전용**이고 (2) 실측 커버리지가
-- 68종 중 42종(61%)뿐이라 인도·중국·유럽 차종이 통째로 빠져 있었다.
--
-- 그래서 두 뜻을 컬럼으로 가른다 — 하나의 테이블에 모델 1행을 유지해 정본이 갈리지 않게 한다:
--   cox_brand     : Cox 로스터에서 재고일수를 찾을 브랜드. **미국 판매 차종만** 값이 있다(nullable).
--   display_brand : 화면에 붙일 브랜드. 전 차종 필수.
--
-- 🔴 `cox_brand` 를 nullable 로 바꾸므로, 이 컬럼을 읽는 쪽은 NULL 을 걸러야 한다
--    (`scripts/collect_oem_model_outlook.py::_load_model_brands`).

ALTER TABLE oem_model_brand ALTER COLUMN cox_brand DROP NOT NULL;
ALTER TABLE oem_model_brand ADD COLUMN IF NOT EXISTS display_brand text;

-- 기존 42행의 cox_brand 는 전부 실제 브랜드명(Ford·Toyota·Kia…)이라 그대로 표기에 쓴다.
UPDATE oem_model_brand SET display_brand = cox_brand WHERE display_brand IS NULL;

-- 미국에서 팔지 않아 Cox 로스터에 없는 차종 — 표기 브랜드만 채운다.
INSERT INTO oem_model_brand (model, cox_brand, display_brand) VALUES
  ('Bluebird Sylphy/Sylphy', NULL, 'Nissan'),
  ('Brezza', NULL, 'Maruti Suzuki'),
  ('Captur', NULL, 'Renault'),
  ('Casper', NULL, 'Hyundai'),
  ('Creta (ix25)', NULL, 'Hyundai'),
  ('Cybertruck', NULL, 'Tesla'),
  ('EV3', NULL, 'Kia'),
  ('Elantra Yuedong', NULL, 'Hyundai'),
  ('Elantra/Yuedong/Langdong/Elantra 2016', NULL, 'Hyundai'),
  ('F-Type', NULL, 'Jaguar'),
  ('Ford Puma', NULL, 'Ford'),
  ('K5', NULL, 'Kia'),
  ('Lavida', NULL, 'Volkswagen'),
  ('Lucid Air', NULL, 'Lucid'),
  ('Model X', NULL, 'Tesla'),
  ('Nexon', NULL, 'Tata'),
  ('Peugeot 2008', NULL, 'Peugeot'),
  ('Qin L', NULL, 'BYD'),
  ('Qin PLUS', NULL, 'BYD'),
  ('R1S', NULL, 'Rivian'),
  ('R1T', NULL, 'Rivian'),
  ('Sagitar', NULL, 'Volkswagen'),
  ('Sonata/YF Sonata/LF Sonata', NULL, 'Hyundai'),
  ('Sonet', NULL, 'Kia'),
  ('Venue', NULL, 'Hyundai'),
  ('XUV 3XO', NULL, 'Mahindra')
ON CONFLICT (model) DO UPDATE SET display_brand = EXCLUDED.display_brand;

ALTER TABLE oem_model_brand ALTER COLUMN display_brand SET NOT NULL;

COMMENT ON COLUMN oem_model_brand.cox_brand IS
  'Cox 로스터에서 딜러 유통재고일수를 찾을 브랜드. 미국 미판매 차종은 NULL — 읽는 쪽이 걸러야 한다.';
COMMENT ON COLUMN oem_model_brand.display_brand IS
  '화면 차종 라벨에 붙일 브랜드(전 차종 필수). 차종명에 이미 브랜드가 든 표기는 화면이 중복을 없앤다.';
