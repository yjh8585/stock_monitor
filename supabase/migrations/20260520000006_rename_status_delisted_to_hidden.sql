-- companies.status 값 개명: 'delisted' → 'hidden'
-- 배경:
--   기존 status 값은 'active' | 'delisted' | 'merged' (이번 작업으로 'merged' 추가됨).
--   그런데 'delisted'는 일반적으로 "상장폐지(비상장사)"를 의미하지만,
--   우리 DB에서는 단순 "노출 제외" 마커로 쓰임(상장/비상장은 별도로 market 컬럼이 표현).
--   이름과 의미 불일치로 혼란이 컸음 → 의미에 맞는 'hidden'으로 개명.
-- 영향:
--   뷰 3개의 WHERE status='active' 는 그대로 (active 유지).
--   merge_company() 함수의 status='merged' 도 그대로.
--   Python 스크립트의 비교 3곳은 별도 PR에서 'delisted' → 'hidden' 으로 동기화.
-- 적용 전 데이터: status='delisted' 5건 (만도/SL/디엠씨/한국델파이/HL클레무브).

UPDATE companies SET status = 'hidden' WHERE status = 'delisted';
