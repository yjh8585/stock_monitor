#!/usr/bin/env python3
"""
companies.json을 읽어 Supabase companies 테이블에 upsert하는 시드 스크립트.
이미 있는 행은 ticker 기준으로 업데이트하지 않음 (on_conflict: ignore).
"""
import json
import sys
from pathlib import Path
from dotenv import load_dotenv
from loguru import logger
from lib.db import get_client

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

COMPANIES_JSON = Path(__file__).parent / 'lib' / 'companies.json'


def seedCompanies() -> None:
  """companies.json 데이터를 DB에 삽입한다."""
  companies = json.loads(COMPANIES_JSON.read_text(encoding='utf-8'))
  client = get_client()

  result = (
    client.table('companies')
    .upsert(companies, on_conflict='ticker', ignore_duplicates=True)
    .execute()
  )
  logger.info(f"시드 완료: {len(companies)}개사 처리")
  return result


if __name__ == '__main__':
  try:
    seedCompanies()
  except Exception as e:
    logger.error(f"시드 실패: {e}")
    sys.exit(1)
