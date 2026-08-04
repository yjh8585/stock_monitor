#!/usr/bin/env python3
"""
글로벌 13개사 스냅샷 데이터를 yfinance에서 수집해 DB에 반영한다.
- companies 테이블: market_cap (KRW 억원), business_summary
- financials 테이블: per (TTM), pbr, ev_ebitda (TTM)
  → 회사별로 financials 테이블에서 매출이 존재하는 가장 최근 annual fiscal_year 행에 기록한다.
    회계연도가 진행되어 새 annual 행이 생기면 자동으로 그 연도로 이전된다.

한국 상장사는 yfinance가 trailingPE·priceToBook을 제공하지 않아 별도 경로로 처리한다:
  - 주가·시총·거래량: pykrx → collect_prices_live.py
  - PER/PBR/EV-EBITDA + 기업개요: fnguide Playwright → collect_kr_snapshot.py
"""
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.companies import get_global_companies
from lib.db import WriteSession, get_client
from lib.financial_sources import SOURCE_YFINANCE

EOK = 100_000_000  # 1 억원 = 1e8 KRW
TRANSLATE_MODEL = 'claude-haiku-4-5'

_anthropic = None
_KOREAN_RE = re.compile(r'[가-힣]')


def _get_anthropic():
    """ANTHROPIC_API_KEY가 있을 때만 Anthropic 클라이언트를 lazy 생성한다."""
    global _anthropic
    if _anthropic is None:
        api_key = os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            return None
        try:
            from anthropic import Anthropic
            _anthropic = Anthropic(api_key=api_key)
        except ImportError:
            logger.warning('anthropic 패키지 미설치 — 번역 비활성화')
            return None
    return _anthropic


def _has_korean(text: str | None) -> bool:
    return bool(text and _KOREAN_RE.search(text))


def _translate_summary(en_text: str, name_kr: str) -> str | None:
    """yfinance 영문 longBusinessSummary를 한국어 비즈니스 요약으로 재작성한다."""
    client = _get_anthropic()
    if not client:
        return None
    prompt = (
        f"다음 영문 회사 소개를 한국어 비즈니스 요약 5~7문장으로 재작성하세요.\n\n"
        f"규칙:\n"
        f"- 사업 영역, 주요 제품·서비스, 핵심 시장, 본사 위치/설립 연도(있는 경우)를 포함\n"
        f"- 한국 자동차·산업 업계에서 통용되는 용어를 사용\n"
        f"- 단순 직역이 아닌 자연스러운 비즈니스 문체\n"
        f"- 답변에는 요약 본문만 출력 (서론·접두어·코드블록·따옴표 금지)\n\n"
        f"회사: {name_kr}\n"
        f"영문 원문:\n{en_text}"
    )
    try:
        msg = client.messages.create(
            model=TRANSLATE_MODEL,
            max_tokens=600,
            messages=[{'role': 'user', 'content': prompt}],
        )
        return msg.content[0].text.strip()
    except Exception as e:
        logger.warning(f'{name_kr} 번역 실패: {e}')
        return None


def _get_fx_rates() -> dict[str, float]:
    rows = get_client().table('exchange_rates_live').select('base,rate').execute().data
    rates = {r['base']: float(r['rate']) for r in rows}
    rates['KRW'] = 1.0
    return rates


def _get_company_meta() -> dict[str, dict]:
    rows = (
        get_client()
        .table('companies')
        .select('id,ticker,currency,business_summary')
        .execute()
        .data
    )
    return {
        r['ticker']: {
            'id': r['id'],
            'currency': r['currency'],
            'business_summary': r.get('business_summary'),
        }
        for r in rows
    }


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


def _resolve_target_year(w, company_id: str) -> int:
    """PER/PBR/EV_EBITDA를 기록할 fiscal_year를 결정한다.

    우선순위:
    1) revenue가 있는 가장 최근 annual fiscal_year
    2) annual 행이 존재하는 가장 최근 fiscal_year
    3) 현재 연도 - 1 (회계연도 종료 직전 해)
    """
    rows = (
        w.table('financials')
        .select('fiscal_year,revenue')
        .eq('company_id', company_id)
        .eq('period_type', 'annual')
        .order('fiscal_year', desc=True)
        .execute()
        .data
    )
    for r in rows:
        if r.get('revenue') is not None:
            return int(r['fiscal_year'])
    if rows:
        return int(rows[0]['fiscal_year'])
    return datetime.now().year - 1


def collectGlobalSnapshot() -> None:
    fx = _get_fx_rates()
    meta_map = _get_company_meta()
    with WriteSession() as w:
        _collect_global_snapshot_in_session(w, fx, meta_map)


def _collect_global_snapshot_in_session(w, fx: dict[str, float], meta_map: dict[str, dict]) -> None:
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
        existing_summary = meta.get('business_summary')

        try:
            info = yf.Ticker(ticker).info

            # ── companies 업데이트 ──────────────────────────
            market_cap_eok = _market_cap_eok(_safe_float(info.get('marketCap')), currency, fx)
            en_summary = info.get('longBusinessSummary') or None

            # DB에 한국어가 이미 있으면 영문으로 덮어쓰지 않음 (LLM 호출 절약)
            kr_summary = None
            if en_summary and not _has_korean(existing_summary):
                kr_summary = _translate_summary(en_summary, company['name_kr']) or en_summary

            company_update: dict = {}
            if market_cap_eok is not None:
                company_update['market_cap'] = market_cap_eok
            if kr_summary:
                company_update['business_summary'] = kr_summary
                company_update['summary_updated_at'] = now_iso

            if company_update:
                w.table('companies').update(company_update).eq('id', company_id).execute()

            # ── financials per/pbr/ev_ebitda (TTM/현재 valuation) ──
            # 회사별 가장 최근 annual fiscal_year에 기록 — 새 회계연도 행이 생기면 자동 이전
            target_year = _resolve_target_year(w, company_id)

            # financials 행에 들어갈 통화는 yfinance financialCurrency 우선
            fin_currency = info.get('financialCurrency') or currency

            per = _safe_float(info.get('trailingPE'))
            pbr = _safe_float(info.get('priceToBook'))
            ev_ebitda = _safe_float(info.get('enterpriseToEbitda'))

            if any(v is not None for v in [per, pbr, ev_ebitda]):
                fin_vals: dict = {}
                if per is not None:
                    fin_vals['per'] = round(per, 2)
                if pbr is not None:
                    fin_vals['pbr'] = round(pbr, 2)
                if ev_ebitda is not None:
                    fin_vals['ev_ebitda'] = round(ev_ebitda, 2)

                exists = (
                    w.table('financials')
                    .select('id')
                    .eq('company_id', company_id)
                    .eq('period_type', 'annual')
                    .eq('fiscal_year', target_year)
                    .execute()
                    .data
                )
                if exists:
                    (
                        w.table('financials')
                        .update(fin_vals)
                        .eq('company_id', company_id)
                        .eq('period_type', 'annual')
                        .eq('fiscal_year', target_year)
                        .execute()
                    )
                else:
                    (
                        w.table('financials')
                        .insert({
                            'company_id': company_id,
                            'period_type': 'annual',
                            'fiscal_year': target_year,
                            'currency': fin_currency,
                            # 신규 생성 행만 출처를 남긴다. 위 UPDATE 경로는 다른
                            # 수집기(fnguide·dart)가 만든 행의 지표만 덧쓰므로
                            # source를 건드리면 원 출처가 지워진다.
                            'source': SOURCE_YFINANCE,
                            **fin_vals,
                        })
                        .execute()
                    )

            logger.info(
                f"{ticker} ({company['name_kr']}) FY{target_year}: "
                f"market_cap={market_cap_eok}억원 "
                f"PER={per} PBR={pbr} EV/EBITDA={ev_ebitda}"
            )

        except Exception as e:
            logger.error(f"글로벌 {ticker} 수집 실패: {e}")

    # WriteSession.__exit__이 자동으로 revalidate_for_tables(['companies', 'financials'])를 호출한다.


if __name__ == '__main__':
    try:
        collectGlobalSnapshot()
    except Exception as e:
        logger.error(f"글로벌 스냅샷 수집 실패: {e}")
        sys.exit(1)
