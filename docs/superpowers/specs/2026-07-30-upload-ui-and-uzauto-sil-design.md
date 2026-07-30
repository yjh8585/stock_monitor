# 자료업로드 파일선택 UI + UZ Auto 실(sil) 2실 정규화

- 작성 2026-07-30
- 대상: `/management/upload` 업로드 폼, `pnl_entries.sil`(UZ Auto)

## 사용자 지시 원문 (2026-07-30)

> - 경영관리 자료업로드 페이지에서 어디를 눌러서 파일을 업로드 해야 되는지 명확하게 인식이 안돼. "파일 선택 선택된 파일없음" 이 부분을 클릭할 수 있게 표시를 해줘.
> - UZ Auto는 앞으로 실적을 2실로 표현해줘. 엑셀이 업로드 될 때 2실인지 확인하는 로직도 추가해. 아니면 2실로 정정해서 db로 정리해.

### 추가 지시 (2026-07-30, 구현 중)

> 포맷 위반은 뭐야? 해결해
>
> 발견한 별개 버그도 해결해

- 포맷 위반 = `Architecture.md`·`docs/data-audit-2026-07-18.md`의 **마크다운 표 열 폭 정렬**이
  prettier 기준과 어긋난 상태(사전 존재). 셀 텍스트는 그대로고 패딩 공백·구분선 길이만 차이 →
  `npx prettier --write` 적용. 이후 `npm run check-all` 전체 통과.
- 별개 버그 = **`<Toaster />`(sonner) 미마운트**. `components/ui/sonner.tsx`에 정의만 있고
  루트 레이아웃에 렌더되지 않아 `toast.success/error(...)`가 4개 폼(업로드·회사등록·보고서
  작성·삭제)에서 조용히 무시됐다. `app/layout.tsx` body 끝에 `<Toaster position="top-right" />`
  마운트. 위치 근거: 우하단은 챗봇 버튼(`fixed bottom-5 right-5 z-40`), 상단 중앙은 경영관리 탭
  네비게이션과 겹쳐 클릭을 가로막음(실측 확인).

### 추가 결정 (AskUserQuestion, 2026-07-30)

- 업로드 UI: **점선 박스 + 드래그 지원** — 넓은 점선 영역 전체가 클릭 영역, 파일을 끌어다 놓기도 지원.
- 엑셀이 계속 3실일 때: **자동으로 2실로 고치고 경고 표시** (검증 실패로 막지 않음).

## 현황 (2026-07-30 실측)

- 업로드 폼(`components/management/upload/upload-form.tsx`)은 브라우저 기본 `<input type="file">`을
  그대로 노출 → "파일 선택 / 선택된 파일 없음"이 그것.
- UZ Auto는 **엑셀 원본·DB 모두 `3실`**. 엑셀 표기는 `UZ Auto` 하나뿐(변형 없음).
  - 엑셀 행수: 연간 50 / 연결_월 221 / 월 689
  - DB `pnl_entries`: 632행(2022~2026, standalone+consolidated)
- `실(sil)` 차원은 `pnl_entries`에만 존재. `pnl_plan`·`longterm_revenue_plan`·`pnl_cost_structure`·
  `pnl_fixed_variable`엔 실/거래처 차원 없음 → 정정 범위는 `pnl_entries` 단독.
- 2실 기존 거래처: POLARIS·Porsche·Vinfast·VW EU·VW NA·직수출 (UZ Auto 없음) → **PK 충돌 없음**.

## 왜 DB만 고쳐선 안 되는가

`sync_pnl_excel.py`는 `basis,year_label,period_month,sil,division,factory,product,customer`를 충돌키로
쓰는 **upsert-only(삭제 없음)** 이다. `sil`이 충돌키에 포함되므로 DB만 2실로 바꾸면 다음 엑셀 업로드가
3실 행을 **새 행으로 되살려** 2실/3실 양쪽에 UZ Auto가 존재 → 전사 합계 이중 계산.
(AGENTS.md "엑셀에서 차원 변경 시 delete 후 resync" 항목과 동일 함정.)

→ 수집기 정규화 + DB 일회성 정정을 **함께** 해야 한다.

## 설계

### 1. 업로드 폼 드롭존

- `<label>`이 sr-only `<input type="file">`을 감싼 점선 박스. 박스 전체가 클릭 영역.
- 안내: 아이콘 + "클릭해서 엑셀 파일 선택" + "또는 파일을 이 영역에 끌어다 놓기 · .xlsx만".
- 파일 선택 후엔 같은 박스에 파일명 + "다른 파일 선택" 안내로 전환.
- 드래그: `onDragOver`/`onDragLeave`/`onDrop`. 드롭 시 `.xlsx` 확장자만 수락, 아니면 toast 오류.
- 키보드: 숨긴 input이 포커스를 받으므로 `has-[input:focus-visible]`로 박스에 ring 표시.

### 2. 수집기 실(sil) 정규화 — `scripts/sync_pnl_excel.py`

- `SIL_BY_CUSTOMER = {'uz auto': '2실'}` (거래처명 소문자·공백정리 키).
- 순수 함수 `normalize_sil(customer, sil)` → 매핑에 있고 다르면 정정, 없으면 원본 유지.
- `row_to_entry`에서 적용 → `merge_by_pk` **이전**이므로, 엑셀에 2실/3실이 섞여 있어도 같은 PK로 합산 병합된다.
- `parse_sheet`에서 (거래처, 엑셀값 → 정정값) 건수를 집계해 **시트당 1줄 `logger.warning`**.
  오케스트레이터 `extract_warnings()`가 'warning' 문구로 잡아 업로드 화면 경고 목록에 노출.
  (행마다 찍으면 경고가 수백 줄이 되므로 집계 후 1줄.)

### 3. DB 일회성 정정 — 마이그레이션

`update pnl_entries set sil='2실' where customer='UZ Auto' and sil<>'2실'` (재실행 시 0행 = 멱등).
적용 후 `pnl_entries` 태그 캐시 무효화.

## 검증

- `pytest scripts/lib/test_sync_pnl_sil.py` — normalize_sil 케이스 + 정정으로 PK가 같아진 행의 합산 병합.
- 정정 후 SQL: UZ Auto가 2실 단독인지, 3실 잔존 0행인지.
- `npm run check-all`, dev 서버에서 admin 로그인 → `/management/upload` 드롭존 클릭·드래그 확인.
