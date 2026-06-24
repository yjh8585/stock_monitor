"""조직도 엑셀 → 시점별 PNG 렌더 → 비공개 버킷 업로드 → org_charts 적재.

로컬 전용: Excel COM(win32com) 사용 → Windows + Excel 설치 필요.
Vercel·GHA엔 Excel/LibreOffice가 없어 서버 자동 렌더 불가.

소스: ORG_CHART_EXCEL_PATH env 우선, 없으면 참고/조직도/*.xlsx 최신(mtime).
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
from datetime import datetime, timezone
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
GLOB = '*.xlsx'
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
    cands = sorted(
        (p for p in base.glob(GLOB) if not p.name.startswith('~$')),
        key=lambda p: p.stat().st_mtime,
    )
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
            ws.Activate()  # 활성 시트로 만들어 엉뚱한 시트 export 방지
            ws.PageSetup.Zoom = False
            ws.PageSetup.FitToPagesWide = 1
            ws.PageSetup.FitToPagesTall = 1
            ws.PageSetup.Orientation = 2  # xlLandscape
            ws.PageSetup.PrintArea = ws.UsedRange.Address
            # 워크시트 단위 export — wb.ExportAsFixedFormat은 활성/전체 시트를 내보내
            # 대상 시트가 뒤바뀌는 버그가 있어 ws.ExportAsFixedFormat으로 고정.
            ws.ExportAsFixedFormat(0, str(pdf_path))  # 0 = xlTypePDF
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
            'apikey': service_key,
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

    # 재렌더 시 created_at을 갱신해 페이지의 캐시버스트 토큰(?v=created_at)이 바뀌도록 한다.
    rendered_at = datetime.now(timezone.utc).isoformat()

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
                    'created_at': rendered_at,
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
