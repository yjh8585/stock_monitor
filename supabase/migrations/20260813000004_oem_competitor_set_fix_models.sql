-- oem_competitor_set 시드값 중 실제 DB 표기와 다른 모델명 5건을 수정한다.
-- 원인: Task 2 검증 테스트(scripts/lib/test_competitor_set.py)가 DB 실측으로 발견.
--
-- avante_ex_china/USA   : 'Avante' 는 USA 시장에 존재하지 않음(미국 판매명은 'Avante (Elantra)' 뿐).
-- avante_ex_china/Korea : 'Avante (Elantra)' 는 Korea 시장에 존재하지 않음(한국 판매명은 'Avante' 뿐).
-- avante_china/China    : 'Elantra Yuedong' 단독 표기는 존재하지 않음(실제 표기는
--                          'Elantra/Yuedong/Langdong/Elantra 2016' 하나로 통합돼 있음).
-- niro/Europe           : 경쟁 모델 'Puma'→'Ford Puma', '2008'→'Peugeot 2008' 로 실제 표기 교정.

UPDATE oem_competitor_set
SET target_models = ARRAY['Avante (Elantra)']
WHERE model_key = 'avante_ex_china' AND market = 'USA';

UPDATE oem_competitor_set
SET target_models = ARRAY['Avante']
WHERE model_key = 'avante_ex_china' AND market = 'Korea';

UPDATE oem_competitor_set
SET target_models = ARRAY['Elantra/Yuedong/Langdong/Elantra 2016']
WHERE model_key = 'avante_china' AND market = 'China';

UPDATE oem_competitor_set
SET competitor_models = ARRAY['Kona','Ford Puma','Peugeot 2008']
WHERE model_key = 'niro' AND market = 'Europe';
