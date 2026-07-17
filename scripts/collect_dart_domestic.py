#!/usr/bin/env python3
"""
/domestic 페이지 회사들의 DART 자동 갱신 + 외감 검증 + 재무 수집.

처리 흐름 (회사별):
  1. find_corp_code(name_kr) → 매칭 실패 시 manual_dart_mapping.json 폴백
     → 둘 다 실패 → dart_collection_status='no_match' + DART_NO_MATCH 로그
  2. dart.company(corp_code) 의 corp_name 회수 → companies.name_kr 자동 갱신
     (옛 회사명 → 최신 회사명. 예: 이래에이엠에스 → 한세모빌리티)
  3. 결산감사보고서 rcpNo → 본문 HTML 파싱 (CFS 우선)
     없으면 finstate_all(fs_div='CFS') → 'OFS' 순차 폴백
     모두 실패 → dart_collection_status='no_audit_report' + NO_AUDIT_REPORT 로그
  4. 매출/영업이익/순이익/총자산/부채/자본/재고 → financials upsert (백만원)

재실행 안전: status='active' 회사만 처리.
수집 실패는 dart_collection_status / last_collect_error / retry_after에 기록되며
companies.status 는 변경하지 않는다(상장 상태와 수집 결과를 분리).
실패 회사는 retry_after(기본 7일 backoff) 만료 시 자동 재시도.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv, dotenv_values
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import WriteSession, upsert_rows
from collect_dart_audit import (
  MILLION,
  _fetch_tables,
  _get_audit_rcpt,
  _get_dart,
  _get_main_doc_url,
  _match_acct,
  _parse_financial_tables,
  _target_years,
)

DART_KEY = (
  dotenv_values(Path(__file__).parent / '.env').get('DART_API_KEY', '')
  or os.environ.get('DART_API_KEY', '')
)

MANUAL_MAPPING_PATH = Path(__file__).parent / 'lib' / 'manual_dart_mapping.json'


def _load_manual_mapping() -> dict[str, str]:
  """수동 매칭 매핑(회사명/티커 → corp_code) 로드."""
  if not MANUAL_MAPPING_PATH.exists():
    return {}
  raw = json.loads(MANUAL_MAPPING_PATH.read_text(encoding='utf-8'))
  return {k: v for k, v in raw.items() if not k.startswith('_')}


def _load_force_set() -> set[str]:
  """FORCE_TICKERS 환경변수(콤마 구분) → ticker/name_kr 강제 재수집 셋.

  has_fin에 이미 있는 회사라도 이 셋에 포함되면 재처리한다.
  financials는 upsert(on_conflict 키)이므로 덮어쓰기 안전.
  """
  raw = os.environ.get('FORCE_TICKERS', '').strip()
  return {t.strip() for t in raw.split(',') if t.strip()}


def _resolve_corp_code(odr, name_kr: str, ticker: str, manual: dict[str, str]) -> str | None:
  """find_corp_code 시도 → 실패 시 수동 매핑 룩업."""
  try:
    code = odr.find_corp_code(name_kr)
    if code:
      return str(code)
  except Exception as e:
    logger.debug(f'find_corp_code 실패 ({name_kr}): {e}')
  return manual.get(ticker) or manual.get(name_kr)


def _resolve_corp_name(odr, corp_code: str) -> str | None:
  """corp_code → 최신 corp_name(공시 등록명)."""
  try:
    info = odr.company(corp_code)
    if isinstance(info, dict):
      name = info.get('corp_name')
      return str(name).strip() if name else None
  except Exception as e:
    logger.debug(f'company({corp_code}) 실패: {e}')
  return None


def _try_finstate_all(odr, corp_code: str, year: int, fs_div: str) -> dict[str, dict[str, float | None]]:
  """finstate_all로 재무 데이터 dict 반환. fs_div ∈ {CFS(연결), OFS(별도)}."""
  try:
    df = odr.finstate_all(corp_code, year, fs_div=fs_div)
  except Exception as e:
    logger.debug(f'finstate_all 실패 {corp_code} {year} {fs_div}: {e}')
    return {}
  if df is None or len(df) == 0:
    return {}

  result: dict[str, dict[str, float | None]] = {}
  for _, r in df.iterrows():
    acc_nm = str(r.get('account_nm', '')).strip()
    # _match_acct: 정확일치 우선 + ACCT_REJECT('매출채권'·'매출총이익' 등 함정계정 거부).
    # 과거 부분문자열 매칭(if k in acc_nm)은 짧은 키 '매출'이 '매출채권'을 잡아
    # 매출채권(외상매출금)을 revenue로 오적재했다. audit-HTML 경로와 동일 매퍼 사용.
    db_col = _match_acct(acc_nm)
    if not db_col or db_col in result:
      continue
    curr_raw = r.get('thstrm_amount')
    prev_raw = r.get('frmtrm_amount')
    try:
      curr = float(str(curr_raw).replace(',', '')) if curr_raw not in (None, '', '-') else None
    except (ValueError, TypeError):
      curr = None
    try:
      prev = float(str(prev_raw).replace(',', '')) if prev_raw not in (None, '', '-') else None
    except (ValueError, TypeError):
      prev = None
    if curr is not None:
      result[db_col] = {
        'current': curr / MILLION,
        'prior': prev / MILLION if prev is not None else None,
      }
  return result


def _collect_year(odr, corp_code: str, year: int) -> tuple[dict[str, dict[str, float | None]], str]:
  """1회계연도 재무 수집. 우선순위: 결산감사 HTML(CFS) > finstate_all(CFS) > finstate_all(OFS).
  반환: (parsed dict, source 라벨). 데이터 없으면 ({}, '')."""
  try:
    rcpt = _get_audit_rcpt(odr, corp_code, year)
    if rcpt:
      url = _get_main_doc_url(odr, rcpt)
      if url:
        tables = _fetch_tables(url)
        parsed = _parse_financial_tables(tables) if tables else {}
        if parsed:
          return parsed, 'AUDIT_HTML'
  except Exception as e:
    logger.debug(f'audit_rcpt/main_doc 실패 {corp_code} {year}: {e}')

  parsed = _try_finstate_all(odr, corp_code, year, fs_div='CFS')
  if parsed:
    return parsed, 'FINSTATE_CFS'

  parsed = _try_finstate_all(odr, corp_code, year, fs_div='OFS')
  if parsed:
    return parsed, 'FINSTATE_OFS'

  return {}, ''


def _build_rows(company_id: str, year: int, parsed: dict[str, dict[str, float | None]]) -> list[dict]:
  """parsed → financials 행(당기 + 가능하면 전기)."""
  rows: list[dict] = []
  curr_row: dict = {
    'company_id': company_id,
    'period_type': 'annual',
    'fiscal_year': year,
    'fiscal_quarter': None,
    'period_end_date': f'{year}-12-31',
    'currency': 'KRW',
  }
  for col, vals in parsed.items():
    if vals['current'] is not None:
      curr_row[col] = round(vals['current'], 4)
  if len(curr_row) > 6:
    rows.append(curr_row)

  prior = {c: v['prior'] for c, v in parsed.items() if v['prior'] is not None}
  if prior:
    prev_row: dict = {
      'company_id': company_id,
      'period_type': 'annual',
      'fiscal_year': year - 1,
      'fiscal_quarter': None,
      'period_end_date': f'{year - 1}-12-31',
      'currency': 'KRW',
    }
    for col, val in prior.items():
      prev_row[col] = round(val, 4)
    if len(prev_row) > 6:
      rows.append(prev_row)
  return rows


def _flush_company(
  w,
  cid: str,
  rows: list[dict],
  rename: tuple[str, str] | None,
  collect_result: tuple[str, str | None] | None,
) -> None:
  """단일 회사의 변경사항을 즉시 DB에 반영(중간 종료 시 손실 방지).

  collect_result: (dart_collection_status, last_collect_error)
    - 'success': 정상 수집 (error=None)
    - 'failed' | 'no_match' | 'no_audit_report': 실패 → retry_after를 7일 뒤로 세팅
  """
  if rows:
    deduped: dict[tuple, dict] = {}
    for r in rows:
      key = (r['company_id'], r['fiscal_year'])
      if key not in deduped or len(r) > len(deduped[key]):
        deduped[key] = r
    upsert_rows(
      'financials', list(deduped.values()), 'company_id,period_type,fiscal_year,fiscal_quarter'
    )
  if rename:
    _old, new_name = rename
    w.table('companies').update({'name_kr': new_name, 'name': new_name}).eq('id', cid).execute()
  if collect_result:
    dcs, err = collect_result
    updates: dict = {
      'dart_collection_status': dcs,
      'last_collect_error': err,
    }
    if dcs in ('failed', 'no_match', 'no_audit_report'):
      # 실패는 점진적 backoff: 7일 후 재시도
      updates['retry_after'] = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    else:
      updates['retry_after'] = None
    w.table('companies').update(updates).eq('id', cid).execute()


def collectDartDomestic() -> None:
  """page='domestic' AND status='active' 회사를 수집 대상으로 처리.
  회사별 즉시 flush — 중간 종료해도 진행분 보존. 이미 financials 있는 회사는 skip.
  수집 실패 시 status가 아닌 dart_collection_status에만 기록한다."""
  if not DART_KEY:
    logger.error('DART_API_KEY 없음 (scripts/.env)')
    sys.exit(1)
  odr = _get_dart()
  if not odr:
    sys.exit(1)

  manual = _load_manual_mapping()

  with WriteSession() as w:
    _collect_dart_domestic_in_session(w, odr, manual)


def _collect_dart_domestic_in_session(w, odr, manual: dict[str, str]) -> None:
  resp = (
    w.table('companies')
    .select(
      'id,ticker,name_kr,status,dart_collection_status,retry_after,'
      'company_pages!inner(page)'
    )
    .eq('status', 'active')
    .eq('company_pages.page', 'domestic')
    .execute()
  )
  companies = resp.data or []

  # 이미 annual financials 있는 회사 ID 조회 (재실행 시 skip)
  fin_resp = (
    w.table('financials')
    .select('company_id')
    .eq('period_type', 'annual')
    .execute()
  )
  has_fin: set[str] = {r['company_id'] for r in (fin_resp.data or [])}

  force = _load_force_set()
  if force:
    logger.info(f'FORCE_TICKERS 적용: {force}')

  # 실패 backoff 만료 회사도 재시도 대상 (force와 동급)
  now_iso = datetime.now(timezone.utc).isoformat()
  retry_statuses = {'failed', 'no_match', 'no_audit_report'}
  retry_ids: set[str] = {
    c['id'] for c in companies
    if c.get('dart_collection_status') in retry_statuses
    and (c.get('retry_after') is None or c['retry_after'] < now_iso)
  }
  if retry_ids:
    logger.info(f'재시도 대상(backoff 만료): {len(retry_ids)}개')

  pending = [
    c for c in companies
    if c['id'] not in has_fin
    or c['ticker'] in force
    or c['name_kr'] in force
    or c['id'] in retry_ids
  ]
  logger.info(f'대상 {len(companies)}개 / 미수집 {len(pending)}개 처리 시작')

  years = _target_years()
  total_renames = 0
  total_failed = 0
  total_rows = 0

  for idx, c in enumerate(pending, 1):
    cid: str = c['id']
    ticker: str = c['ticker']
    name: str = c['name_kr']

    try:
      corp_code = _resolve_corp_code(odr, name, ticker, manual)
      if not corp_code:
        logger.warning(f'[{idx}/{len(pending)}] [{ticker}] {name}: DART_NO_MATCH')
        _flush_company(w, cid, [], None, ('no_match', 'DART_NO_MATCH'))
        total_failed += 1
        continue

      new_name = _resolve_corp_name(odr, corp_code)
      rename = None
      if new_name and new_name != name:
        logger.info(f'[{idx}/{len(pending)}] [{ticker}] 회사명 갱신: {name} → {new_name}')
        rename = (name, new_name)

      company_rows: list[dict] = []
      for y in years:
        parsed, src = _collect_year(odr, corp_code, y)
        if not parsed:
          continue
        logger.info(f'[{idx}/{len(pending)}] [{ticker}] {y} via {src}: {list(parsed.keys())}')
        company_rows.extend(_build_rows(cid, y, parsed))

      if not company_rows:
        logger.warning(
          f'[{idx}/{len(pending)}] [{ticker}] {name}({corp_code}): NO_AUDIT_REPORT'
        )
        _flush_company(w, cid, [], rename, ('no_audit_report', 'NO_AUDIT_REPORT'))
        total_failed += 1
        if rename:
          total_renames += 1
        continue

      _flush_company(w, cid, company_rows, rename, ('success', None))
      total_rows += len(company_rows)
      if rename:
        total_renames += 1
    except Exception as e:
      # 한 회사의 실패가 전체 종료를 일으키지 않도록 — 다음 회사로 진행
      logger.error(f'[{idx}/{len(pending)}] [{ticker}] {name}: 처리 중 예외 ({type(e).__name__}: {e}) — skip')
      continue

  logger.info(
    f'요약: 처리 {len(pending)} / 갱신 {total_renames} / failed {total_failed} / financials {total_rows}'
  )
  # WriteSession.__exit__이 자동으로 revalidate_for_tables(['companies', 'financials'])를 호출한다.


if __name__ == '__main__':
  try:
    collectDartDomestic()
  except Exception as e:
    logger.error(f'DART domestic 수집 실패: {e}')
    sys.exit(1)
