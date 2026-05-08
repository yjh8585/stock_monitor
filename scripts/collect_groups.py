#!/usr/bin/env python3
"""
companies.group_name 자동 매핑.

전략 (신뢰도 순):
  1. 시드 매핑 (groups_seed.json) — ★★★ 즉시 적용
  2. DART 최대주주 공유 — ★★ 같은 법인이 최대주주인 회사들을 후보 그룹으로 묶음
     ※ 1번 시드 그룹에 속한 회사가 한 명이라도 있으면 그 그룹명 채택
  3. 추론 실패 → groups_review.json (수동 검토) + group_name=NULL 유지

대상: page='domestic' AND status='active' 회사.
"""
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv, dotenv_values
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client
from collect_dart_audit import _get_dart

DART_KEY = (
  dotenv_values(Path(__file__).parent / '.env').get('DART_API_KEY', '')
  or os.environ.get('DART_API_KEY', '')
)

SEED_PATH = Path(__file__).parent / 'lib' / 'groups_seed.json'
MANUAL_PATH = Path(__file__).parent / 'lib' / 'manual_dart_mapping.json'
REVIEW_PATH = Path(__file__).resolve().parents[1] / '참고' / 'domestic_sources' / 'groups_review.json'


def _normalize(s: str | None) -> str:
  if not s:
    return ''
  return re.sub(r'[\s㈜()유주재]', '', s).strip()


def _load_seed() -> dict[str, list[str]]:
  raw = json.loads(SEED_PATH.read_text(encoding='utf-8'))
  return {k: v for k, v in raw.items() if not k.startswith('_')}


def _load_manual_mapping() -> dict[str, str]:
  if not MANUAL_PATH.exists():
    return {}
  raw = json.loads(MANUAL_PATH.read_text(encoding='utf-8'))
  return {k: v for k, v in raw.items() if not k.startswith('_')}


def _major_holder_legal(odr, corp_code: str) -> str | None:
  """최대주주가 법인이면 그 법인명 반환."""
  try:
    df = odr.major_shareholders(corp_code)
  except Exception as e:
    logger.debug(f'major_shareholders({corp_code}) 실패: {e}')
    return None
  if df is None or len(df) == 0:
    return None
  # 첫 행이 통상 최대주주. nm 필드에 법인명 또는 개인명.
  row = df.iloc[0]
  nm = str(row.get('nm') or row.get('investor_name') or '').strip()
  rate_raw = row.get('trmend_posesn_stock_qota_rt') or row.get('rate', '')
  if not nm:
    return None
  # 개인 휴리스틱: 2~3자 한글 + 주소 없음 → 보통 개인. 법인은 '주식회사', '(주)', 'CO', 'Holdings' 등 단서.
  if re.search(r'(주식회사|\(주\)|㈜|Holdings|Group|CO\.|Inc\.|Ltd\.|코퍼레이션)', nm):
    return nm
  # 한글 4자 이상 + '그룹' 또는 '홀딩스' 포함 시 법인
  if len(nm) >= 4 and any(k in nm for k in ['그룹', '홀딩스', '인베스트', '캐피탈', '인터내셔널']):
    return nm
  return None


def main() -> None:
  client = get_client()
  seed = _load_seed()
  manual = _load_manual_mapping()

  # name_kr / ticker → group_name 룩업 테이블 빌드
  seed_lookup: dict[str, str] = {}
  for grp, members in seed.items():
    for m in members:
      seed_lookup[m] = grp
      seed_lookup[_normalize(m)] = grp

  # 대상 회사 조회
  resp = (
    client.table('companies')
    .select('id,ticker,name_kr,group_name,company_pages!inner(page)')
    .eq('status', 'active')
    .eq('company_pages.page', 'domestic')
    .execute()
  )
  companies = resp.data or []
  logger.info(f'그룹 매핑 대상: {len(companies)}개')

  applied: list[tuple[str, str, str]] = []  # (ticker, group, source)
  pending: list[dict] = []  # 시드 미매핑 (DART 대상)

  # 1. 시드 매핑 적용
  for c in companies:
    cid = c['id']
    ticker = c['ticker']
    name = c['name_kr']
    grp = (
      seed_lookup.get(ticker)
      or seed_lookup.get(name)
      or seed_lookup.get(_normalize(name))
    )
    if grp:
      client.table('companies').update({'group_name': grp}).eq('id', cid).execute()
      applied.append((ticker, grp, 'seed'))
      continue
    pending.append({'id': cid, 'ticker': ticker, 'name_kr': name})
  logger.info(f'시드 적용: {len(applied)}개 / 시드 미매핑: {len(pending)}개')

  # 2. DART 최대주주 자동 추론
  if DART_KEY and pending:
    odr = _get_dart()
    if odr:
      # corp_code 매칭 (find_corp_code + manual 폴백)
      holder_to_companies: dict[str, list[dict]] = defaultdict(list)
      for c in pending:
        try:
          code = odr.find_corp_code(c['name_kr']) or manual.get(c['ticker']) or manual.get(c['name_kr'])
        except Exception:
          code = manual.get(c['ticker']) or manual.get(c['name_kr'])
        if not code:
          continue
        holder = _major_holder_legal(odr, str(code))
        if holder:
          holder_to_companies[holder].append(c)

      # 최대주주 법인이 시드 그룹 멤버이면 그 그룹으로 자동 매핑
      for holder, members in holder_to_companies.items():
        grp = (
          seed_lookup.get(holder)
          or seed_lookup.get(_normalize(holder))
        )
        if grp:
          for m in members:
            client.table('companies').update({'group_name': grp}).eq('id', m['id']).execute()
            applied.append((m['ticker'], grp, f'major_holder:{holder}'))
            pending = [p for p in pending if p['id'] != m['id']]
        elif len(members) >= 2:
          # 같은 최대주주를 가진 회사가 2+ → 신규 후보 그룹
          # 기본 그룹명 = 최대주주 법인명에서 핵심 토큰 추출
          base = re.sub(r'(주식회사|\(주\)|㈜|Holdings|Group|Co\.|Inc\.|Ltd\.|홀딩스|그룹)', '', holder).strip()
          if not base:
            continue
          for m in members:
            client.table('companies').update({'group_name': base}).eq('id', m['id']).execute()
            applied.append((m['ticker'], base, f'major_holder_inferred:{holder}'))
            pending = [p for p in pending if p['id'] != m['id']]

  # 3. 잔여 → review.json
  REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
  REVIEW_PATH.write_text(
    json.dumps(pending, ensure_ascii=False, indent=2),
    encoding='utf-8',
  )

  # 요약
  by_source: dict[str, int] = defaultdict(int)
  for _, _, s in applied:
    by_source[s.split(':', 1)[0]] += 1
  logger.info('=== 그룹 매핑 결과 ===')
  for s, n in sorted(by_source.items(), key=lambda kv: -kv[1]):
    logger.info(f'  {s}: {n}건')
  logger.info(f'  미매핑(review): {len(pending)}건')


if __name__ == '__main__':
  try:
    main()
  except Exception as e:
    logger.error(f'그룹 매핑 실패: {e}')
    sys.exit(1)
