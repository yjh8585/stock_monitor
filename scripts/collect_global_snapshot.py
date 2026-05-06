#!/usr/bin/env python3
"""
글로벌 13개사 스냅샷 데이터를 yfinance에서 수집해 DB에 반영한다.
- companies 테이블: market_cap (KRW 억원), business_summary
- financials 테이블: per, pbr, ev_ebitda (2025 annual 행 존재 시)
"""
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.companies import get_global_companies
from lib.db import get_client

EOK = 100_000_000  # 1 억원 = 1e8 KRW


def _get_fx_rates() -> dict[str, float]:
    rows = get_client().table('exchange_rates_live').select('base,rate').execute().data
    rates = {r['base']: float(r['rate']) for r in rows}
    rates['KRW'] = 1.0
    return rates


def _get_company_meta() -> dict[str, dict]:
    rows = get_client().table('companies').select('id,ticker,currency').execute().data
    return {r['ticker']: {'id': r['id'], 'currency': r['currency']} for r in rows}


def _safe_float(val) -> float | None:
    """NaN·None·무한대를 None으로 반환한다."""
    if val is None:
        return None
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


def _market_cap_eok(raw: float | None, currency: str, fx: dict[str, float]) -> float | None:
    """원본 통화 시가총액 → KRW 억원 단위로 변환한다."""
    if raw is None:
        return None
    rate = fx.get(currency, 1.0)
    return round(raw * rate / EOK, 2)


def collectGlobalSnapshot() -> None:
    fx = _get_fx_rates()
    meta_map = _get_company_meta()
    client = get_client()
    now_iso = datetime.now(timezone.utc).isoformat()

    for company in get_global_companies():
        if company['status'] != 'active':
            continue

        ticker = company['ticker']
        meta = meta_map.get(ticker)
        if not meta:
            logger.warning(f"글로벌 {ticker}: company_id 없음 — 스킵")
            continue

        company_id = meta['id']
        currency = meta['currency']

        try:
            info = yf.Ticker(ticker).info

            # ── companies 업데이트 ──────────────────────────
            market_cap_eok = _market_cap_eok(_safe_float(info.get('marketCap')), currency, fx)
            summary = info.get('longBusinessSummary') or None

            company_update: dict = {}
            if market_cap_eok is not None:
                company_update['market_cap'] = market_cap_eok
            if summary:
                company_update['business_summary'] = summary
                company_update['summary_updated_at'] = now_iso

            if company_update:
                client.table('companies').update(company_update).eq('id', company_id).execute()

            # ── financials 2025 annual — per/pbr/ev_ebitda ──
            per = _safe_float(info.get('trailingPE'))
            pbr = _safe_float(info.get('priceToBook'))
            ev_ebitda = _safe_float(info.get('enterpriseToEbitda'))

            if any(v is not None for v in [per, pbr, ev_ebitda]):
                exists = (
                    client.table('financials')
                    .select('id')
                    .eq('company_id', company_id)
                    .eq('period_type', 'annual')
                    .eq('fiscal_year', 2025)
                    .execute()
                    .data
                )
                if exists:
                    fin_patch: dict = {}
                    if per is not None:
                        fin_patch['per'] = round(per, 2)
                    if pbr is not None:
                        fin_patch['pbr'] = round(pbr, 2)
                    if ev_ebitda is not None:
                        fin_patch['ev_ebitda'] = round(ev_ebitda, 2)
                    if fin_patch:
                        (
                            client.table('financials')
                            .update(fin_patch)
                            .eq('company_id', company_id)
                            .eq('period_type', 'annual')
                            .eq('fiscal_year', 2025)
                            .execute()
                        )

            logger.info(
                f"{ticker} ({company['name_kr']}): "
                f"market_cap={market_cap_eok}억원 "
                f"PER={per} PBR={pbr} EV/EBITDA={ev_ebitda}"
            )

        except Exception as e:
            logger.error(f"글로벌 {ticker} 수집 실패: {e}")


if __name__ == '__main__':
    try:
        collectGlobalSnapshot()
    except Exception as e:
        logger.error(f"글로벌 스냅샷 수집 실패: {e}")
        sys.exit(1)
