# 경영관리 — 조직도(Org Chart) 페이지 설계

작성일: 2026-06-24
상태: 승인됨 (구현 대기)

## 1. 목적

경영관리(`/management`)에 **조직도** 하부 페이지를 추가한다. 한세모빌리티 조직도 엑셀(셀 캔버스로 그려진 시각 자료)을 이미지로 렌더링해 게시하고, 날짜별 드롭다운으로 과거 시점까지 선택해 볼 수 있게 한다. 조직도는 사외비로 취급해 admin·holdings·mobility 3개 역할만 열람한다.

## 2. 요구사항 (사용자 확정)

- 페이지 이름: **조직도**
- 소스: 조직도 엑셀 파일. 시트는 `변경 전 조직도(Kor.)_YYYYMMDD`, `변경 후 조직도(Kor.)_YYYYMMDD` 형태.
- **한국어(Kor.) 시트만** 수집 (영문 Eng. 시트 제외), 시트명의 날짜별로 수집.
- 조직도를 **그림 파일로 렌더링**해 게시. **최대한 크게, 잘 보이게.**
- **날짜별 드롭다운**으로 시점 선택. 기본값 = 최신 날짜.
- 열람 가능 역할: hansaeadmin(=`admin`), hansaeyes24(=`holdings`), hansaemobility(=`mobility`). hmobility·guest 차단.

### 확정된 의사결정

- **렌더 방식**: 로컬 스크립트 실행 (Excel COM, Windows 전용). Vercel·GHA 서버엔 Excel/LibreOffice가 없어 서버 자동 렌더 불가.
- **소스 경로**: 프로젝트 `참고/조직도/` 폴더 glob. `ORG_CHART_EXCEL_PATH` env로 override 가능.
- **이력 정책**: 이력 누적. 드롭다운에 전체 날짜 노출, 기본 선택은 최신.

## 3. 데이터 흐름

```
참고/조직도/변경 전후 조직도_*.xlsx  (최신 glob, ORG_CHART_EXCEL_PATH env 우선)
   │  scripts/sync_org_chart.py  ← 로컬 실행 (Excel COM, Windows 전용)
   │   • "(Kor.)" 포함 시트만 필터 → 시트명에서 날짜 파싱 (_YYYYMMDD)
   │   • 각 시트 used range → PDF(ExportAsFixedFormat, fit-to-1-page-wide)
   │     → pymupdf 고DPI PNG (가로 ~2500px급)
   ▼
비공개 버킷 org-charts  (PNG)  +  사외비 테이블 org_charts (메타: chart_date·title·image_path)
   │  upsert by chart_date (이력 누적 · 멱등) + revalidateTag
   ▼
/management/org-chart  (page: 'use cache' + cacheTag + confidentialDb select)
   • 날짜 드롭다운(전체 누적, 기본=최신) → <img src=/api/management/org-chart/image/[date]>
   • 인증 프록시 라우트가 비공개 버킷 바이트 스트리밍 (역할 재검증)
```

## 4. 권한 (보안)

- **페이지** `/management/org-chart`: 기존 `permissions.ts`의 `/management` 분기로 자동 게이트.
  - admin → 허용, holdings → 허용, mobility → 허용, hmobility → 차단(HMOBILITY_MANAGEMENT_PATHS 미포함), guest → 차단. **수정 불필요.**
- **이미지 API** `/api/management/org-chart/image/[date]`:
  - `proxy.ts`는 모든 비공개 경로에 `canAccess`를 적용하지만, `canAccess`의 `/management` 분기는 접두사 `/api/`로 시작하는 경로를 매칭하지 못한다 → 현재 로직대로면 로그인만 하면 누구나(hmobility·guest 포함) 이미지 바이트 접근 가능 = **보안 갭**.
  - 대응: `permissions.ts`의 `canAccess`에 분기 1개 추가 — `/api/management/org-chart` 매칭 시 guest·hmobility 차단, 나머지(admin·holdings·mobility) 허용.
  - 방어적 2차 검증: 라우트 핸들러에서도 세션 role로 `canAccess` 재확인 후 403.

## 5. DB / 저장

### 마이그레이션 (신규 파일, 최신 번호 다음)

- `org_charts` 테이블 생성:
  - `chart_date date PRIMARY KEY` — 조직도 스냅샷 날짜 (시트명에서 파싱)
  - `title text` — 예: "한세모빌리티 조직도"
  - `image_path text NOT NULL` — Storage 객체 키
  - `source_file text` — 출처 파일명
  - `width int`, `height int` — 표시 사이징용 (nullable)
  - `created_at timestamptz default now()`, `updated_at timestamptz default now()`
  - `ALTER TABLE org_charts ENABLE ROW LEVEL SECURITY;` (정책 없음 = default deny)
- 비공개 Storage 버킷 `org-charts` 생성: `insert into storage.buckets (id, name, public) values ('org-charts','org-charts', false)` (멱등 처리). anon 접근은 정책 없음으로 차단.

### 사외비 5-step

1. 마이그레이션 RLS enable (정책 X) — 위
2. `lib/database.types.ts`에 `org_charts` 블록 수동 삽입(알파벳 위치) — generate 대신 수동(헬퍼·prettier churn 방지)
3. `lib/supabase/confidential.ts` `CONFIDENTIAL_TABLES`에 `org_charts` 한 줄
4. (업로드 API 대신) 로컬 sync 스크립트가 `confidentialDb` 동등 경로(service_role)로 upsert + revalidate
5. 페이지 `'use cache' + cacheTag + confidentialDb...select`

## 6. 렌더 스크립트 `scripts/sync_org_chart.py` (로컬 전용, sync_ prefix 유지)

- **경로 해석**: `ORG_CHART_EXCEL_PATH` env 우선, 없으면 `참고/조직도/변경 전후 조직도*.xlsx` 최신 mtime. (`management_excel.py`의 `resolve_excel_path` 패턴 참고)
- **Kor 시트 필터**: 시트명에 `(Kor.)` 포함만. 시트명 정규식 `변경 (전|후) 조직도\(Kor\.\)_(\d{8})`에서 날짜 추출.
- **렌더**: Excel COM(`win32com.client`)으로 워크북 open → 시트 used range를 print area로 설정 → `PageSetup.Zoom=False`, `FitToPagesWide=1`, `FitToPagesTall=False` → `ExportAsFixedFormat(0, pdf)` → `pymupdf(fitz)`로 PDF 페이지를 고DPI(zoom으로 가로 ~2500px) PNG 렌더. 여백 트림(선택).
- **업로드**: 비공개 버킷 `org-charts`에 Storage REST API(`POST {SUPABASE_URL}/storage/v1/object/org-charts/{key}`, service_role bearer, upsert)로 PNG 업로드. 키: `{YYYY-MM-DD}.png`.
- **메타 적재**: `org_charts` upsert by `chart_date` (이력 누적 + 멱등). `WriteSession` 사용(신규 mutating 스크립트 강제).
- **revalidate**: `lib/revalidate.py` `COLUMN_TO_TAGS`에 `org_charts` → org-chart 태그 매핑 추가. `--revalidate-prod` 플래그 지원(로컬 실행 시 프로덕션 캐시 무효화).
- **stdout 사외비 정책**: 임원명·인원수 등 셀 값 **비노출**. 시트명·날짜·처리 행수·이미지 픽셀 크기만 로그.
- **종료 후**: `sync_` prefix이므로 `_archive` 이동 대상 아님 (정기 재실행). AGENTS.md scripts 목록에 유지 명시.

## 7. UI

- **탭 추가**: `app/management/layout.tsx` 탭 네비에 **조직도** 항목 추가 (위치: 적절한 끝단).
- **페이지** `app/management/org-chart/page.tsx` (서버 컴포넌트):
  - `'use cache'` + `cacheTag('org-chart')` + `confidentialDb.from('org_charts').select('chart_date,title,image_path,width,height').order('chart_date', {ascending:false})`
  - 결과를 클라이언트 컴포넌트에 전달.
- **클라이언트 컴포넌트** `components/management/org-chart/OrgChartViewer.tsx`:
  - 날짜 `<select>` 드롭다운 (전체 날짜, 기본=최신=배열 첫 항목).
  - 선택 날짜의 이미지를 `<img src="/api/management/org-chart/image/{date}" />`로 표시. 컨테이너 폭 100%, `max-w-full h-auto`, 클릭/확대 가능(선택). 반응형.
  - 데이터 없을 때 빈 상태 안내.
- **이미지 API** `app/api/management/org-chart/image/[date]/route.ts`:
  - 세션 + role 재검증(403 게이트) → `confidentialDb`/admin client로 `org_charts`에서 `image_path` 조회 → 비공개 버킷 download → PNG 바이트 응답(`Content-Type: image/png`, 적절한 cache-control).

## 8. 문서 갱신 (AGENTS.md 트리거)

- `app/management/org-chart/page.tsx` 신규 → 라우트 책임 표에 행 추가 + `/management` 탭 목록에 org-chart 추가.
- `app/api/management/org-chart/.../route.ts` 신규 → 보호 라우트 목록 + `proxy.ts` 정합성.
- 새 사외비 테이블 `org_charts` → 데이터·DB 규칙(사외비 격리) + confidential.ts 목록.
- `scripts/sync_org_chart.py` 신규 + 유지 대상 → scripts prefix/유지 목록.
- 새 Storage 버킷 `org-charts` → Architecture.md(해당 섹션).
- `Architecture.md §5-A` 경영관리 탭 구조에 조직도 추가.

## 9. 검증

- `npm run check-all` (lint/format/typecheck/test) 통과.
- `py_compile scripts/sync_org_chart.py` + 스크립트 실제 1회 로컬 실행 → 이미지 생성·버킷 업로드·메타 적재 확인 (stdout 사외비 비노출 확인).
- 로컬 dev: admin·mobility 로그인 → 조직도 탭 이미지 표시·드롭다운 날짜 전환 확인. hmobility·guest 로그인 시 탭/이미지 API 차단 확인.
- **사외비 검증 정책**: 이미지 픽셀·셀 값 일절 미판독. 드롭다운 날짜 라벨·요소 개수·권한 차단(redirect/403) 여부 같은 메타데이터만 확인.

## 10. 범위 외 (YAGNI)

- 영문(Eng.) 시트 게시 — 제외.
- 조직도 편집 UI — 제외 (엑셀이 SSOT).
- 챗봇 연동 — 명시적 제외 (사외비, 화이트리스트 미등록).
- 서버 자동 렌더/업로드 UI — 제외 (서버에 Excel/LibreOffice 부재).
