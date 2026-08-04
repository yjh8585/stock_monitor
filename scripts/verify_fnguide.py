#!/usr/bin/env python3
"""fnguide 수집 계약 헬스체크 — 사이트가 또 바뀌면 즉시 알아채기 위한 스크립트.

배경(2026-08-04): `comp.fnguide.com`이 `wcomp.fnguide.com`으로 이전됐는데, 구 도메인이
**HTTP 200과 함께** "페이지가 없습니다" 안내를 반환해 조용히 실패했다. 재무 수집
워크플로가 분기 1회(1·4·7·10월 15일)라 3주 넘게 아무도 몰랐다.

이 스크립트는 DB를 건드리지 않고 fnguide 응답만 검사한다(읽기 전용, 토큰 0).
실패하면 non-zero로 끝나 GitHub Actions가 알림을 띄운다.

검사 항목:
  1. 재무 JSON 엔드포인트가 살아 있고 dataset 구조를 유지하는가
  2. 필수 계정 코드(AC_CODE)가 응답에 존재하는가 — 코드 체계가 바뀌면 여기서 잡힌다
  3. 연간 응답의 '(최근분기)' 열이 연간으로 새지 않는가
  4. 투자지표 인라인 JSON(invValueIndex)을 여전히 추출할 수 있는가
  5. 기업개요 셀렉터(#bizSummaryContent, #giName)가 살아 있는가
  6. 종목을 바꿔 요청했을 때 엉뚱한 회사(삼성전자 폴백)가 오지 않는가

실행:
  scripts/venv/Scripts/python.exe scripts/verify_fnguide.py
  scripts/venv/Scripts/python.exe scripts/verify_fnguide.py --tickers 005930,000660
"""
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import argparse
import re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import fnguide_client as fng
from lib.fnguide_guard import is_fnguide_fallback

# 서로 다른 성격의 표본: 대형 12월 결산 2곳 + 3월 결산 1곳.
# 3월 결산사는 '연간 응답에 최근분기 열이 섞이는' 함정의 유일한 실사례라 반드시 포함한다.
DEFAULT_TICKERS = ('005930', '000660', '018500')

# 이 계정들이 사라지면 재무 수집이 통째로 비므로 계약 위반으로 본다.
REQUIRED_INCOME_CODES = ('200000', '201370', '203170')   # 매출액·영업이익·당기순이익
REQUIRED_BALANCE_CODES = ('110000', '130000', '120000')  # 자산·부채·자본 총계

_BIZ_SUMMARY_RE = re.compile(r'id=["\']bizSummaryContent["\']')
_GI_NAME_RE = re.compile(r'id=["\']giName["\'][^>]*>([^<]*)<')


class Checker:
  """검사 결과를 모으고 실패를 보고한다."""

  def __init__(self) -> None:
    self.failures: list[str] = []
    self.checks = 0

  def ok(self, label: str, condition: bool, detail: str = '') -> bool:
    self.checks += 1
    if condition:
      print(f'  [OK]   {label}' + (f' — {detail}' if detail else ''))
      return True
    self.failures.append(label)
    print(f'  [FAIL] {label}' + (f' — {detail}' if detail else ''))
    return False


def _check_financials(chk: Checker, ticker: str, session) -> None:
  """재무 JSON 엔드포인트 + 계정 코드 + 헤더 열 규칙."""
  income = fng.fetch_fin_dataset(ticker, 'income', fng.FREQ_ANNUAL,
                                 fng.CONSOL_CONSOLIDATED, session=session)
  if not chk.ok(f'{ticker} 연간 손익 dataset 수신', fng.has_dataset_values(income)):
    return

  codes = {str(r.get('AC_CODE') or '').strip() for r in income.get('data') or []}
  missing = [c for c in REQUIRED_INCOME_CODES if c not in codes]
  chk.ok(f'{ticker} 손익 필수 계정 코드', not missing,
         f'누락 {missing}' if missing else f'{len(codes)}개 계정')

  # 연간 응답에 최근분기 열이 섞여 와도 연간으로 새면 안 된다.
  annual_cols = fng.period_columns(income['header'], fng.FREQ_ANNUAL)
  labelled = [h.get('YYMM') for h in income['header']
              if '(최근분기)' in str(h.get('YYMM') or '')]
  leaked = [p.isoformat() for _, p in annual_cols
            if any(str(p.year) in str(lbl) and f'/{p.month:02d}' in str(lbl)
                   for lbl in labelled)]
  chk.ok(f'{ticker} 연간에 최근분기 열 미포함', not leaked, f'유출 {leaked}' if leaked else '')

  quarter = fng.fetch_fin_dataset(ticker, 'income', fng.FREQ_QUARTER,
                                  fng.CONSOL_CONSOLIDATED, session=session)
  qcols = fng.period_columns((quarter or {}).get('header') or [], fng.FREQ_QUARTER)
  chk.ok(f'{ticker} 분기 손익 기간 열', len(qcols) >= 3, f'{len(qcols)}개 기간')

  balance = fng.fetch_fin_dataset(ticker, 'balance', fng.FREQ_ANNUAL,
                                  fng.CONSOL_CONSOLIDATED, session=session)
  if chk.ok(f'{ticker} 연간 재무상태 dataset 수신', fng.has_dataset_values(balance)):
    bcodes = {str(r.get('AC_CODE') or '').strip() for r in balance.get('data') or []}
    bmissing = [c for c in REQUIRED_BALANCE_CODES if c not in bcodes]
    chk.ok(f'{ticker} 재무상태 필수 계정 코드', not bmissing,
           f'누락 {bmissing}' if bmissing else f'{len(bcodes)}개 계정')


def _check_invest(chk: Checker, ticker: str, session) -> None:
  """투자지표 인라인 JSON 추출."""
  obj = fng.fetch_invest_index(ticker, session=session)
  if not chk.ok(f'{ticker} 투자지표 invValueIndex 추출', bool(obj and obj.get('data'))):
    return
  names = {str(r.get('NM') or '').strip() for r in obj['data']}
  missing = [n for n in ('EPS', 'BPS', 'PER', 'PBR') if n not in names]
  chk.ok(f'{ticker} 투자지표 필수 항목', not missing,
         f'누락 {missing}' if missing else '')


def _check_snapshot(chk: Checker, ticker: str, session) -> None:
  """기업개요 셀렉터 + 폴백(엉뚱한 회사) 감지."""
  html = fng.fetch_page_html('Snapshot', ticker, session=session)
  if not chk.ok(f'{ticker} Snapshot 페이지 수신', bool(html)):
    return
  chk.ok(f'{ticker} #bizSummaryContent 셀렉터', bool(_BIZ_SUMMARY_RE.search(html)))

  m = _GI_NAME_RE.search(html)
  gi_name = (m.group(1).strip() if m else '')
  chk.ok(f'{ticker} #giName 셀렉터', bool(gi_name), gi_name)
  # 요청한 종목이 아닌 기본 페이지(삼성전자)가 오면 회사 소개가 통째로 오염된다.
  chk.ok(f'{ticker} 폴백 페이지 아님', not is_fnguide_fallback('', ticker, gi_name),
         gi_name)


def _check_legacy_domain(chk: Checker, session) -> None:
  """구 도메인이 조용한 200 안내 페이지를 주는 상태인지 기록한다(정보용)."""
  try:
    resp = session.get(
      f'{fng.LEGACY_BASE_URL}/SVO2/ASP/SVD_Finance.asp?pGB=1&gicode=A005930',
      timeout=fng.DEFAULT_TIMEOUT)
    alive = len(resp.content) > 5000
  except Exception:
    alive = False
  print(f'  [INFO] 구 도메인({fng.LEGACY_BASE_URL}) 실데이터 응답: '
        f'{"예" if alive else "아니오(폐지 상태 유지)"}')


def verifyFnguide(tickers: tuple[str, ...]) -> int:
  """fnguide 계약 전체를 검사하고 실패 수를 반환한다."""
  chk = Checker()
  session = fng.new_session()

  print(f'fnguide 계약 헬스체크 — base={fng.BASE_URL}')
  _check_legacy_domain(chk, session)

  for ticker in tickers:
    print(f'\n[{ticker}]')
    try:
      _check_financials(chk, ticker, session)
      _check_invest(chk, ticker, session)
      _check_snapshot(chk, ticker, session)
    except Exception as e:
      chk.ok(f'{ticker} 검사 수행', False, f'{type(e).__name__}: {e}')

  print(f'\n검사 {chk.checks}건 중 실패 {len(chk.failures)}건')
  if chk.failures:
    print('실패 항목:')
    for f in chk.failures:
      print(f'  - {f}')
    print('\n→ fnguide 계약이 바뀌었을 수 있다. docs/fnguide-wcomp-migration.md의 '
          '계약표와 실제 응답을 대조하고 scripts/lib/fnguide_client.py를 갱신할 것.')
  return len(chk.failures)


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='fnguide 수집 계약 헬스체크')
  parser.add_argument('--tickers', help='쉼표 구분 종목코드 (기본: 대표 3종목)')
  args = parser.parse_args()

  targets = tuple(t.strip().zfill(6) for t in args.tickers.split(',')) \
      if args.tickers else DEFAULT_TICKERS
  sys.exit(1 if verifyFnguide(targets) else 0)
