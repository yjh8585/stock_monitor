"""
delisted 의심 후보(_delisted_candidates.json)를 active companies와 매칭해
이미 active 회사로 존재하는 회사를 식별한다 (backfill 시 중복 위험 회피).

read-only. 출력: review/delisted_backfill_recheck_YYYYMMDD.md
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client

CANDIDATES_PATH = ROOT / '_delisted_candidates.json'
OUTPUT_PATH = ROOT.parent / 'review' / f'delisted_backfill_recheck_{datetime.now(timezone.utc).strftime("%Y%m%d")}.md'

# 사용자 제공 명시 매핑 (delisted 이름 → active 이름)
# 자동 정규화로 잡히지 않는 한글-영문 음차/이름 변경/합병 케이스
EXPLICIT_MAPPING: dict[str, str] = {
  '만도': 'HL만도',
  'SL': '에스엘',
  '한국델파이': '한세모빌리티',
  '디엠씨': '다산디엠씨',  # 디엠씨가 다산디엠씨에 합병
}

# 도메인 정책: 한국 자회사/공장은 본사와 별도 row 로 추적.
# substring 매칭 결과는 단순 부분일치라 false positive 가능 → 자동 backfill 제외 대상으로 인정하지 않는다.
# (explicit 매핑만 backfill 금지로 확정.)
SUBSTRING_MATCH_BLOCKS_BACKFILL = False


def normalize(s: str) -> str:
  """공백·특수문자·법인격 표기를 제거한 정규화 문자열."""
  if not s:
    return ''
  s = re.sub(r'주식회사|㈜|\(주\)|\(유\)|\(株\)|\s+|\.|·', '', s)
  return s.strip().lower()


def find_active_match(
  delisted_name: str,
  active_companies: list[dict],
  active_by_norm: dict[str, list[dict]],
) -> dict | None:
  """delisted 회사명에 매칭되는 active 회사를 1개 반환. 우선순위:
     (1) 명시 매핑 (2) 완전 일치 (3) 부분일치(양방향) — substring match 1건만 인정."""
  # (1) 명시 매핑
  if delisted_name in EXPLICIT_MAPPING:
    target_name = EXPLICIT_MAPPING[delisted_name]
    for c in active_companies:
      if c['name_kr'] == target_name:
        return {**c, 'match_type': 'explicit'}

  # (2) 완전 정규화 일치
  dn = normalize(delisted_name)
  if not dn:
    return None
  if dn in active_by_norm:
    cands = active_by_norm[dn]
    if len(cands) == 1:
      return {**cands[0], 'match_type': 'exact_normalized'}

  # (3) 부분일치 (대상 회사명이 active 회사명에 포함 OR 그 반대) — 한 건만 매칭될 때 인정
  substring_hits: list[dict] = []
  for c in active_companies:
    an = normalize(c['name_kr'])
    if not an:
      continue
    if an == dn:
      continue  # 이미 (2)에서 처리
    # 짧은 쪽이 긴 쪽에 포함되는지. 너무 짧은 매칭(2자 이하)은 false positive 방지로 제외
    short, long = (dn, an) if len(dn) <= len(an) else (an, dn)
    if len(short) >= 3 and short in long:
      substring_hits.append(c)

  if len(substring_hits) == 1:
    return {**substring_hits[0], 'match_type': 'substring'}
  return None


def main() -> None:
  if not CANDIDATES_PATH.exists():
    logger.error(f'{CANDIDATES_PATH} 가 없습니다. 먼저 analyze_delisted_candidates.py 실행')
    sys.exit(1)

  candidates = json.loads(CANDIDATES_PATH.read_text(encoding='utf-8'))
  suspicious = candidates['suspicious']
  logger.info(f'재점검 대상: {len(suspicious)}개')

  client = get_client()
  active_resp = client.table('companies').select('id,ticker,name_kr').eq('status', 'active').execute()
  active_companies = active_resp.data or []
  logger.info(f'active companies: {len(active_companies)}개')

  active_by_norm: dict[str, list[dict]] = {}
  for c in active_companies:
    n = normalize(c['name_kr'])
    if n:
      active_by_norm.setdefault(n, []).append(c)

  results: list[dict] = []
  for s in suspicious:
    match = find_active_match(s['name_kr'], active_companies, active_by_norm)
    results.append({**s, '_match': match})

  # backfill 금지 = explicit/exact_normalized 매칭만. substring 은 참고용으로만 표시.
  def _blocks(m: dict | None) -> bool:
    if m is None:
      return False
    if m['match_type'] == 'substring' and not SUBSTRING_MATCH_BLOCKS_BACKFILL:
      return False
    return True

  blocked = [r for r in results if _blocks(r['_match'])]
  substring_review = [
    r for r in results
    if r['_match'] and r['_match']['match_type'] == 'substring' and not SUBSTRING_MATCH_BLOCKS_BACKFILL
  ]
  backfill = [r for r in results if not _blocks(r['_match'])]
  logger.info(f'backfill 금지 (explicit/exact): {len(blocked)}개')
  logger.info(f'substring 참고 (backfill 후보로 포함): {len(substring_review)}개')
  logger.info(f'backfill 후보 합계: {len(backfill)}개')

  # 마크다운 생성
  lines: list[str] = []
  lines.append(f'# delisted backfill 재점검 결과 ({datetime.now(timezone.utc).date()})')
  lines.append('')
  lines.append(f'- 의심 후보(전): {len(suspicious)}개')
  lines.append(f'- backfill 금지(explicit/exact 매칭): **{len(blocked)}개**')
  lines.append(f'- backfill 후보 합계: **{len(backfill)}개**')
  lines.append(f'  - 그 중 substring 매칭 참고(자회사/공장 별도 추적): {len(substring_review)}개')
  lines.append('')
  lines.append('## 매칭 방식')
  lines.append('1. **explicit** — 사용자 제공 명시 매핑')
  lines.append('2. **exact_normalized** — 공백·법인격 표기 제거 후 완전 일치')
  lines.append('3. **substring** — 3자 이상 부분일치. 도메인 정책상 한국 자회사/공장은 본사와 별도 row로 추적하므로 backfill 후보에 포함.')
  lines.append('')
  lines.append('## ⚠️ backfill 금지 — 이미 active 회사로 존재 (explicit/exact 매칭)')
  lines.append('')
  lines.append('이 회사들은 합병·사명변경·중복 등록이므로 단순 backfill 금지.')
  lines.append('데이터가 양쪽에 분리되어 있으면 `merge_company(old_id, new_id)` RPC 호출로 통합 검토.')
  lines.append('')
  lines.append('| # | delisted ticker | delisted 이름 | → active ticker | active 이름 | 매칭 방식 | financials |')
  lines.append('|---|---|---|---|---|---|---:|')
  for i, r in enumerate(sorted(blocked, key=lambda x: -x['counts']['financials']), 1):
    m = r['_match']
    lines.append(
      f'| {i} | {r["ticker"]} | {r["name_kr"]} | {m["ticker"]} | {m["name_kr"]} | {m["match_type"]} | {r["counts"]["financials"]} |'
    )
  lines.append('')
  if substring_review:
    lines.append('## 🔎 substring 참고 — backfill 후보에 포함되지만 본사 row와 이름이 비슷')
    lines.append('')
    lines.append('도메인 정책상 한국 자회사/공장도 별도 추적. backfill 진행하되 참고용으로 본사 매칭 정보 표시.')
    lines.append('')
    lines.append('| # | delisted ticker | delisted 이름 | 본사 ticker | 본사 이름 | financials |')
    lines.append('|---|---|---|---|---|---:|')
    for i, r in enumerate(sorted(substring_review, key=lambda x: -x['counts']['financials']), 1):
      m = r['_match']
      lines.append(
        f'| {i} | {r["ticker"]} | {r["name_kr"]} | {m["ticker"]} | {m["name_kr"]} | {r["counts"]["financials"]} |'
      )
    lines.append('')
  lines.append('## ✅ backfill 후보 (전체)')
  lines.append('')
  lines.append('| # | ticker | name_kr | financials | news | stock_prices | pages | 비고 |')
  lines.append('|---|---|---|---:|---:|---:|---:|---|')
  for i, r in enumerate(sorted(backfill, key=lambda x: -x['counts']['financials']), 1):
    c = r['counts']
    note = ''
    if r['_match'] and r['_match']['match_type'] == 'substring':
      note = f'본사 후보: {r["_match"]["name_kr"]}'
    lines.append(
      f'| {i} | {r["ticker"]} | {r["name_kr"]} | {c["financials"]} | {c["news"]} | {c["stock_prices"]} | {c["pages"]} | {note} |'
    )
  lines.append('')
  lines.append('## backfill ticker 리스트 (복사용)')
  lines.append('')
  lines.append('```json')
  lines.append(json.dumps(
    {'tickers': sorted([r['ticker'] for r in backfill]),
     'reason': f'DART 매칭 실패로 잘못 분류된 회사 복원 — 합병·사명변경된 {len(blocked)}개 제외 ({datetime.now(timezone.utc).date()})'},
    ensure_ascii=False, indent=2,
  ))
  lines.append('```')

  OUTPUT_PATH.parent.mkdir(exist_ok=True)
  OUTPUT_PATH.write_text('\n'.join(lines), encoding='utf-8')
  logger.info(f'출력: {OUTPUT_PATH}')


if __name__ == '__main__':
  main()
