-- product_category_map 확장 — 자동차 부품 raw 카테고리 추가 (2026-07-18 전수 감사 P5-3)
--
-- 배경: 도어/미러/와이퍼/배기/밸브/펌프/EGR 등 자동차 부품 raw 카테고리가 map에 없어
--       normalize_product_category()가 '기타'로 폴백했다(domestic '기타' 다수 원인).
-- 효과: 신규 수집(collect_*)의 products[].category가 이 raw 값이면 올바른 12분류로
--       정규화된다. 기존 products는 이미 트리거가 '기타'로 정규화해 raw가 소실됐으므로
--       (2026-07-17 복구가 제품명 기반 재분류 완료) 본 확장은 미래 수집분에 적용된다.
INSERT INTO product_category_map (raw_category, normalized) VALUES
  ('도어',       '차체'),
  ('도어모듈',   '차체'),
  ('미러',       '차체'),
  ('사이드미러', '차체'),
  ('와이퍼',     '안전'),
  ('배기',       '엔진'),
  ('배기계',     '엔진'),
  ('머플러',     '엔진'),
  ('밸브',       '엔진'),
  ('EGR',        '엔진'),
  ('펌프',       '엔진')
ON CONFLICT (raw_category) DO NOTHING;
