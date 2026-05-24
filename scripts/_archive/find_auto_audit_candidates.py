#!/usr/bin/env python3
"""
DART 비상장 자동차 부품사 발견 스크립트 (누락 위험 ①).

companies 테이블에 등록되지 않은 자동차 induty 비상장 회사 중 최근 감사보고서
제출 이력이 있는 회사를 발견해 등록 후보 리포트로 출력한다.

흐름:
  1) DB 회사 키 집합(정규화 corp_name + ascii_part + 한글음역 + dart_corp_code) 로드
  2) DART corpCode.xml 수신 → 비상장 + 키워드 사전 필터 + DB 미등록 필터
  3) company.json induty 조회 (자동차 24~33, 46)
  4) dart.list 최근 2년 감사보고서 제출 이력 확인
  5) (옵션) 최신 감사보고서 본문에서 매출액 추출(정렬용)
  6) data/auto_audit_candidates_<YYYY-MM-DD>.csv + .md 저장 (매출 desc 정렬)

자동 INSERT 하지 않는다 — 사용자가 결과 보고 직접 결정한다.

실행:
  python scripts/find_auto_audit_candidates.py             # 매출 포함 (~60분)
  python scripts/find_auto_audit_candidates.py --skip-revenue  # 빠른 모드 (~20분)
"""

import argparse
import csv
import io as _io_mod
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
from dotenv import dotenv_values, load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

sys.path.insert(0, str(Path(__file__).parent))

from lib.db import get_client  # noqa: E402

import OpenDartReader  # noqa: E402

from collect_dart_audit import (  # noqa: E402
  HEADERS,
  _AUTO_INDUTY_PREFIXES,
  _ascii_part,
  _ascii_to_korean,
  _fetch_tables,
  _get_main_doc_url,
  _korean_to_ascii,
  _normalize_corp_name,
  _with_retry,
)

DART_KEY = ''
try:
  _env = dotenv_values(Path(__file__).parent / '.env')
  DART_KEY = _env.get('DART_API_KEY', '')
except Exception:
  pass
DART_KEY = DART_KEY or os.environ.get('DART_API_KEY', '')

# 자동차 부품 업계 사전 필터용 키워드 (corp_name 부분 일치).
# 너무 좁으면 누락, 너무 넓으면 induty 조회 부담이 큼 — 중간 수준으로 조정.
AUTO_KEYWORDS = [
  # 자동차/모빌리티 일반
  '자동차', '오토', '오토모티브', '오토모', '모티브', '모빌리티', '오토텍',
  # 부품 일반 단어
  '부품', '공업', '정공', '정밀', '기공', '메탈', '캐스팅', '주물',
  # 전장/전자/제어
  '전장', '일렉트로닉스', '컨트롤', '센서', '하니스', '하네스', '와이어',
  # 부품 카테고리
  '엔진', '브레이크', '와이퍼', '베어링', '미러', '램프', '필터',
  '서스펜션', '액슬', '클러치', '시트', '도어', '커넥터', '러버',
  '플라스틱', '폴리머', '캠', '실린더', '피스톤', '기어',
  # OEM/그룹 키워드
  '현대', '기아', '한국지엠', '르노',
  # 영문 키워드 (corp_name에 영문 포함된 경우)
  'auto', 'motor', 'motiv', 'mobility', 'parts', 'component',
]

OUTPUT_DIR = Path(__file__).parent.parent / 'data'


def _load_db_company_keys(client) -> tuple[set[str], set[str]]:
  """DB의 회사 정규화 키 집합 + dart_corp_code 집합 반환.

  매칭에 사용된 모든 키(정규화 한글명, ascii_part, 한→영 음역, 영→한 음역)를
  넣어 어떤 표기 차이가 있어도 '이미 등록된 회사'로 인식하도록 한다.
  """
  rows = (
    client.from_('companies').select('name,dart_corp_code,country').execute().data or []
  )
  norms: set[str] = set()
  codes: set[str] = set()
  for row in rows:
    name = row.get('name') or ''
    code = row.get('dart_corp_code') or ''
    if name:
      n = _normalize_corp_name(name)
      if n:
        norms.add(n)
      asc = _ascii_part(name)
      if asc:
        norms.add(asc)
      kor = _korean_to_ascii(name)
      if kor:
        norms.add(kor)
      e2k = _normalize_corp_name(_ascii_to_korean(name))
      if e2k:
        norms.add(e2k)
    if code:
      codes.add(code)
  logger.info(
    f'DB 회사 키 로드: {len(rows)}개 회사 → 정규화 키 {len(norms)}개, '
    f'dart_corp_code {len(codes)}개'
  )
  return norms, codes


def _fetch_corp_codes() -> pd.DataFrame:
  """DART corpCode.xml 수신 → DataFrame."""
  r = requests.get(
    'https://opendart.fss.or.kr/api/corpCode.xml',
    params={'crtfc_key': DART_KEY},
    timeout=(10, 60),
  )
  r.raise_for_status()
  z = zipfile.ZipFile(_io_mod.BytesIO(r.content))
  root = ET.fromstring(z.read(z.namelist()[0]))
  records = [
    {
      'corp_code': c.findtext('corp_code') or '',
      'corp_name': c.findtext('corp_name') or '',
      'corp_eng_name': c.findtext('corp_eng_name') or '',
      'stock_code': (c.findtext('stock_code') or '').strip(),
      'modify_date': c.findtext('modify_date') or '',
    }
    for c in root.iter('list')
  ]
  df = pd.DataFrame(records)
  logger.info(f'DART corpCode.xml 수신: {len(df)}개 법인')
  return df


def _keyword_match(name: str) -> bool:
  lower = name.lower()
  return any(kw.lower() in lower for kw in AUTO_KEYWORDS)


def _is_already_known(row: pd.Series, db_norms: set[str], db_codes: set[str]) -> bool:
  if row['corp_code'] in db_codes:
    return True
  for key in (row['corp_name'], row['corp_eng_name']):
    if not key:
      continue
    if _normalize_corp_name(key) in db_norms:
      return True
    if _ascii_part(key) in db_norms:
      return True
  return False


def _query_induty(corp_code: str) -> str:
  """company.json으로 induty_code 조회 — 실패 시 빈 문자열."""
  try:
    r = _with_retry(
      requests.get,
      'https://opendart.fss.or.kr/api/company.json',
      params={'crtfc_key': DART_KEY, 'corp_code': corp_code},
      headers=HEADERS,
      timeout=(10, 15),
    )
    info = r.json()
    if info.get('status') == '000':
      return str(info.get('induty_code') or '')
  except Exception as e:
    logger.debug(f'  {corp_code}: company.json 실패 — {e}')
  return ''


def _is_auto_induty(induty: str) -> bool:
  return any(induty.startswith(p) for p in _AUTO_INDUTY_PREFIXES)


def _find_recent_audit(dart, corp_code: str, lookback_years: int = 2):
  """최근 lookback_years년 감사보고서 (rcept_no, report_nm, rcept_dt) 또는 (None, None, None)."""
  today = datetime.now()
  start = f'{today.year - lookback_years}-01-01'
  end = today.strftime('%Y-%m-%d')
  try:
    filings = _with_retry(
      dart.list,
      corp_code,
      start=start,
      end=end,
      final=False,
      _deadline=60,
      _silence_stdout=True,
    )
  except Exception as e:
    logger.debug(f'  {corp_code}: dart.list 실패 — {e}')
    return None, None, None
  if filings is None or filings.empty:
    return None, None, None
  audits = []
  for _, row in filings.iterrows():
    rpt = str(row.get('report_nm', ''))
    if '감사보고서' in rpt:
      audits.append(
        (str(row.get('rcept_dt', '')), str(row.get('rcept_no', '')), rpt)
      )
  if not audits:
    return None, None, None
  audits.sort(reverse=True)
  rcept_dt, rcept_no, rpt = audits[0]
  return rcept_no, rpt, rcept_dt


def _extract_revenue(dart, rcept_no: str) -> float | None:
  """감사보고서 본문에서 매출액 추출 (정렬용 — 단위는 보장 안 됨, 같은 회사 내부 비교만 정확).

  자동차 부품 회사들 매출은 보통 백만원 단위로 표기되므로 같은 회사 간 비교는 일관성 있음.
  """
  try:
    url = _get_main_doc_url(dart, rcept_no)
  except Exception:
    return None
  if not url:
    return None
  try:
    tables = _fetch_tables(url)
  except Exception:
    return None
  rev_keywords = ('매출액', '매출수익', '영업수익')
  for table in tables:
    for tr in table.find_all('tr'):
      cells = tr.find_all(['td', 'th'])
      if not cells:
        continue
      first = cells[0].get_text(strip=True).replace(' ', '')
      if not first:
        continue
      if not any(first == kw or first.startswith(kw) for kw in rev_keywords):
        continue
      for c in cells[1:]:
        txt = c.get_text(strip=True).replace(',', '').replace(' ', '')
        m = re.search(r'-?\d+', txt)
        if m:
          try:
            return float(m.group())
          except ValueError:
            continue
      break
  return None


def main(skip_revenue: bool = False) -> None:
  logger.info('=== DART 비상장 자동차 부품사 후보 발견 시작 ===')
  if not DART_KEY:
    logger.error('DART_API_KEY 미설정 — 종료')
    sys.exit(1)

  client = get_client()
  db_norms, db_codes = _load_db_company_keys(client)

  df = _fetch_corp_codes()

  # 1. 비상장 필터
  df = df[df['stock_code'] == '']
  logger.info(f'비상장 필터: {len(df)}개')

  # 2. 키워드 사전 필터
  mask = df['corp_name'].apply(_keyword_match) | df['corp_eng_name'].fillna('').apply(_keyword_match)
  df = df[mask]
  logger.info(f'키워드 필터: {len(df)}개')

  # 3. DB 미등록 필터
  df = df[~df.apply(lambda r: _is_already_known(r, db_norms, db_codes), axis=1)].reset_index(drop=True)
  logger.info(f'DB 미등록 필터: {len(df)}개')

  # 4. induty 조회 (자동차 prefix만 통과)
  est_min = len(df) * 0.15 / 60
  logger.info(
    f'company.json induty 조회 시작 ({len(df)}개, 예상 ~{est_min:.0f}분)'
  )
  auto_rows = []
  for i, (_, row) in enumerate(df.iterrows(), 1):
    if i % 200 == 0:
      logger.info(f'  induty 진행: {i}/{len(df)} ({i / len(df) * 100:.0f}%)')
    induty = _query_induty(row['corp_code'])
    if induty and _is_auto_induty(induty):
      auto_rows.append(
        {
          'corp_code': row['corp_code'],
          'corp_name': row['corp_name'],
          'corp_eng_name': row['corp_eng_name'],
          'modify_date': row['modify_date'],
          'induty_code': induty,
        }
      )
    time.sleep(0.05)
  logger.info(f'자동차 induty 후보: {len(auto_rows)}개')

  # 5. 최근 감사보고서 + (옵션) 매출
  dart = OpenDartReader(DART_KEY)
  enriched = []
  est_min2 = len(auto_rows) * (10 if not skip_revenue else 0.5) / 60
  logger.info(
    f'감사보고서{"+매출" if not skip_revenue else ""} 조회 시작 '
    f'({len(auto_rows)}개, 예상 ~{est_min2:.0f}분)'
  )
  for i, row in enumerate(auto_rows, 1):
    if i % 30 == 0:
      logger.info(f'  감사보고서 진행: {i}/{len(auto_rows)} ({i / len(auto_rows) * 100:.0f}%)')
    rcept_no, report_nm, rcept_dt = _find_recent_audit(dart, row['corp_code'])
    revenue = None
    if rcept_no and not skip_revenue:
      try:
        revenue = _extract_revenue(dart, rcept_no)
      except Exception as e:
        logger.debug(f'  {row["corp_code"]}: 매출 추출 실패 — {e}')
    enriched.append(
      {
        **row,
        'recent_audit_rcept_dt': rcept_dt or '',
        'recent_audit_report': report_nm or '',
        'recent_audit_rcept_no': rcept_no or '',
        'revenue_raw': revenue,
      }
    )
    time.sleep(0.1)

  enriched.sort(key=lambda r: -(r['revenue_raw'] if r['revenue_raw'] is not None else -1))

  # 출력
  OUTPUT_DIR.mkdir(exist_ok=True)
  today = datetime.now().strftime('%Y-%m-%d')
  csv_path = OUTPUT_DIR / f'auto_audit_candidates_{today}.csv'
  md_path = OUTPUT_DIR / f'auto_audit_candidates_{today}.md'

  cols = [
    'corp_code',
    'corp_name',
    'corp_eng_name',
    'induty_code',
    'modify_date',
    'recent_audit_rcept_dt',
    'recent_audit_report',
    'recent_audit_rcept_no',
    'revenue_raw',
  ]
  with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for row in enriched:
      w.writerow(row)
  logger.info(f'CSV 저장: {csv_path} ({len(enriched)}행)')

  with open(md_path, 'w', encoding='utf-8') as f:
    f.write(f'# DART 비상장 자동차 부품사 후보 — {today}\n\n')
    f.write(f'- 총 후보: {len(enriched)}개\n')
    f.write('- 필터: 비상장 + 키워드 사전 매치 + DB 미등록 + 자동차 induty(24~33, 46)\n')
    f.write('- 정렬: 최근 감사보고서 매출(raw 숫자) 내림차순. 값 없는 회사는 마지막.\n')
    f.write(
      '- 매출은 본문 첫 매칭 셀의 raw 값 — 백만원 단위가 일반적이지만 보장 안 됨(정렬용).\n\n'
    )
    f.write(
      '| # | 회사명 | corp_code | 영문명 | induty | 최근 감사보고서 일자 | 보고서명 | 매출 (raw) |\n'
    )
    f.write('|---|---|---|---|---|---|---|---:|\n')
    for i, row in enumerate(enriched, 1):
      rev = f'{row["revenue_raw"]:,.0f}' if row['revenue_raw'] is not None else '-'
      f.write(
        f'| {i} | {row["corp_name"]} | {row["corp_code"]} | '
        f'{(row["corp_eng_name"] or "")[:30]} | {row["induty_code"]} | '
        f'{row["recent_audit_rcept_dt"]} | {row["recent_audit_report"]} | {rev} |\n'
      )
  logger.info(f'MD 저장: {md_path}')
  logger.info('=== 완료 ===')


if __name__ == '__main__':
  parser = argparse.ArgumentParser()
  parser.add_argument(
    '--skip-revenue', action='store_true', help='매출 추출 생략 (빠른 모드 ~20분)'
  )
  args = parser.parse_args()
  main(skip_revenue=args.skip_revenue)
