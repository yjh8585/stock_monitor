# 경영관리 조직도 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경영관리에 조직도 하부 페이지를 추가한다 — 조직도 엑셀(Kor. 시트)을 로컬에서 PNG로 렌더해 비공개 버킷에 게시하고, 날짜 드롭다운으로 시점을 골라 크게 본다. admin·holdings·mobility만 열람.

**Architecture:** 로컬 Python 스크립트(Excel COM)가 Kor 시트를 고해상도 PNG로 렌더 → 비공개 Storage 버킷 `org-charts` 업로드 + 사외비 테이블 `org_charts`(chart_date PK, 이력 누적) 적재. 페이지는 `'use cache'` + `confidentialDb`로 메타만 읽고, 이미지는 인증 프록시 API가 비공개 버킷에서 스트리밍. 운영 경로에 AI 미관여.

**Tech Stack:** Next.js 16 (App Router, cacheComponents) · Supabase(PostgreSQL + private Storage) · Python 3 + win32com(Excel COM) + pymupdf · Vitest · TypeScript.

---

## 파일 구조

| 파일 | 역할 | 생성/수정 |
|---|---|---|
| `supabase/migrations/20260624000002_create_org_charts.sql` | org_charts 테이블(RLS deny) + 비공개 버킷 | 생성 |
| `lib/database.types.ts` | org_charts 타입 블록 수동 삽입 | 수정 |
| `lib/supabase/confidential.ts` | CONFIDENTIAL_TABLES에 org_charts | 수정 |
| `scripts/lib/revalidate.py` | COLUMN_TO_TAGS에 org_charts | 수정 |
| `lib/auth/permissions.ts` | canAccess에 `/api/management/org-chart` 분기 | 수정 |
| `lib/auth/permissions.test.ts` | 조직도 권한 테스트 | 생성 |
| `scripts/lib/org_chart_sheets.py` | Kor 시트 필터 + 날짜 파싱(순수 함수) | 생성 |
| `scripts/lib/test_org_chart_sheets.py` | 위 단위 테스트 | 생성 |
| `scripts/sync_org_chart.py` | 렌더 + 업로드 + 적재 (로컬 전용) | 생성 |
| `lib/org-chart/source.ts` | 메타 fetch + 'use cache' | 생성 |
| `app/api/management/org-chart/image/[date]/route.ts` | 인증 이미지 프록시 | 생성 |
| `app/management/org-chart/page.tsx` | 서버 페이지 | 생성 |
| `components/management/org-chart/OrgChartViewer.tsx` | 드롭다운 + 이미지(client) | 생성 |
| `components/management/management-tabs.tsx` | 조직도 탭 추가 | 수정 |
| `AGENTS.md`, `Architecture.md` | 문서 갱신 | 수정 |

---

## Task 1: DB 마이그레이션 (org_charts 테이블 + 비공개 버킷)

**Files:**
- Create: `supabase/migrations/20260624000002_create_org_charts.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- 조직도 이미지 메타데이터 (사외비) + 비공개 Storage 버킷.
-- chart_date = 조직도 스냅샷 날짜(시트명 _YYYYMMDD에서 파싱). 이력 누적 → upsert by chart_date.
-- image_path = org-charts 버킷 객체 키. RLS enable + 정책 없음(default deny):
--   서버는 confidentialDb(service_role)로만 접근. anon 직접 접근 불가.

create table if not exists public.org_charts (
  chart_date date primary key,
  title text,
  image_path text not null,
  source_file text,
  width int,
  height int,
  created_at timestamptz not null default now()
);

comment on table public.org_charts is
  '조직도 이미지 메타 (사외비). chart_date=스냅샷 날짜, image_path=org-charts 버킷 키.';

alter table public.org_charts enable row level security;
-- 정책 없음 = default deny.

-- 비공개 Storage 버킷 (public=false). 정책 없음 → anon 차단, service_role만 접근.
insert into storage.buckets (id, name, public)
values ('org-charts', 'org-charts', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: 마이그레이션 적용**

`mcp__supabase__apply_migration` 도구 사용:
- name: `create_org_charts`
- query: 위 SQL 전체

또는 Supabase 대시보드 SQL 에디터에 붙여넣기 실행.

- [ ] **Step 3: 적용 검증**

`mcp__supabase__execute_sql`로 실행:
```sql
select count(*) from public.org_charts;
select id, public from storage.buckets where id = 'org-charts';
```
Expected: org_charts 0행 조회 성공(테이블 존재), 버킷 `org-charts` `public=false` 1행.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260624000002_create_org_charts.sql
git commit -m "feat(db): org_charts 사외비 테이블 + 비공개 버킷 마이그레이션"
```

---

## Task 2: 타입·사외비·revalidate 매핑 등록

**Files:**
- Modify: `lib/database.types.ts` (Tables 객체 내 알파벳 위치, `oem_*` 블록들 뒤 / `personnel_entries` 앞 근처)
- Modify: `lib/supabase/confidential.ts`
- Modify: `scripts/lib/revalidate.py`

- [ ] **Step 1: database.types.ts에 org_charts 블록 삽입**

Tables 객체 안, 다른 `o`로 시작하는 테이블 블록(예: 마지막 `oem_*`) 다음에 삽입:

```typescript
      org_charts: {
        Row: {
          chart_date: string;
          created_at: string;
          height: number | null;
          image_path: string;
          source_file: string | null;
          title: string | null;
          width: number | null;
        };
        Insert: {
          chart_date: string;
          created_at?: string;
          height?: number | null;
          image_path: string;
          source_file?: string | null;
          title?: string | null;
          width?: number | null;
        };
        Update: {
          chart_date?: string;
          created_at?: string;
          height?: number | null;
          image_path?: string;
          source_file?: string | null;
          title?: string | null;
          width?: number | null;
        };
        Relationships: [];
      };
```

- [ ] **Step 2: confidential.ts에 등록**

주석 블록의 테이블 목록에 한 줄 추가(`management_uploads` 줄 다음):
```typescript
 * - org_charts: 조직도 이미지 메타 (migration 20260624000002)
```
`CONFIDENTIAL_TABLES` 배열에 한 줄 추가(`'management_uploads',` 다음):
```typescript
  'org_charts',
```

- [ ] **Step 3: revalidate.py COLUMN_TO_TAGS에 매핑 추가**

경영관리(PnL) 블록의 `'finance_entries': ['finance_entries'],` 등과 같은 위치에 추가:
```python
    'org_charts': ['org_charts'],
```

- [ ] **Step 4: typecheck로 사외비 union 정합성 확인**

Run: `npm run typecheck`
Expected: PASS (org_charts가 Database['public']['Tables']에 존재 → ConfidentialTable 교차 타입 통과).

- [ ] **Step 5: Commit**

```bash
git add lib/database.types.ts lib/supabase/confidential.ts scripts/lib/revalidate.py
git commit -m "feat(types): org_charts 사외비 등록 + revalidate 매핑"
```

---

## Task 3: 권한 게이트 (canAccess) — TDD

**Files:**
- Create: `lib/auth/permissions.test.ts`
- Modify: `lib/auth/permissions.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/auth/permissions.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';

import { canAccess } from './permissions';

describe('canAccess — 조직도(/management/org-chart)', () => {
  const page = '/management/org-chart';
  const api = '/api/management/org-chart/image/2026-07-01';

  it('admin·holdings·mobility는 페이지 허용', () => {
    expect(canAccess(page, 'admin')).toBe(true);
    expect(canAccess(page, 'holdings')).toBe(true);
    expect(canAccess(page, 'mobility')).toBe(true);
  });

  it('hmobility·guest는 페이지 차단', () => {
    expect(canAccess(page, 'hmobility')).toBe(false);
    expect(canAccess(page, 'guest')).toBe(false);
  });

  it('이미지 API도 페이지와 동일 게이트', () => {
    expect(canAccess(api, 'admin')).toBe(true);
    expect(canAccess(api, 'holdings')).toBe(true);
    expect(canAccess(api, 'mobility')).toBe(true);
    expect(canAccess(api, 'hmobility')).toBe(false);
    expect(canAccess(api, 'guest')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- permissions`
Expected: 페이지 케이스는 통과(기존 `/management` 분기로 이미 올바름)하나 **이미지 API 케이스 실패** — `canAccess(api, 'hmobility')`가 `true` 반환(기본 `return true`).

- [ ] **Step 3: canAccess에 분기 추가**

`lib/auth/permissions.ts`의 `canAccess` 함수에서 마지막 `return true;` 바로 앞에 추가:
```typescript
  // 조직도 이미지 API — 페이지(/management/org-chart)와 동일 게이트.
  // canAccess의 /management 분기는 '/api/...' 접두사를 매칭하지 못하므로 명시적으로 처리.
  if (matchesPath(pathname, '/api/management/org-chart')) {
    return role !== 'guest' && role !== 'hmobility';
  }
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test -- permissions`
Expected: PASS (전체 케이스).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/permissions.ts lib/auth/permissions.test.ts
git commit -m "feat(auth): 조직도 이미지 API 권한 게이트 + 테스트"
```

---

## Task 4: Kor 시트 파싱 (순수 함수) — TDD

**Files:**
- Create: `scripts/lib/org_chart_sheets.py`
- Create: `scripts/lib/test_org_chart_sheets.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/lib/test_org_chart_sheets.py`:
```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from org_chart_sheets import parse_kor_sheets


def test_filters_kor_and_parses_date():
    names = [
        '변경 전 조직도(Kor.)_20260201',
        '변경 전 조직도(Eng.)_20260201',
        '변경 후 조직도(Kor.)_20260701',
        '변경 후 조직도(Eng.)_20260701',
    ]
    assert parse_kor_sheets(names) == [
        ('변경 전 조직도(Kor.)_20260201', '2026-02-01'),
        ('변경 후 조직도(Kor.)_20260701', '2026-07-01'),
    ]


def test_returns_empty_when_no_kor_sheet():
    assert parse_kor_sheets(['Sheet1', 'data']) == []


def test_sorted_by_date_ascending():
    names = ['변경 후 조직도(Kor.)_20260701', '변경 전 조직도(Kor.)_20260201']
    assert [d for _, d in parse_kor_sheets(names)] == ['2026-02-01', '2026-07-01']
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_org_chart_sheets.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'org_chart_sheets'`.
(pytest 미설치 시: `scripts/venv/Scripts/python.exe scripts/lib/test_org_chart_sheets.py` 로 실행할 수 있도록 파일 끝에 호출을 추가해도 됨 — 단, 우선 pytest 시도.)

- [ ] **Step 3: 순수 함수 구현**

`scripts/lib/org_chart_sheets.py`:
```python
"""조직도 엑셀 시트명 파싱 (순수 함수 — win32com 의존 없음 → 단위 테스트 가능).

시트명 규칙: '변경 (전|후) 조직도(Kor.)_YYYYMMDD'.
한국어(Kor.) 시트만 골라 (시트명, 'YYYY-MM-DD') 튜플 리스트를 날짜 오름차순으로 반환.
"""
import re

KOR_DATE_RE = re.compile(r'조직도\(Kor\.\)_(\d{8})')


def parse_kor_sheets(sheet_names: list[str]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for name in sheet_names:
        m = KOR_DATE_RE.search(name)
        if not m:
            continue
        d = m.group(1)
        iso = f'{d[0:4]}-{d[4:6]}-{d[6:8]}'
        out.append((name, iso))
    out.sort(key=lambda t: t[1])
    return out
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_org_chart_sheets.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/org_chart_sheets.py scripts/lib/test_org_chart_sheets.py
git commit -m "feat(scripts): Kor 시트 날짜 파싱 순수 함수 + 테스트"
```

---

## Task 5: 렌더 스크립트 `sync_org_chart.py` (로컬 전용)

**Files:**
- Create: `scripts/sync_org_chart.py`
- 의존: `참고/조직도/` 폴더에 조직도 엑셀 배치 (또는 `ORG_CHART_EXCEL_PATH` env)

- [ ] **Step 1: pymupdf 설치 확인**

Run: `scripts/venv/Scripts/python.exe -c "import fitz; print('pymupdf', fitz.__doc__[:20])"`
Expected: import 성공. 실패 시 `scripts/venv/Scripts/python.exe -m pip install pymupdf`.

- [ ] **Step 2: 스크립트 작성**

`scripts/sync_org_chart.py`:
```python
"""조직도 엑셀 → 시점별 PNG 렌더 → 비공개 버킷 업로드 → org_charts 적재.

로컬 전용: Excel COM(win32com) 사용 → Windows + Excel 설치 필요.
Vercel·GHA엔 Excel/LibreOffice가 없어 서버 자동 렌더 불가.

소스: ORG_CHART_EXCEL_PATH env 우선, 없으면 참고/조직도/변경 전후 조직도*.xlsx 최신.
사외비: stdout에 임원명·인원수 등 셀 값 비노출 — 시트명·날짜·행수·이미지 크기만 로그.

사용:
  python scripts/sync_org_chart.py --dry-run          # 렌더만, 업로드/적재 없음
  python scripts/sync_org_chart.py                    # 렌더 + 업로드 + 적재 + revalidate(dev)
  python scripts/sync_org_chart.py --revalidate-prod  # + 프로덕션 캐시 무효화
"""
import argparse
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

import requests  # noqa: E402
from loguru import logger  # noqa: E402

from lib.db import upsert_rows  # noqa: E402
from lib.org_chart_sheets import parse_kor_sheets  # noqa: E402
from lib.revalidate import revalidate_tags_prod  # noqa: E402

BUCKET = 'org-charts'
GLOB = '변경 전후 조직도*.xlsx'
RENDER_ZOOM = 3.0  # PDF→PNG 확대 배율(고해상도 — "최대한 크게")
TITLE = '한세모빌리티 조직도'


def resolve_excel() -> Path:
    env = os.environ.get('ORG_CHART_EXCEL_PATH', '').strip()
    if env:
        p = Path(env)
        if not p.exists():
            raise FileNotFoundError(f'ORG_CHART_EXCEL_PATH 없음: {p}')
        return p
    base = Path(__file__).resolve().parent.parent / '참고' / '조직도'
    cands = sorted(base.glob(GLOB), key=lambda p: p.stat().st_mtime)
    if not cands:
        raise FileNotFoundError(f'조직도 엑셀 없음: {base}/{GLOB}')
    return cands[-1]


def render_sheet_to_png(xlsx: Path, sheet_name: str, out_png: Path) -> tuple[int, int]:
    """Excel COM으로 시트를 PDF로 내보낸 뒤 PNG로 렌더. (width, height) 반환."""
    import win32com.client as win32  # 로컬 전용 import
    import fitz  # pymupdf

    excel = win32.DispatchEx('Excel.Application')
    excel.Visible = False
    excel.DisplayAlerts = False
    pdf_path = out_png.with_suffix('.pdf')
    try:
        wb = excel.Workbooks.Open(str(xlsx), ReadOnly=True)
        try:
            ws = wb.Worksheets(sheet_name)
            ws.PageSetup.Zoom = False
            ws.PageSetup.FitToPagesWide = 1
            ws.PageSetup.FitToPagesTall = 1
            ws.PageSetup.Orientation = 2  # xlLandscape
            ws.PageSetup.PrintArea = ws.UsedRange.Address
            wb.ExportAsFixedFormat(0, str(pdf_path))  # 0 = xlTypePDF
        finally:
            wb.Close(SaveChanges=False)
    finally:
        excel.Quit()

    doc = fitz.open(str(pdf_path))
    try:
        page = doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(RENDER_ZOOM, RENDER_ZOOM))
        pix.save(str(out_png))
        w, h = pix.width, pix.height
    finally:
        doc.close()
        pdf_path.unlink(missing_ok=True)
    return w, h


def upload_png(key: str, png: Path) -> None:
    url = os.environ['SUPABASE_URL'].rstrip('/') + f'/storage/v1/object/{BUCKET}/{key}'
    service_key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    resp = requests.post(
        url,
        data=png.read_bytes(),
        headers={
            'Authorization': f'Bearer {service_key}',
            'Content-Type': 'image/png',
            'x-upsert': 'true',
        },
        timeout=60,
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(f'Storage 업로드 실패 {resp.status_code}: {resp.text[:200]}')


def main() -> int:
    ap = argparse.ArgumentParser(description='조직도 엑셀 → PNG 렌더 → org_charts 적재')
    ap.add_argument('--dry-run', action='store_true', help='렌더만, 업로드/적재 없음')
    ap.add_argument('--revalidate-prod', action='store_true', help='적재 후 프로덕션 캐시 무효화')
    args = ap.parse_args()

    xlsx = resolve_excel()
    logger.info(f'소스 파일: {xlsx.name}')

    import openpyxl

    wb = openpyxl.load_workbook(xlsx, read_only=True)
    kor = parse_kor_sheets(wb.sheetnames)
    wb.close()
    logger.info(f'Kor 시트 {len(kor)}개: {[d for _, d in kor]}')
    if not kor:
        logger.error('Kor 시트 없음 — 종료')
        return 1

    rows: list[dict] = []
    with tempfile.TemporaryDirectory() as tmp:
        for sheet_name, iso in kor:
            out = Path(tmp) / f'{iso}.png'
            w, h = render_sheet_to_png(xlsx, sheet_name, out)
            logger.info(f'  렌더 {iso}: {w}x{h}px')
            if args.dry_run:
                continue
            key = f'{iso}.png'
            upload_png(key, out)
            rows.append(
                {
                    'chart_date': iso,
                    'title': TITLE,
                    'image_path': key,
                    'source_file': xlsx.name,
                    'width': w,
                    'height': h,
                }
            )

    if args.dry_run:
        logger.info('dry-run 완료 (업로드/적재 생략)')
        return 0

    n = upsert_rows('org_charts', rows, 'chart_date')  # 자동 revalidate(dev)
    logger.info(f'org_charts upsert {n}행')
    if args.revalidate_prod:
        revalidate_tags_prod(['org_charts'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 3: py_compile 검증**

Run: `scripts/venv/Scripts/python.exe -m py_compile scripts/sync_org_chart.py scripts/lib/org_chart_sheets.py`
Expected: 무출력(성공).

- [ ] **Step 4: dry-run 실행 (렌더만)**

`참고/조직도/` 폴더에 조직도 엑셀을 두거나 env 지정 후:
```bash
ORG_CHART_EXCEL_PATH="/c/Users/junghwan.yoon/Downloads/5. 변경 전후 조직도_20260701.xlsx" \
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/sync_org_chart.py --dry-run
```
Expected: `Kor 시트 2개: ['2026-02-01', '2026-07-01']` + 각 시점 `렌더 ...x...px` 로그. **임원명·인원수 미출력.** exit 0.

- [ ] **Step 5: 본 실행 (업로드 + 적재)**

```bash
ORG_CHART_EXCEL_PATH="/c/Users/junghwan.yoon/Downloads/5. 변경 전후 조직도_20260701.xlsx" \
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/sync_org_chart.py
```
Expected: `org_charts upsert 2행`. exit 0.

검증(`mcp__supabase__execute_sql`):
```sql
select chart_date, title, image_path, width, height from public.org_charts order by chart_date;
```
Expected: 2행(2026-02-01, 2026-07-01), image_path = `2026-02-01.png` / `2026-07-01.png`, width/height > 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync_org_chart.py
git commit -m "feat(scripts): 조직도 엑셀 → PNG 렌더 + 비공개 버킷 적재 (로컬 전용)"
```

---

## Task 6: 메타 소스 `lib/org-chart/source.ts`

**Files:**
- Create: `lib/org-chart/source.ts`

- [ ] **Step 1: source 작성**

`lib/org-chart/source.ts`:
```typescript
/**
 * 조직도(/management/org-chart) 메타 입구 — fetch + 'use cache'.
 *
 * org_charts: 사외비 → confidentialDb(service_role).
 * image_path는 여기서 select하지 않는다(서버 전용) — 이미지는 날짜별 인증 API가 스트리밍.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';

import logger from '@/lib/logger';
import { confidentialDb } from '@/lib/supabase/confidential';

export interface OrgChartMeta {
  chart_date: string;
  title: string | null;
  width: number | null;
  height: number | null;
}

export async function getOrgCharts(): Promise<OrgChartMeta[]> {
  'use cache';
  cacheLife('days');
  cacheTag('org_charts');

  const { data, error } = await confidentialDb
    .from('org_charts')
    .select('chart_date, title, width, height')
    .order('chart_date', { ascending: false });
  if (error) {
    logger.error({ err: error }, 'org_charts 조회 실패');
    throw new Error(`Supabase org_charts 조회 실패: ${error.message}`);
  }
  return data ?? [];
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/org-chart/source.ts
git commit -m "feat(org-chart): 메타 source (use cache + confidentialDb)"
```

---

## Task 7: 이미지 프록시 API

**Files:**
- Create: `app/api/management/org-chart/image/[date]/route.ts`

- [ ] **Step 1: 라우트 작성**

`app/api/management/org-chart/image/[date]/route.ts`:
```typescript
import { NextResponse } from 'next/server';

import { canAccess } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { confidentialDb } from '@/lib/supabase/confidential';

interface RouteContext {
  params: Promise<{ date: string }>;
}

const BUCKET = 'org-charts';

/**
 * 조직도 이미지 스트리밍. 비공개 버킷이라 service_role(admin client)로 download.
 * proxy.ts가 1차 게이트(canAccess)지만, 라우트에서도 role 재검증(defense-in-depth).
 */
export async function GET(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user || !canAccess('/management/org-chart', user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const { data: meta, error } = await confidentialDb
    .from('org_charts')
    .select('image_path')
    .eq('chart_date', date)
    .maybeSingle();
  if (error || !meta) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(meta.image_path);
  if (dlErr || !blob) {
    return new NextResponse('Not Found', { status: 404 });
  }

  return new NextResponse(blob, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/api/management/org-chart/image/[date]/route.ts"
git commit -m "feat(api): 조직도 이미지 인증 프록시 (비공개 버킷 스트리밍)"
```

---

## Task 8: UI — 뷰어 컴포넌트 + 페이지 + 탭

**Files:**
- Create: `components/management/org-chart/OrgChartViewer.tsx`
- Create: `app/management/org-chart/page.tsx`
- Modify: `components/management/management-tabs.tsx`

- [ ] **Step 1: 뷰어 클라이언트 컴포넌트 작성**

`components/management/org-chart/OrgChartViewer.tsx`:
```tsx
'use client';

import { useState } from 'react';

import type { OrgChartMeta } from '@/lib/org-chart/source';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

export default function OrgChartViewer({ charts }: { charts: OrgChartMeta[] }) {
  const [selected, setSelected] = useState(charts[0]?.chart_date ?? '');

  if (charts.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        게시된 조직도가 없습니다. 로컬에서 <code>scripts/sync_org_chart.py</code>를 실행해 적재하세요.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex shrink-0 items-center gap-2">
        <label htmlFor="org-date" className="text-sm font-medium">
          시점
        </label>
        <select
          id="org-date"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          {charts.map((c) => (
            <option key={c.chart_date} value={c.chart_date}>
              {formatDate(c.chart_date)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-auto rounded-md border border-border bg-white">
        {selected && (
          // 인증 프록시 엔드포인트(동적·비공개)라 next/image 대신 img 사용
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/management/org-chart/image/${selected}`}
            alt={`조직도 ${formatDate(selected)}`}
            className="h-auto w-full min-w-[1000px]"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 서버 페이지 작성**

`app/management/org-chart/page.tsx`:
```tsx
import OrgChartViewer from '@/components/management/org-chart/OrgChartViewer';
import { getOrgCharts } from '@/lib/org-chart/source';

/** 조직도 페이지 (server) — org_charts 메타 fetch 후 클라이언트에 전달. */
export default async function OrgChartPage() {
  const charts = await getOrgCharts();
  return <OrgChartViewer charts={charts} />;
}
```

- [ ] **Step 3: 탭 네비에 조직도 추가**

`components/management/management-tabs.tsx`의 `ALL_TABS` 배열에서 `{ label: '재무', href: '/management/finance' },` 다음 줄에 추가:
```typescript
  { label: '조직도', href: '/management/org-chart' },
```

- [ ] **Step 4: check-all 통과**

Run: `npm run check-all`
Expected: lint + format:check + typecheck + test 전부 PASS.
(format 오류 시 `npm run format`, lint 자동수정 `npm run lint:fix` 후 재실행.)

- [ ] **Step 5: dev 서버에서 UI 검증 (사외비 메타데이터만 확인)**

`npm run dev` 후 Playwright/수동:
- admin·mobility 계정 로그인 → `/management/org-chart` 진입 → 드롭다운에 2개 날짜(2026년 02월 01일 / 07월 01일), 기본=최신(07월 01일), 이미지 표시 확인.
- 드롭다운 전환 시 `<img src>`가 `/api/management/org-chart/image/2026-02-01`로 바뀌고 이미지 로드(네트워크 200) 확인.
- hmobility·guest 로그인 → 조직도 탭 미노출 + `/management/org-chart` 직접 접근 시 `/`로 redirect 확인.
- **검증 시 이미지 픽셀·셀 값 미판독** — 드롭다운 라벨·요소 개수·redirect/HTTP 상태만 확인(사외비 정책).
- Turbopack 첫 진입 404/stale 시 dev 재시작 또는 `rm -rf .next`.

- [ ] **Step 6: Commit**

```bash
git add components/management/org-chart/OrgChartViewer.tsx app/management/org-chart/page.tsx components/management/management-tabs.tsx
git commit -m "feat(ui): 조직도 페이지 + 날짜 드롭다운 + 탭"
```

---

## Task 9: 문서 갱신 + 최종 검증

**Files:**
- Modify: `AGENTS.md`
- Modify: `Architecture.md`

- [ ] **Step 1: AGENTS.md 갱신**

다음을 반영:
- `/management` 라우트 책임 표의 탭 목록에 **org-chart** 추가, 약속에 "조직도는 비공개 버킷 `org-charts` 이미지 + 사외비 `org_charts` 테이블, 로컬 `sync_org_chart.py`로만 적재(Excel COM)" 한 줄.
- 보호 라우트 목록에 `api/management/org-chart/image/[date]` 추가.
- 데이터/DB 규칙 "사외비 테이블 격리"에 `org_charts`(migration 20260624000002) 추가.
- scripts 유지 목록(정기 재실행)에 `sync_org_chart.py` 추가 + 로컬 전용(Excel COM) 주석.
- `lib/supabase/confidential.ts` facade 목록에 `org_charts` 반영.

- [ ] **Step 2: Architecture.md 갱신**

- §5-A 경영관리 탭 구조에 조직도 탭(이미지 게시, 날짜 드롭다운) 추가.
- §7 데이터 모델에 `org_charts` 테이블 + `org-charts` 버킷 한 줄.

- [ ] **Step 3: 최종 check-all + 마이그레이션 순서 확인**

Run: `npm run check-all`
Expected: PASS.
Run: `ls supabase/migrations/ | tail -2`
Expected: `20260624000002_create_org_charts.sql`가 마지막 번호.

- [ ] **Step 4: pre-commit hook 통과 확인하며 Commit**

```bash
git add AGENTS.md Architecture.md
git commit -m "docs: 조직도 페이지 — 라우트·사외비·스크립트 문서화"
```
(hook이 AGENTS.md 누락을 막지 않도록 위 갱신을 같은 변경 세트에 포함.)

---

## Self-Review 결과

- **Spec coverage:** §2 권한→Task3, §3 데이터흐름→Task5, §5 DB/사외비→Task1·2, §6 스크립트→Task4·5, §7 UI→Task6·7·8, §8 문서→Task9, §9 검증→각 Task 검증 스텝 + Task8 Step5. 모두 매핑됨.
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 실제 코드 포함.
- **Type consistency:** `OrgChartMeta`(source.ts ↔ viewer), `getOrgCharts`, `parse_kor_sheets`, `upsert_rows(...,'chart_date')`, 버킷명 `org-charts`, 태그 `org_charts`, API 경로 `/api/management/org-chart/image/[date]` 전 태스크 일관.
