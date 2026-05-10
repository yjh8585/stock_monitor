-- 동희정공/동희하이테크 status 정정
-- 비상장 외감법인 (data_source='dart', market=NULL)이라 'delisted' 개념이 적용되지 않음.
-- 실제로는 영업 활동 중인 동희그룹 자회사 → 'active'로 정정하여 /domestic 에 노출.

UPDATE companies
SET status = 'active'
WHERE name_kr IN ('동희정공', '동희하이테크')
  AND status = 'delisted'
  AND data_source = 'dart';
