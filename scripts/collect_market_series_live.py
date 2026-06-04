#!/usr/bin/env python3
"""
지수·원자재·코인 현재가를 yfinance에서 수집해 market_series_live 테이블을 갱신한다.
대상: market_series에서 yf_symbol이 있고 미국 국채(UST10Y/UST30Y)가 아닌 시리즈.
일봉(market_series_daily) 차트 끝점을 매시 라이브 값으로 갈아치우기 위한 보조 데이터.
"""
import sys
from datetime import datetime, timezone

import yfinance as yf
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import get_client, WriteSession  # noqa: E402

# 미국 국채는 라이브 대상에서 제외 (사용자 정책)
EXCLUDED = {'UST10Y', 'UST30Y'}


def collectMarketSeriesLive() -> None:
  client = get_client()
  meta = client.table('market_series').select('series_code, yf_symbol').execute().data or []
  targets = [m for m in meta if m.get('yf_symbol') and m['series_code'] not in EXCLUDED]
  if not targets:
    logger.warning('라이브 수집 대상 없음 (market_series.yf_symbol 확인)')
    return

  now_iso = datetime.now(timezone.utc).isoformat()
  rows: list[dict] = []
  for m in targets:
    code, symbol = m['series_code'], m['yf_symbol']
    try:
      price = yf.Ticker(symbol).fast_info.last_price
      if price is None:
        logger.warning(f'{code}({symbol}): last_price 없음, 스킵')
        continue
      rows.append({'series_code': code, 'price': float(price), 'updated_at': now_iso})
    except Exception as e:
      logger.error(f'{code}({symbol}) 현재가 수집 실패: {e}')

  if not rows:
    logger.warning('수집된 라이브 데이터 없음')
    return

  # WriteSession이 __exit__에서 revalidate_for_tables(['market_series_live'])를 자동 호출.
  with WriteSession() as w:
    w.table('market_series_live').upsert(rows, on_conflict='series_code').execute()
  logger.info(f'지수·원자재 라이브 갱신 완료 — {len(rows)}개 시리즈')


if __name__ == '__main__':
  try:
    collectMarketSeriesLive()
  except Exception as e:
    logger.error(f'지수·원자재 라이브 수집 실패: {e}')
    sys.exit(1)
