-- 실제 상장폐지 확인된 5개 회사의 market 컬럼 정리
-- KIND 전체(KOSPI/KOSDAQ/KONEX) 미등록 확인 — last_price도 NULL인 ticker
-- status='delisted'는 유지(view에서 자동 제외) + market만 NULL로 변경해
-- '상장사로 잘못 마킹된 케이스'와 시각적으로 분리.

UPDATE companies
SET market = NULL
WHERE country = 'KR'
  AND status = 'delisted'
  AND ticker IN ('008340','290380','070080','091090','047060')
  AND last_price IS NULL;
