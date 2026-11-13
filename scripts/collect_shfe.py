#!/usr/bin/env python3
"""
중국 선물 가격 수집기 — SHFE(상하이선물거래소) 품목별 주력월물 일별 결산가, CNY/t.

- 대상: 열연강판 `HRC_CN`(hc) · 알루미늄 `ALU_CN`(al). 같은 날 파일 하나에서 둘 다 읽는다.
- 원천: 거래소가 공개하는 일별 시세 JSON(`kx{YYYYMMDD}.dat`). 휴장일은 404 HTML 을 준다.
- 주력월물 = 그날 미결제약정(OPENINTEREST)이 가장 큰 월물. 월물이 바뀌는 날 값이 살짝 뛸 수 있다.
- 중국 국내 선물가는 증치세(13%) 포함 가격이다. DB 에는 그대로 저장하고 세금 제외·달러 환산은
  화면(lib/commodityUnits.ts)에서 한다.
- 기본 실행은 최근 10일을 본다. `--backfill-years N` 은 어느 한 품목이라도 DB 에 없는 평일만 연다(로컬 1회용).
- 형식은 2021-01-04 파일부터 같다(2026-11-09 실측).
- 2026-11-09 `collect_shfe_hrc.py` 에서 이름을 바꿨다(알루미늄 추가 · 사용자 선택).
"""
import argparse
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import upsert_rows
from lib.market_series import existing_trade_dates
from lib.retry import with_retry
from lib.series_sources import SHFE_ALU_PRODUCT, SHFE_DAILY_URL, SHFE_HRC_PRODUCT, USER_AGENT

# (series_code, SHFE 품목 코드)
PRODUCTS = [('HRC_CN', SHFE_HRC_PRODUCT), ('ALU_CN', SHFE_ALU_PRODUCT)]
DEFAULT_LOOKBACK_DAYS = 10
SHFE_REQUEST_SLEEP_SEC = 1.0  # 정적 파일이지만 연달아 받으면 끊긴다(아래 COOLDOWN 주석) · 5년 ≈ 1,300건 ≈ 22분
SHFE_RETRY_BACKOFF_SEC = 5.0  # 재시도 대기 5s → 10s (기본 2s → 4s 로는 끊긴 상태가 안 풀렸다)
# 🔴 2026-11-10·11-12 GHA 실패: 앞쪽 며칠은 받다가 어느 순간부터 남은 날이 전부 `Connection reset by peer`
# (재시도 4초 뒤에도 그대로 · 다음 날 실행은 같은 날짜를 다 받았다). 그래서 실패한 날만 모아 1분 쉰 뒤 한 번 더 연다.
# 두 번째에도 실패하면 진짜 차단·장애로 보고 그대로 exit 1.
SHFE_COOLDOWN_SEC = 60
FLUSH_EVERY = 100

# 🔴 파서 자가 시험 — 2026-11-06 실제 파일의 행 일부. 품목마다 미결제약정 최대 «월물»의 결산가를 골라야 한다.
# 소계 행은 미결제약정이 더 크고 값도 숫자로 넣어 둔다 — 월물 거르기를 지우면 3300·23500 이 나와 걸린다.
# 'ao'(산화알루미늄)는 미결제약정이 크지만 알루미늄이 아니다 — 품목 거르기를 지우면 2644 가 나와 걸린다.
_SAMPLE = {'o_curinstrument': [
  {'PRODUCTGROUPID': 'hc      ', 'DELIVERYMONTH': '2612', 'SETTLEMENTPRICE': 3190, 'OPENINTEREST': 120000},
  {'PRODUCTGROUPID': 'hc      ', 'DELIVERYMONTH': '2701', 'SETTLEMENTPRICE': 3206, 'OPENINTEREST': 1611519},
  {'PRODUCTGROUPID': 'hc      ', 'DELIVERYMONTH': '小计', 'SETTLEMENTPRICE': 3300, 'OPENINTEREST': 2232419},
  {'PRODUCTGROUPID': 'rb      ', 'DELIVERYMONTH': '2701', 'SETTLEMENTPRICE': 3041, 'OPENINTEREST': 1681929},
  {'PRODUCTGROUPID': 'al      ', 'DELIVERYMONTH': '2612', 'SETTLEMENTPRICE': 23080, 'OPENINTEREST': 227071},
  {'PRODUCTGROUPID': 'al      ', 'DELIVERYMONTH': '2701', 'SETTLEMENTPRICE': 22875, 'OPENINTEREST': 200907},
  {'PRODUCTGROUPID': 'al      ', 'DELIVERYMONTH': '小计', 'SETTLEMENTPRICE': 23500, 'OPENINTEREST': 680051},
  {'PRODUCTGROUPID': 'ao      ', 'DELIVERYMONTH': '2701', 'SETTLEMENTPRICE': 2644, 'OPENINTEREST': 9216155},
]}
# 주력월물의 결산가가 비면(장중) 다른 월물로 대신하지 말고 None 이어야 한다.
_SAMPLE_INTRADAY = {'o_curinstrument': [
  {'PRODUCTGROUPID': 'hc      ', 'DELIVERYMONTH': '2612', 'SETTLEMENTPRICE': 3190, 'OPENINTEREST': 120000},
  {'PRODUCTGROUPID': 'hc      ', 'DELIVERYMONTH': '2701', 'SETTLEMENTPRICE': '', 'OPENINTEREST': 1611519},
]}


def pickMainSettlement(body: dict, product: str) -> float | None:
  """product 월물 중 미결제약정 최대인 것의 결산가. 소계 행은 버리고, 주력월물 결산가가 비면 None."""
  main: tuple[int, object] | None = None
  for r in body.get('o_curinstrument') or []:
    if str(r.get('PRODUCTGROUPID', '')).strip() != product:
      continue
    if not str(r.get('DELIVERYMONTH', '')).isdigit():
      continue  # '小计'(소계)·'总计' 행
    oi = r.get('OPENINTEREST')
    if isinstance(oi, int) and (main is None or oi > main[0]):
      main = (oi, r.get('SETTLEMENTPRICE'))
  if main is None:
    return None
  settle = main[1]
  return float(settle) if isinstance(settle, (int, float)) and settle > 0 else None


def _selfTest() -> None:
  got = (
    pickMainSettlement(_SAMPLE, SHFE_HRC_PRODUCT),
    pickMainSettlement(_SAMPLE, SHFE_ALU_PRODUCT),
    pickMainSettlement(_SAMPLE_INTRADAY, SHFE_HRC_PRODUCT),
  )
  if got != (3206.0, 23080.0, None):
    logger.error(f"SHFE 파서 자가 시험 실패 — 기대 (3206.0, 23080.0, None), 실제 {got}")
    sys.exit(2)


def _fetchDay(ymd: str) -> dict | None:
  """그날 JSON. 휴장일(404)이면 None. 그 밖의 오류는 raise."""
  resp = requests.get(SHFE_DAILY_URL.format(ymd=ymd), headers={'User-Agent': USER_AGENT}, timeout=30)
  if resp.status_code == 404:
    return None
  resp.raise_for_status()
  return resp.json()


def _weekdays(start: date, end: date) -> list[date]:
  days, d = [], start
  while d <= end:
    if d.weekday() < 5:
      days.append(d)
    d += timedelta(days=1)
  return days


def collect(backfill_years: int) -> None:
  _selfTest()
  today = date.today()
  if backfill_years:
    start = today - timedelta(days=365 * backfill_years)
    existing = {code: existing_trade_dates(code) for code, _ in PRODUCTS}
  else:
    start = today - timedelta(days=DEFAULT_LOOKBACK_DAYS)
    existing = {code: set() for code, _ in PRODUCTS}
  targets = [d for d in _weekdays(start, today) if not all(d.isoformat() in existing[c] for c, _ in PRODUCTS)]
  logger.info(f"SHFE 수집 시작 — {start} ~ {today} 평일 중 {len(targets)}일 조회")

  pending: list[dict] = []
  loaded = {code: 0 for code, _ in PRODUCTS}
  missing = {code: 0 for code, _ in PRODUCTS}
  holidays = 0

  def flush() -> None:
    nonlocal pending
    upsert_rows('market_series_daily', pending, 'series_code,trade_date')
    for r in pending:
      loaded[r['series_code']] += 1
    pending = []

  def handle(d: date) -> bool:
    """하루치를 받아 pending 에 쌓는다. 조회 오류면 False(다시 열 대상)."""
    nonlocal holidays
    ymd = d.strftime('%Y%m%d')
    try:
      body = with_retry(_fetchDay, ymd, _label=f'SHFE {ymd}', _backoff=SHFE_RETRY_BACKOFF_SEC)
    except Exception as e:
      logger.warning(f"SHFE: {ymd} 조회 실패 — {e}")
      return False
    finally:
      time.sleep(SHFE_REQUEST_SLEEP_SEC)
    if body is None:
      holidays += 1
      return True
    for code, product in PRODUCTS:
      if d.isoformat() in existing[code]:
        continue
      price = pickMainSettlement(body, product)
      if price is None and d == today:
        continue  # 장중에는 파일이 있어도 결산가가 비어 있다 — 다음 실행이 받는다
      if price is None:
        missing[code] += 1
        logger.warning(f"{code}: {ymd} 파일에 {product} 결산가 없음")
        continue
      pending.append({'series_code': code, 'trade_date': d.isoformat(), 'close': price})
    return True

  failed: list[date] = []
  for i, d in enumerate(targets, 1):
    if not handle(d):
      failed.append(d)
    if len(pending) >= FLUSH_EVERY:
      flush()
      logger.info(f"SHFE: {i}/{len(targets)}일 처리 · 누적 {loaded}")

  if failed:
    logger.info(f"SHFE: 조회 실패 {len(failed)}일 — {SHFE_COOLDOWN_SEC}초 쉰 뒤 한 번 더 연다")
    time.sleep(SHFE_COOLDOWN_SEC)
    failed = [d for d in failed if not handle(d)]
  errors = len(failed)

  if pending:
    flush()
  logger.info(f"SHFE 수집 완료 — 적재 {loaded} · 휴장 {holidays} · 오류 {errors} · 결산가 없음 {missing}")

  # 받은 것은 위에서 이미 저장했다. 실패는 저장 «뒤에» 드러낸다(2026-11-09 Codex·오퍼스 검토).
  # - 일부 날짜라도 조회 오류·결산가 없음이 있으면 실패 — 기본 조회 범위(10일) 밖으로 밀리면 정기 실행이 못 메운다
  # - 기본 실행에서 어느 품목이 0행이면 실패 — 10일 창에는 늘 거래일이 있어 「전부 404」는 휴장이 아니라 주소 변경·차단이다
  if errors or any(missing.values()):
    logger.error(f"SHFE: 조회 오류 {errors}건 · 결산가 없음 {missing} — 빠진 날은 --backfill-years 로 메운다")
    sys.exit(1)
  empty = [code for code, n in loaded.items() if n == 0]
  if not backfill_years and targets and empty:
    logger.error(f"SHFE: 최근 {DEFAULT_LOOKBACK_DAYS}일 적재 0행 {empty}(404 {holidays}건) — 주소 변경·접속 차단 의심")
    sys.exit(1)


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='SHFE 주력월물 결산가 수집(열연·알루미늄)')
  parser.add_argument('--backfill-years', type=int, default=0, help='N년 전까지 DB 에 없는 평일 백필(기본 0 = 최근 10일)')
  args = parser.parse_args()
  try:
    collect(args.backfill_years)
  except SystemExit:
    raise
  except Exception as e:
    logger.error(f"SHFE 수집 실패: {e}")
    sys.exit(1)
