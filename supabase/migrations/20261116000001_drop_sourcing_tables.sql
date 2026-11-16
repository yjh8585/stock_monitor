-- 협력사(/oem/suppliers) 1단계 폐기 — 사외비 표 5종 삭제 (사용자 지시 2026-11-16)
--
-- 경위: 20261113000001 로 만든 표에 MarkLines 서플라이어 DB 를 수집하려다 계정이 정지됐고,
-- 사용자가 협력사 작업 전체 폐기를 골랐다. 수집 적재는 0곳이었고 시드(제품·품목군·경쟁사)는
-- gitignore 된 로컬 파일에 남아 있다. 생성 마이그레이션은 기록으로 그대로 둔다.
--
-- 자식 → 부모 순서로 지운다(외래키 cascade 에 기대지 않는다).

drop table if exists public.sourcing_supplier_links;
drop table if exists public.sourcing_suppliers;
drop table if exists public.sourcing_competitors;
drop table if exists public.sourcing_part_groups;
drop table if exists public.sourcing_products;
