#!/usr/bin/env python3
"""MarkLines 중국 엑셀 3종 자동 다운로드 + 변경 감지 + DB 동기화 (/oem/china).

소스 = vehicle_production/member 페이지의 China 카드(트럭·버스 링크는 제외 — 사용자 지시 2026-10-29).

| 종류             | 받는 법                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| Displacement/NEV | statistics/product/china_monthly_prod 페이지에서 .xls 링크(갱신 날짜가 박힘)  |
| Export Volume    | statistics/product/china_export 페이지에서 .xlsx 링크(갱신 날짜가 박힘)      |
| Passenger Cars   | vehicle_production/preset/excel/month?nationCode=CHN&fromYear=Y&toYear=Y     |

🔴 승용차 엑셀은 303 리다이렉트를 거친다 — requests 의 자동 리다이렉트를 쓰면 쿠키가 떨어져
로그인 화면(HTML 200)이 온다(_get() 주석 · 2026-10-30 실측). 판매·생산 sync 와 페이지·레이아웃이
모두 달라 코드를 공유하지 않고 쿠키 세션만 sync_oem_production_excel.build_session 을 빌려 쓴다.

처리 흐름: 다운로드 → 파서로 구조 검증(헤더·Grand Total·최신 연도 시트) → 로컬(참고/oem 중국/)과 같으면
건너뜀 → 다르면 import_oem_china.load (upsert + stale 키 삭제 + 캐시 무효화) 뒤 파일 교체.
「같다」는 md5 로 보되, 승용차 엑셀은 받을 때마다 zip 안 파일 시각이 바뀌어 바이트가 늘 다르므로
읽은 행으로 견준다(2026-10-30 실측 — 9개 파일 모두 항목 시각 = 받은 시각).
⚠️ 파서 규칙(GROUP_ALIASES 등)만 고치면 파일이 같아 다시 적재되지 않는다 — 로컬에서
import_oem_china.py 를 돌리거나 Actions 캐시를 지운 뒤 workflow_dispatch 로 돌린다.
승용차는 올해·작년 두 해만 받는다(작년 수치가 연초에 수정된다). 첫 적재는 --backfill(2018~).

종료 코드
--------
0: 정상 (변경 없음 또는 업데이트 성공)
1: MARKLINES_COOKIE 미설정 / 쿠키 만료
2: 엑셀 링크 파싱 실패 (페이지 구조 변경)
3: 다운로드 HTTP 오류 / HTML 응답(인증 실패) / 네트워크 오류 / MarkLines 밖 리다이렉트
4: 파일 구조 불일치 (파서 검증 실패 — 로컬 파일·DB 보존)
5: DB 적재 실패

사용법
-----
  python scripts/sync_oem_china_excel.py              # 주간 동기화
  python scripts/sync_oem_china_excel.py --backfill   # 승용차 2018~ 전부
  python scripts/sync_oem_china_excel.py --dry-run    # 받고 검증만(저장·DB 없음)
경위·결정 = docs/plans/2026-10-29-oem-china-tab.md
"""
import argparse
import hashlib
import re
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import requests
from loguru import logger

sys.path.insert(0, str(Path(__file__).parent))
from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

import import_oem_china as imp  # noqa: E402
from lib.china_excel import ParseResult, parse_passenger_sheet  # noqa: E402
from sync_oem_production_excel import build_session  # noqa: E402

BASE = 'https://www.marklines.com'
NEV_PAGE = f'{BASE}/en/statistics/product/china_monthly_prod'
EXPORT_PAGE = f'{BASE}/en/statistics/product/china_export'
PASSENGER_EXCEL = (
  f'{BASE}/en/vehicle_production/preset/excel/month'
  '?nationCode=CHN&fromYear={y}&toYear={y}&excelDownloadMethod=1'
)
NEV_LINK_RE = re.compile(r'/statics/pages/xls/daisu/china_monthly_prod_en_\d+\.xls\b')
EXPORT_LINK_RE = re.compile(r'/statics/pages/xls/daisu/china_exp_en_\d+\.xlsx\b')
REQUEST_TIMEOUT = 180
MAX_REDIRECTS = 5


class SyncError(Exception):
  def __init__(self, code: int, msg: str):
    super().__init__(msg)
    self.code = code


def _get(session: requests.Session, src: str) -> tuple[requests.Response, str]:
  """GET + 리다이렉트를 손으로 따라간다. 반환 = (마지막 응답, 마지막 URL).

  requests 의 자동 리다이렉트는 build_session 이 박은 원문 Cookie 헤더를 떼고 빈 쿠키 jar 로 다시 만들어서,
  303 다음 요청이 로그인 화면(HTML 200)으로 떨어진다(2026-10-30 실측). 손으로 따라가면 헤더가 남으므로
  🔴 MarkLines 주소 밖으로는 따라가지 않는다 — 쿠키가 다른 서버로 새면 안 된다.
  """
  url = src
  for _ in range(MAX_REDIRECTS):
    r = session.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=False)
    if r.status_code not in (301, 302, 303, 307, 308):
      return r, url
    url = urljoin(url, r.headers.get('Location', ''))
    if urlparse(url).netloc != urlparse(BASE).netloc:
      raise SyncError(3, f'MarkLines 밖으로 리다이렉트 — 쿠키를 보내지 않고 멈춘다 ({src} → {url})')
  raise SyncError(3, f'리다이렉트가 {MAX_REDIRECTS}번을 넘었다 — {src}')


def fetch_page(session: requests.Session, url: str) -> str:
  r, final_url = _get(session, url)
  if r.status_code != 200:
    raise SyncError(1, f'{url} HTTP {r.status_code} — 쿠키 만료 가능')
  # 만료 쿠키는 로그인으로 보내거나 비회원 화면(200)을 준다 — 생산량 sync 와 같은 두 갈래 판정
  if '/members/login' in final_url or 'login_form' in r.text.lower():
    raise SyncError(1, f'로그인 화면 — MARKLINES_COOKIE 만료 ({url})')
  return r.text


def find_link(html: str, pattern: re.Pattern, page_url: str) -> str:
  m = pattern.search(html)
  if not m:
    raise SyncError(2, f'엑셀 링크 미발견 — 페이지 구조 변경 가능 ({page_url}, 패턴 {pattern.pattern})')
  return urljoin(page_url, m.group(0))


def download(session: requests.Session, src: str, suffix: str) -> Path:
  r, _ = _get(session, src)  # 승용차 엑셀은 303 을 거친다
  if r.status_code != 200:
    raise SyncError(3, f'다운로드 HTTP {r.status_code} — {src}')
  ctype = r.headers.get('Content-Type', '')
  if 'html' in ctype.lower():
    raise SyncError(3, f'다운로드 응답이 HTML — 쿠키 만료 또는 인증 실패 ({src}, Content-Type={ctype})')
  with tempfile.NamedTemporaryFile(prefix='marklines_cn_', suffix=suffix, delete=False) as f:
    f.write(r.content)
  logger.info(f'다운로드 {len(r.content) / 1024 / 1024:.2f} MB ← {src}')
  return Path(f.name)


def md5_of(path: Path) -> str:
  return hashlib.md5(path.read_bytes()).hexdigest()


def _rows_key(result: ParseResult) -> list:
  return sorted(tuple(sorted(r.items(), key=lambda kv: kv[0])) for r in result.rows)


def _same_as_local(kind: str, tmp: Path, target: Path, result: ParseResult, parse) -> bool:
  if not target.exists():
    return False
  if md5_of(tmp) == md5_of(target):
    return True
  # 승용차 엑셀은 받을 때마다 바이트가 달라 md5 로는 늘 「바뀜」이다 — 읽은 행으로 견준다
  return kind == 'passenger' and _rows_key(parse(target)[0]) == _rows_key(result)


def sync_one(kind: str, tmp: Path, target: Path, parse, dry_run: bool) -> ParseResult | None:
  """받은 파일 1개: 검증 → (바뀌었으면) 교체 + 적재. 반환 = 파싱 결과(검증용), 건너뛰면 None."""
  try:
    try:
      result, years = parse(tmp)
    except Exception as e:  # 파서가 헤더·Grand Total·연도 시트를 검사한다
      raise SyncError(4, f'{target.name} 구조 검증 실패: {e}') from e
    this_year = datetime.now(ZoneInfo('Asia/Seoul')).year
    if kind != 'passenger' and max(years) < this_year - 1:
      # 새해 시트 이름만 바뀌면 그 해가 조용히 빠지고 데이터가 전년에서 멈춘다(1월은 작년 시트까지 허용)
      raise SyncError(4, f'{target.name} 최신 연도 시트가 {max(years)} — {this_year - 1} 이상이어야 한다')
    if dry_run:
      imp.load(kind, result, years, dry_run=True)
      return result
    if _same_as_local(kind, tmp, target, result, parse):
      logger.success(f'{target.name}: 변경 없음 — 적재 건너뜀')
      return None
    try:
      imp.load(kind, result, years, dry_run=False)
    except Exception as e:
      raise SyncError(5, f'{target.name} 적재 실패: {e}') from e
    # 적재가 끝난 뒤에 교체한다 — 먼저 바꾸면 실패한 회차 다음 실행이 「변경 없음」으로 건너뛴다
    shutil.move(str(tmp), str(target))
    return result
  finally:
    tmp.unlink(missing_ok=True)


def _parse_passenger_tmp(year: int):
  def parse(path: Path):
    return parse_passenger_sheet(imp.read_xlsx_sheets(path)['Sheet1']), [year]
  return parse


def run(backfill: bool, dry_run: bool) -> int:
  imp.CHINA_DIR.mkdir(parents=True, exist_ok=True)
  session = build_session()

  nev_url = find_link(fetch_page(session, NEV_PAGE), NEV_LINK_RE, NEV_PAGE)
  nev = sync_one('nev', download(session, nev_url, '.xls'), imp.NEV_FILE, imp.parse_nev_file, dry_run)

  export_url = find_link(fetch_page(session, EXPORT_PAGE), EXPORT_LINK_RE, EXPORT_PAGE)
  sync_one('export', download(session, export_url, '.xlsx'), imp.EXPORT_FILE, imp.parse_export_file, dry_run)

  this_year = datetime.now(ZoneInfo('Asia/Seoul')).year
  years = range(imp.MIN_YEAR, this_year + 1) if backfill else (this_year - 1, this_year)
  passengers = []
  for y in years:
    tmp = download(session, PASSENGER_EXCEL.format(y=y), '.xlsx')
    target = imp.CHINA_DIR / f'china_passenger_{y}.xlsx'
    res = sync_one('passenger', tmp, target, _parse_passenger_tmp(y), dry_run)
    if res is not None:
      passengers.append(res)

  if passengers:
    nev = nev or imp.parse_nev_file(imp.NEV_FILE)[0]
    for res in passengers:
      imp.cross_check(nev, res)
  logger.success('중국 엑셀 동기화 완료' + (' (dry-run)' if dry_run else ''))
  return 0


def main() -> int:
  ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
  ap.add_argument('--backfill', action='store_true', help=f'승용차 엑셀을 {imp.MIN_YEAR}년부터 전부 받는다')
  ap.add_argument('--dry-run', action='store_true', help='받고 검증만 — 저장·DB 적재 없음')
  args = ap.parse_args()
  try:
    return run(args.backfill, args.dry_run)
  except SyncError as e:
    logger.error(str(e))
    return e.code
  except requests.RequestException as e:  # 시간 초과·연결 끊김 — 파이썬 기본 exit 1(쿠키 만료)과 섞지 않는다
    logger.error(f'네트워크 오류: {e}')
    return 3


if __name__ == '__main__':
  sys.exit(main())
