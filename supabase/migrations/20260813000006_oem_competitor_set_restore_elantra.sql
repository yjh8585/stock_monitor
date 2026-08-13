-- 20260813000004에서 avante_china/China의 target_models를 배열째 교체하며
-- 'Elantra Yuedong' 이 조용히 함께 삭제됐다(코드 재검토 Critical, 2026-08-13).
--
-- 'Elantra Yuedong'은 오타가 아니라 MarkLines 상 별개 항목이다 — China 시장에
-- 202001~202312 41개월 동안 'Elantra/Yuedong/Langdong/Elantra 2016'과 서로 다른
-- 판매수치로 공존했다(재검토자 실측: 2715·72·6965 등). 202501~ 최근 구간만 보는
-- 검증 쿼리(.gte('year_month', 202501)) 때문에 "China엔 없음"으로 오판했었다.
--
-- lib/oem/aggregate.ts의 OTHER_MODEL_TARGETS가 이미 두 표기를 합산하고 있어
-- (key: 'avante_china', models: ['Elantra/Yuedong/Langdong/Elantra 2016', 'Elantra Yuedong']),
-- 경쟁군 정의도 기존 차트 동작과 일치시킨다. 기존 20260813000004는 수정하지 않는다.

UPDATE oem_competitor_set
SET target_models = ARRAY['Elantra/Yuedong/Langdong/Elantra 2016','Elantra Yuedong']
WHERE model_key = 'avante_china' AND market = 'China';
