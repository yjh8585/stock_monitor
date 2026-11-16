#!/usr/bin/env python3
"""MarkLines 엑셀 수동 적재 — 브라우저로 받은 파일을 알아보고 제자리에 두고 DB 에 올린다.

배경(2026-11-16): MarkLines 약관 7조 9항(자동 다운로드 금지)으로 자동 수집(`sync_oem_*_excel.py` ·
GHA 4개)을 껐다. 🔴 이 스크립트는 MarkLines 에 **아무 요청도 보내지 않는다** — 사용자가 브라우저에서
손으로 받은 파일만 읽는다. 받는 곳·순서 = `docs/oem-collection.md` 「MarkLines 엑셀 수동 적재」.

파일 이름이 아니라 **내용**으로 종류를 가린다(브라우저가 `(1)` 을 붙이거나 이름이 달라도 된다).

| 종류       | 알아보는 법                                         | 놓는 곳                                    |
| ---------- | --------------------------------------------------- | ------------------------------------------ |
| sales      | 7번째 칸 = PowerTrain + 월 칸이 여러 해(2024.01~)   | 참고/oem 판매량/MarkLines_sales_data_en.xlsx  |
| production | 메타 6칸 + 월 칸이 여러 해(2024.01~)                | 참고/oem 생산량/MarkLines_product_data_en.xlsx |
| passenger  | 메타 6칸 + 월 칸이 한 해 + 나라가 China 뿐          | 참고/oem 중국/china_passenger_YYYY.xlsx       |
| export     | 시트 이름이 「YYYY by …」                           | 참고/oem 중국/china_exp_en.xlsx               |
| nev        | 이름이 china_monthly_prod*.xls                      | 참고/oem 중국/china_monthly_prod_en.xls       |

검증·적재는 자동 수집기와 같은 함수를 쓴다(판매·생산 `validate_excel_structure` · 중국 `sync_one`).
판매·생산은 최신 롤링 파일만 올린다(옛 연도 파일은 바뀌지 않는다 — GHA 와 같은 범위).
받은 원본은 그대로 둔다(같은 내용이면 「변경 없음」으로 건너뛴다).

종료 코드: 0 정상 · 1 검증·적재 실패가 하나라도 · 2 알아본 파일이 하나도 없음

사용법
-----
  python scripts/import_marklines_manual.py              # 다운로드 폴더의 최근 7일 파일
  python scripts/import_marklines_manual.py --dir D:/x   # 다른 폴더
  python scripts/import_marklines_manual.py --dry-run    # 알아보기·검증만(파일 이동·DB 없음)
"""
import argparse
import hashlib
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

import openpyxl
from loguru import logger

sys.path.insert(0, str(Path(__file__).parent))
from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

import import_oem_production  # noqa: E402
import import_oem_sales  # noqa: E402
import sync_oem_china_excel as scx  # noqa: E402
import sync_oem_excel  # noqa: E402
import sync_oem_production_excel  # noqa: E402

META6 = sync_oem_production_excel.EXPECTED_HEADER_PREFIX  # 메타 6칸 정본 — 다시 적지 않는다
EXPORT_SHEET_RE = re.compile(r'^\d{4} by ')
SALES_TARGET = sync_oem_excel.TARGET_FILE
PRODUCTION_TARGET = sync_oem_production_excel.TARGET_FILE
LABEL = {
  'sales': '판매량',
  'production': '생산량',
  'nev': '중국 배기량·NEV',
  'export': '중국 수출',
  'passenger': '중국 승용차',
}


def _yyyymm(v) -> int | None:
  try:
    n = int(float(v))
  except (TypeError, ValueError):
    return None
  return n if 190001 <= n <= 299912 and 1 <= n % 100 <= 12 else None


def classify_header(sheetnames: list[str], header: list, countries: set) -> tuple[str | None, int | None]:
  """엑셀 머리만 보고 (종류, 승용차 연도) 를 가린다. 모르면 (None, None). 순수 함수."""
  if any(EXPORT_SHEET_RE.match(s) for s in sheetnames):
    return 'export', None
  if tuple(header[:6]) != META6:
    return None, None
  is_sales = len(header) > 6 and header[6] == 'PowerTrain'
  months = [m for m in (_yyyymm(v) for v in header[7 if is_sales else 6:]) if m]
  if not months:
    return None, None
  years = {m // 100 for m in months}
  if len(years) > 1:
    return ('sales' if is_sales else 'production'), None
  if is_sales:
    return None, None  # 판매 연도별 이력 파일(…_2023_en) — 롤링 파일로 덮으면 그 해가 두 번 더해진다(2026-11-16 검토)
  # 생산 연도별 이력 파일(…_2021_en)도 한 해짜리라, 나라가 중국뿐일 때만 승용차로 본다(첫 행만 보면 China 가 먼저 나와 오인 — 2026-11-16 실측)
  if countries == {'China'}:
    return 'passenger', years.pop()
  return None, None


def classify(path: Path) -> tuple[str | None, int | None]:
  name = path.name.lower()
  if path.suffix.lower() == '.xls':
    return ('nev', None) if name.startswith('china_monthly_prod') else (None, None)
  if path.suffix.lower() != '.xlsx':
    return None, None
  try:
    # read_only=True 는 이 엑셀에서 조용히 0행을 낼 수 있다(docs/gotchas-data-collection.md) — 나라 열을 다 세야 해서 일반 모드로 연다
    wb = openpyxl.load_workbook(path, data_only=True)
  except Exception as e:
    logger.warning(f'{path.name}: 엑셀로 열 수 없음 — 건너뜀 ({e})')
    return None, None
  try:
    sheets = list(wb.sheetnames)
    if any(EXPORT_SHEET_RE.match(s) for s in sheets):
      return classify_header(sheets, [], set())  # 수출 판정은 classify_header 한 곳 — 무거운 시트는 안 읽는다
    ws = wb[sheets[0]]
    header = [v for v in next(ws.iter_rows(min_row=2, max_row=2, values_only=True)) if v is not None]
    countries = {r[0] for r in ws.iter_rows(min_row=3, max_col=1, values_only=True) if r[0]}
    return classify_header(sheets, header, countries)
  finally:
    wb.close()


def _md5(p: Path) -> str:
  return hashlib.md5(p.read_bytes()).hexdigest()


def _rolling(kind: str, src: Path, dry_run: bool) -> str:
  """판매·생산 최신 롤링 파일: 검증 → 같으면 건너뜀 → 제자리에 복사 → 그 파일만 적재."""
  if kind == 'sales':
    validate, target, importer = sync_oem_excel.validate_excel_structure, SALES_TARGET, import_oem_sales
  else:
    validate, target = sync_oem_production_excel.validate_excel_structure, PRODUCTION_TARGET
    importer = import_oem_production
  if not validate(src):
    return '실패(구조 검증)'
  if target.exists() and _md5(src) == _md5(target):
    return '변경 없음'
  if dry_run:
    return '적재 예정(dry-run)'
  # 🔴 적재가 끝난 뒤에 제자리로 복사한다 — 먼저 바꾸면 실패한 회차 다음 실행이 「변경 없음」으로 건너뛰어
  #    그 주 자료가 영영 안 올라간다(sync_oem_china_excel.sync_one 과 같은 순서 · 2026-11-16 검토)
  try:
    rc = importer.main([src])
  except Exception as e:
    logger.exception(f'{src.name} 적재 실패')
    return f'실패(적재: {e})'
  if rc != 0:
    return f'실패(적재 rc={rc})'
  target.parent.mkdir(parents=True, exist_ok=True)
  shutil.copy2(src, target)
  return '적재 완료'


def _china(kind: str, year: int | None, src: Path, dry_run: bool):
  """중국 3종: 자동 수집기의 sync_one 을 그대로 쓴다(검증·변경 비교·적재·교체). 원본은 사본으로 넘긴다."""
  if kind == 'nev':
    target, parse = scx.imp.NEV_FILE, scx.imp.parse_nev_file
  elif kind == 'export':
    target, parse = scx.imp.EXPORT_FILE, scx.imp.parse_export_file
  else:
    target, parse = scx.imp.CHINA_DIR / f'china_passenger_{year}.xlsx', scx._parse_passenger_tmp(year)
  scx.imp.CHINA_DIR.mkdir(parents=True, exist_ok=True)
  with tempfile.NamedTemporaryFile(prefix='marklines_manual_', suffix=src.suffix, delete=False) as f:
    tmp = Path(f.name)
  try:
    shutil.copy2(src, tmp)  # sync_one 은 넘긴 파일을 옮기거나 지운다 — 사용자 원본을 지키려고 사본을 준다
    res = scx.sync_one(kind, tmp, target, parse, dry_run)
  except scx.SyncError as e:
    return f'실패({e})', None
  except Exception as e:
    logger.exception(f'{src.name} 처리 실패')
    return f'실패({e})', None
  finally:
    tmp.unlink(missing_ok=True)  # sync_one 이 이미 옮겼으면 없다
  if res is None:
    return '변경 없음', None
  return ('검증 통과(dry-run · 변경 비교 생략)' if dry_run else '적재 완료'), res


def pick_files(folder: Path, days: int) -> dict[tuple[str, int | None], Path]:
  """폴더의 최근 파일을 종류별로 가린다. 같은 종류가 여럿이면 가장 최근 것."""
  cutoff = time.time() - days * 86400
  found: dict[tuple[str, int | None], Path] = {}
  files = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in ('.xls', '.xlsx')]
  for p in sorted(files, key=lambda p: p.stat().st_mtime):
    if p.stat().st_mtime < cutoff or p.name.startswith('~$'):
      continue
    kind, year = classify(p)
    if kind is None:
      continue
    key = (kind, year)
    if key in found:
      logger.info(f'{LABEL[kind]}: {found[key].name} 보다 최근인 {p.name} 을 쓴다')
    found[key] = p
  return found


def main(argv: list[str] | None = None) -> int:
  ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
  ap.add_argument('--dir', type=Path, default=Path.home() / 'Downloads', help='받은 파일이 있는 폴더(기본 = 다운로드)')
  ap.add_argument('--days', type=int, default=7, help='이 일수 안에 받은 파일만 본다(기본 7)')
  ap.add_argument('--dry-run', action='store_true', help='알아보기·검증만 — 파일 이동·DB 없음')
  args = ap.parse_args(argv)

  if not args.dir.is_dir():
    logger.error(f'폴더 없음: {args.dir}')
    return 2
  found = pick_files(args.dir, args.days)
  if not found:
    logger.error(f'{args.dir} 에서 최근 {args.days}일 안에 받은 MarkLines 엑셀을 하나도 못 찾았다')
    return 2

  results: list[tuple[str, str, str]] = []
  for kind in ('sales', 'production'):
    if (kind, None) in found:
      src = found[(kind, None)]
      results.append((LABEL[kind], src.name, _rolling(kind, src, args.dry_run)))

  nev = None
  passengers = []
  order = [('nev', None), ('export', None)] + sorted(k for k in found if k[0] == 'passenger')
  for kind, year in order:
    if (kind, year) not in found:
      continue
    src = found[(kind, year)]
    status, res = _china(kind, year, src, args.dry_run)
    label = LABEL[kind] + (f' {year}' if year else '')
    results.append((label, src.name, status))
    if kind == 'nev':
      nev = res
    elif kind == 'passenger' and res is not None:
      passengers.append(res)
  if passengers:  # 자동 수집기와 같은 교차 검증(승용차 합계 ↔ 배기량 표)
    if nev is None and scx.imp.NEV_FILE.exists():
      nev = scx.imp.parse_nev_file(scx.imp.NEV_FILE)[0]
    if nev is None:
      logger.warning('배기량·NEV 표가 없어 승용차 교차 검증을 건너뛴다 — 3번 파일도 받아 다시 돌리면 확인된다')
    for res in passengers if nev is not None else []:
      scx.imp.cross_check(nev, res)

  missing = [LABEL[k] for k in ('sales', 'production', 'nev', 'export') if (k, None) not in found]
  if not any(k[0] == 'passenger' for k in found):
    missing.append(LABEL['passenger'])

  logger.info('──── 결과 ────')
  for label, name, status in results:
    logger.info(f'{label:<12} {status:<16} ← {name}')
  if missing:
    logger.warning(f'이번에 못 찾은 파일: {", ".join(missing)} — 안 받았으면 다음에 받아도 된다')
  failed = [r for r in results if r[2].startswith('실패')]
  return 1 if failed else 0


if __name__ == '__main__':
  sys.exit(main())
