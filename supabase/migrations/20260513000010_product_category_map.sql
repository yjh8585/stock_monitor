-- products category 정규화: 맵핑 테이블 + 함수 + 기존 데이터 일괄 정규화

-- 1. 맵핑 테이블
CREATE TABLE IF NOT EXISTS product_category_map (
  raw_category TEXT PRIMARY KEY,
  normalized   TEXT NOT NULL
);

-- 2. 정규화 함수 (매핑 없으면 '기타' fallback)
CREATE OR REPLACE FUNCTION normalize_product_category(raw TEXT)
RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(
    (SELECT normalized FROM product_category_map WHERE raw_category = raw),
    '기타'
  );
$$;

-- 3. 맵핑 시드
INSERT INTO product_category_map (raw_category, normalized) VALUES
  ('엔진',             '엔진'),
  ('엔진부품',         '엔진'),
  ('실린더',           '엔진'),
  ('구동계',           '구동계'),
  ('변속기',           '구동계'),
  ('베어링',           '구동계'),
  ('기어',             '구동계'),
  ('드라이브트레인',   '구동계'),
  ('제동',             '제동'),
  ('브레이크',         '제동'),
  ('조향',             '조향'),
  ('차체',             '차체'),
  ('차체부품',         '차체'),
  ('자동차부품',       '차체'),
  ('자동차 부품',      '차체'),
  ('자동차 부품류',    '차체'),
  ('자동차',           '차체'),
  ('부품',             '차체'),
  ('외장',             '차체'),
  ('외장부품',         '차체'),
  ('자동차 외장재',    '차체'),
  ('내장',             '내장'),
  ('시트',             '내장'),
  ('인테리어',         '내장'),
  ('전장',             '전장'),
  ('전장부품',         '전장'),
  ('전자',             '전장'),
  ('전자부품',         '전장'),
  ('제어',             '전장'),
  ('반도체',           '전장'),
  ('안테나',           '전장'),
  ('커넥터',           '전장'),
  ('케이블',           '전장'),
  ('신호처리',         '전장'),
  ('마이크로컨트롤러', '전장'),
  ('전력관리',         '전장'),
  ('DC/DC 컨버터',     '전장'),
  ('I2C 레벨 시프터',  '전장'),
  ('MCU',              '전장'),
  ('PMIC',             '전장'),
  ('디지털 아이솔레이터', '전장'),
  ('버퍼/드라이버',    '전장'),
  ('배터리',           '배터리'),
  ('에너지',           '배터리'),
  ('양극활물질',       '배터리'),
  ('타이어',           '타이어'),
  ('공조',             '공조'),
  ('열관리',           '공조'),
  ('안전',             '안전'),
  ('조명',             '안전'),
  ('소재',             '기타'),
  ('촉매',             '기타'),
  ('연료전지',         '기타'),
  ('유공압',           '기타'),
  ('제조',             '기타'),
  ('승용차',           '기타'),
  ('전기차',           '기타'),
  ('건축용',           '기타'),
  ('배관부품',         '기타'),
  ('클라우드',         '기타'),
  ('통신',             '기타'),
  ('전력',             '기타'),
  ('체결요소',         '기타')
ON CONFLICT (raw_category) DO NOTHING;

-- 4. 기존 products JSONB 일괄 정규화 (name 필드 유지, category만 변경)
UPDATE companies
SET products = (
  SELECT jsonb_agg(
    CASE
      WHEN item ? 'category'
      THEN jsonb_set(item, '{category}',
             to_jsonb(normalize_product_category(item->>'category')))
      ELSE jsonb_set(item, '{category}', to_jsonb('기타'::text))
    END
  )
  FROM jsonb_array_elements(products) AS item
)
WHERE products IS NOT NULL AND jsonb_array_length(products) > 0;
