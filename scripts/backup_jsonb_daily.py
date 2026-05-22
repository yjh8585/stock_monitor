"""Supabase Free 플랜 자동 백업 (PITR 대체).

매일 02:00 KST에 핵심 테이블 전체를 JSON으로 dump → gzip → data/backups/YYYY-MM-DD/에 저장.
GitHub Actions가 commit/push까지 처리.

대상 테이블 (실시간성·복구 가치 기준):
  - companies (회사 메타 + customers + products + business_summary)
  - financials (분기/연간 재무)
  - news (회사별 뉴스 메타)
  - company_pages (회사-페이지 매핑)
  - pnl_entries (경영관리 손익)
  - market_series_daily (매크로 시계열 일별)

복구 예시:
  gunzip -c data/backups/2026-05-22/companies.json.gz | jq '.[0]'
  # 또는 psql + COPY로 일괄 복구

Rotation: 30일 이전 백업 디렉토리는 GHA workflow에서 삭제.
"""
import gzip
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / 'scripts' / '.env')
load_dotenv(ROOT / '.env.local')

sys.path.insert(0, str(ROOT / 'scripts'))
from lib.db import get_client  # noqa: E402

TABLES = [
  'companies',
  'financials',
  'news',
  'company_pages',
  'pnl_entries',
  'market_series_daily',
]

# 백업 디렉토리: KST 기준 날짜 (UTC+9)
KST = timezone(timedelta(hours=9))
BACKUP_DATE = datetime.now(KST).strftime('%Y-%m-%d')
BACKUP_DIR = ROOT / 'data' / 'backups' / BACKUP_DATE


def _dump_table(client, table: str) -> dict:
  """테이블 전체 SELECT * → JSON 직렬화 가능 list[dict]."""
  rows: list[dict] = []
  page = 1000
  offset = 0
  while True:
    resp = client.table(table).select('*').range(offset, offset + page - 1).execute()
    batch = resp.data or []
    if not batch:
      break
    rows.extend(batch)
    if len(batch) < page:
      break
    offset += page
  return rows


def main() -> int:
  BACKUP_DIR.mkdir(parents=True, exist_ok=True)
  client = get_client()
  summary: dict[str, int] = {}
  total_bytes = 0

  for table in TABLES:
    try:
      rows = _dump_table(client, table)
    except Exception as e:
      logger.error(f'{table} dump 실패: {e}')
      continue
    out = BACKUP_DIR / f'{table}.json.gz'
    raw = json.dumps(rows, ensure_ascii=False, default=str).encode('utf-8')
    with gzip.open(out, 'wb', compresslevel=9) as f:
      f.write(raw)
    sz = out.stat().st_size
    total_bytes += sz
    summary[table] = len(rows)
    logger.info(f'  {table}: {len(rows)}행 → {out.relative_to(ROOT)} ({sz/1024:.1f} KB)')

  # 요약 메타 파일 (커밋 메시지/diff 추적용)
  meta = {
    'backup_date_kst': BACKUP_DATE,
    'generated_at_utc': datetime.now(timezone.utc).isoformat(),
    'tables': summary,
    'total_compressed_bytes': total_bytes,
  }
  (BACKUP_DIR / 'manifest.json').write_text(
    json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8'
  )
  logger.info(f'백업 완료: {BACKUP_DIR.relative_to(ROOT)} (총 {total_bytes/1024:.1f} KB)')
  return 0


if __name__ == '__main__':
  sys.exit(main())
