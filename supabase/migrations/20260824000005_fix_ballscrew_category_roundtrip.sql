-- 🔴 '볼스크류/리니어' 카테고리가 저장 즉시 '기타'로 뭉개지던 결함 수리.
--
-- 증상(2026-08-24 실측): 시드 SQL 을 두 번 실행하니 products 개수가 278 → 280 으로 늘었다.
--   멱등이어야 할 UPDATE 가 매번 항목을 추가하고 있었다.
--
-- 원인: 20260824000002 가 raw 키로 '볼스크류'·'LM가이드' 등만 넣고
--   **정규화 결과값인 '볼스크류/리니어' 자체는 raw 키로 넣지 않았다.**
--   나머지 10종은 raw 와 정규화값이 같은 문자열이라 우연히 왕복이 성립했지만,
--   이 한 종만 다르다. companies_normalize_products 트리거는 INSERT/UPDATE 마다
--   normalize_product_category() 를 다시 적용하므로:
--     저장 시도 '볼스크류/리니어' → 맵에 없음 → '기타'
--   가 되어 ① 휴머노이드 제품군 필터에서 11개사가 통째로 빠지고
--          ② "이미 그 카테고리가 있나" 검사가 영영 false 라 재실행마다 항목이 늘었다.
--
-- ⚠️ 앞선 검증이 이 결함을 놓친 이유: 왕복을 raw 키('볼스크류')로만 시험하고
--    실제 저장값('볼스크류/리니어')으로 시험하지 않았다. 아래 3)에 회귀 가드를 남긴다.

-- 1) 정규화 결과값 자체를 raw 키로도 등록 — 재정규화해도 값이 유지된다.
--    11종 전부를 넣어 두어 앞으로 같은 실수가 재발하지 않게 한다.
INSERT INTO product_category_map (raw_category, normalized) VALUES
  ('볼스크류/리니어', '볼스크류/리니어'),
  ('액추에이터',       '액추에이터'),
  ('감속기',           '감속기'),
  ('모터',             '모터'),
  ('힘토크센서',       '힘토크센서'),
  ('위치센서',         '위치센서'),
  ('비전카메라',       '비전카메라'),
  ('제어AI칩',         '제어AI칩'),
  ('배터리',           '배터리'),
  ('구조기구',         '구조기구'),
  ('그리퍼핸드',       '그리퍼핸드')
ON CONFLICT (raw_category) DO NOTHING;

-- 2) 이미 뭉개진 항목 복구 + 재실행으로 생긴 중복 제거.
--    로봇 회사의 '기타' 항목 중 이름이 볼스크류·리니어인 것만 되돌린다
--    (자동차 제품명을 건드리지 않도록 category='기타' 조건을 함께 건다).
UPDATE companies c
SET products = (
  SELECT jsonb_agg(DISTINCT
    CASE
      WHEN p->>'category' = '기타'
       AND (p->>'name' LIKE '%볼스크류%' OR p->>'name' LIKE '%리니어%')
      THEN jsonb_set(p, '{category}', '"볼스크류/리니어"')
      ELSE p
    END
  )
  FROM jsonb_array_elements(c.products) p
)
WHERE c.robot_roles IS NOT NULL
  AND c.products IS NOT NULL
  AND jsonb_array_length(c.products) > 0;

-- 3) 회귀 가드 — 11종 전부가 왕복에 성공하지 않으면 마이그레이션을 실패시킨다.
--    (다음에 카테고리를 늘릴 때 raw 키 등록을 빠뜨리면 여기서 걸린다)
DO $$
DECLARE
  broken text;
BEGIN
  SELECT string_agg(v, ', ') INTO broken
  FROM unnest(ARRAY['액추에이터','감속기','모터','볼스크류/리니어','힘토크센서','위치센서',
                    '비전카메라','제어AI칩','배터리','구조기구','그리퍼핸드']) AS v
  WHERE normalize_product_category(v) <> v;

  IF broken IS NOT NULL THEN
    RAISE EXCEPTION '로봇 카테고리 왕복 실패: % — product_category_map 에 raw 키를 추가할 것', broken;
  END IF;
END $$;
