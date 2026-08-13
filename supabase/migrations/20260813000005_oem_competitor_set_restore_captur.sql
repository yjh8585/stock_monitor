-- 20260813000004에서 niro/Europe competitor_models를 배열째 교체하며 유효한 'Captur'가
-- 조용히 함께 삭제됐다(코드 리뷰 Critical, 2026-08-13). 실제로 필요했던 교정은
-- 'Puma'→'Ford Puma', '2008'→'Peugeot 2008' 2건뿐이었다.
-- 리뷰어가 DB 직접 조회로 'Captur'가 유럽 14개국 중 10개국(Switzerland·Spain·Denmark·
-- Netherlands·Poland·Austria 등)에서 202501~ 데이터가 있는 유효한 경쟁 모델임을 재확인했다.
-- 기존 20260813000004 파일은 수정하지 않고 새 마이그레이션으로 복원한다.

UPDATE oem_competitor_set
SET competitor_models = ARRAY['Kona','Captur','Ford Puma','Peugeot 2008']
WHERE model_key = 'niro' AND market = 'Europe';
