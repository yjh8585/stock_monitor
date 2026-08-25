-- 증권사 리포트에서 뽑아 올린 차트·도표 목록.
--
-- 왜: 요약 파이프라인이 PDF 를 `page.get_text()` 로 **글자만** 읽어 차트·표를 통째로
--     버리고 있었다(사용자 지적 2026-08-25 "이미지 중 필요한 것은 수록하고").
--     이제 `scripts/lib/pdf_figures.py` 가 그림 영역을 잘라 Storage `reports` 버킷의
--     `research/<kind>_<nid>/pNN_M.png` 로 올리고, 그 목록을 여기 적는다.
--
-- 형태: [{"name":"p03_1.png","url":"https://…/pNN_M.png","page":3,"caption":"그림 7. …"}]
--       본문(`summary`)에는 이 중 **헤드리스가 고른 것만** 마크다운 이미지로 실린다.
--       여기 목록은 「무엇을 뽑았나」의 기록이라 본문보다 넓다(추출 0장 진단에 쓴다).
--
-- 🔴 표준 재무제표 부록 페이지는 애초에 추출하지 않는다(사용자 지시 2026-08-25 —
--    "재무실적 중 중요한 것은 기업 페이지에 나오니까"). 판정은 `is_skippable_page()`.

alter table public.research_reports
  add column if not exists images jsonb not null default '[]'::jsonb;

comment on column public.research_reports.images is
  '리포트 PDF 에서 뽑아 Storage 에 올린 차트·도표 목록(name/url/page/caption). 본문에 실린 것은 이 중 일부.';

-- 그림을 아직 안 뽑은 리포트를 찾는 질의(`images = '[]'`)가 잦아 부분 인덱스를 둔다.
create index if not exists research_reports_no_images_idx
  on public.research_reports ((images = '[]'::jsonb))
  where images = '[]'::jsonb;
