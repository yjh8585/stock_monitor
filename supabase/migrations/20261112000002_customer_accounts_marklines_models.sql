-- 고객사 물량 — MarkLines 에 단독 그룹이 없는 회사(「Small and Medium OEM」 같은 묶음 그룹 안의 회사)는
-- 그룹 전체가 아니라 그 회사 차종만 모아 그린다(2026-11-12 — 신차 생산 추정을 물량 영역에 싣기).
-- marklines_models 가 차 있으면: marklines_group 안에서 이 차종들의 월 판매(oem_sales_model_country_month)·
-- 생산(oem_production_model_country_month) 합 → 물량 차트 + 차종별 분기 표. 비면(null) 기존대로 그룹 전체 월 판매.
-- 🔴 차종명은 MarkLines 표기와 정확히 같아야 한다(한 글자만 달라도 에러 없이 0행 — docs/oem-collection.md).
-- 값은 행과 같이 로컬 service_role 로만 넣는다(공개 레포에 명단을 남기지 않는다 — 20261109000003 머리말).
alter table public.customer_accounts
  add column marklines_models text[]
    check (marklines_models is null or (cardinality(marklines_models) > 0 and marklines_group is not null));

comment on column public.customer_accounts.marklines_models is
  'MarkLines 차종명(marklines_group 안) — 있으면 물량 = 이 차종 합(그룹 전체 아님). 없으면 null.';
