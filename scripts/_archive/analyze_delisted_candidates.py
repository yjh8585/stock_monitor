"""
status='hidden'(과거 'delisted')으로 분류된 회사 중 실제 활동 흔적이 있는 의심 후보를
JSON으로 덤프한다.

read-only 분석 전용 — 어떤 row도 UPDATE/DELETE 하지 않는다.
자동 복원/수정은 금지. 결과 JSON은 사람이 검토 후 수동 결정의 근거로만 사용한다.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client

# batch select 시 한 번에 IN으로 넘길 id 수 (postgrest URL 길이 한계 회피)
BATCH_SIZE = 200
# news 최근성 기준
NEWS_LOOKBACK_DAYS = 180
OUTPUT_PATH = Path(__file__).parent / '_delisted_candidates.json'


def _count_by_company(
  table: str,
  ids: list[str],
  *,
  extra_filter: tuple[str, str, str] | None = None,
) -> dict[str, int]:
  """대상 회사 id 목록에 대해 table의 row 수를 회사별로 집계.

  postgrest count는 쿼리 1회당 1개 회사만 합산하므로, id별 row 데이터를 가져와
  파이썬에서 카운트한다(데이터량 적은 분석 스크립트에서는 충분히 빠르다).
  """
  client = get_client()
  counts: dict[str, int] = {cid: 0 for cid in ids}
  if not ids:
    return counts

  for i in range(0, len(ids), BATCH_SIZE):
    chunk = ids[i:i + BATCH_SIZE]
    try:
      q = client.table(table).select('company_id').in_('company_id', chunk)
      if extra_filter:
        col, op, val = extra_filter
        q = q.filter(col, op, val)
      res = q.execute()
      for r in res.data or []:
        cid = r.get('company_id')
        if cid in counts:
          counts[cid] += 1
    except Exception as e:
      logger.error(f'{table} 집계 실패 (chunk {i}~{i + BATCH_SIZE}): {e}')
  return counts


def _count_financials_by_type(ids: list[str]) -> dict[str, dict[str, int]]:
  """company_id × period_type 별 financials row 수."""
  client = get_client()
  result: dict[str, dict[str, int]] = {cid: {} for cid in ids}
  if not ids:
    return result

  for i in range(0, len(ids), BATCH_SIZE):
    chunk = ids[i:i + BATCH_SIZE]
    try:
      res = (
        client.table('financials')
        .select('company_id,period_type')
        .in_('company_id', chunk)
        .execute()
      )
      for r in res.data or []:
        cid = r.get('company_id')
        pt = r.get('period_type') or 'unknown'
        if cid not in result:
          continue
        result[cid][pt] = result[cid].get(pt, 0) + 1
    except Exception as e:
      logger.error(f'financials 집계 실패 (chunk {i}~{i + BATCH_SIZE}): {e}')
  return result


def _count_pages_by_company(ids: list[str]) -> dict[str, int]:
  """company_pages 매핑 수 (page 종류 무관)."""
  return _count_by_company('company_pages', ids)


def analyzeDelistedCandidates() -> None:
  """delisted 회사 전수 조회 → 활동 흔적 있는 회사를 JSON으로 덤프."""
  client = get_client()
  logger.info('delisted 회사 조회 시작')

  resp = (
    client.table('companies')
    .select('id,ticker,name_kr,dart_collection_status,last_collect_error,updated_at')
    .eq('status', 'hidden')
    .execute()
  )
  delisted = resp.data or []
  total = len(delisted)
  logger.info(f'delisted 회사 {total}개 발견')
  if not delisted:
    _write_output(total, [])
    return

  ids = [c['id'] for c in delisted]

  # news는 최근 NEWS_LOOKBACK_DAYS 기간만 카운트 (오래된 잔여 데이터 제외)
  since = (datetime.now(timezone.utc) - timedelta(days=NEWS_LOOKBACK_DAYS)).isoformat()

  logger.info('financials 집계')
  fin_counts = _count_financials_by_type(ids)
  logger.info(f'news 집계 (최근 {NEWS_LOOKBACK_DAYS}일)')
  news_counts = _count_by_company('news', ids, extra_filter=('published_at', 'gte', since))
  logger.info('stock_prices 집계')
  price_counts = _count_by_company('stock_prices', ids)
  logger.info('company_pages 집계')
  page_counts = _count_pages_by_company(ids)

  suspicious: list[dict] = []
  for c in delisted:
    cid = c['id']
    fin_total = sum(fin_counts.get(cid, {}).values())
    news_n = news_counts.get(cid, 0)
    price_n = price_counts.get(cid, 0)
    page_n = page_counts.get(cid, 0)
    if fin_total == 0 and news_n == 0 and price_n == 0 and page_n == 0:
      continue
    suspicious.append({
      'id': cid,
      'ticker': c.get('ticker'),
      'name_kr': c.get('name_kr'),
      'dart_collection_status': c.get('dart_collection_status'),
      'last_collect_error': c.get('last_collect_error'),
      'updated_at': c.get('updated_at'),
      'counts': {
        'financials': fin_total,
        'financials_by_type': fin_counts.get(cid, {}),
        'news': news_n,
        'stock_prices': price_n,
        'pages': page_n,
      },
      'suggestion': "수동 검토 후 status='active'로 복원 또는 status='hidden' 유지 결정",
    })

  _write_output(total, suspicious)


def _write_output(total: int, suspicious: list[dict]) -> None:
  """결과를 JSON 파일로 저장하고 콘솔 요약을 출력한다."""
  payload = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'total_delisted': total,
    'suspicious': suspicious,
  }
  OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
  logger.info(f'의심 회사 {len(suspicious)}개 발견 (전체 delisted {total}개)')
  logger.info(f'출력 경로: {OUTPUT_PATH}')


def main() -> None:
  if 'SUPABASE_URL' not in os.environ or 'SUPABASE_SERVICE_ROLE_KEY' not in os.environ:
    logger.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 없음')
    sys.exit(1)
  try:
    analyzeDelistedCandidates()
  except Exception as e:
    logger.error(f'분석 실패: {e}')
    sys.exit(1)


if __name__ == '__main__':
  main()
