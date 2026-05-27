#!/usr/bin/env python3
"""현대차 분기별 IR 보고서(PDF) → hyundai_quarterly_earnings 적재.

플로우 (UzAuto IFRS 패턴 참고):
  1. https://www.hyundai.com/worldwide/ko/company/ir/financial-information/quarterly-earnings 진입.
  2. 연도 dropdown(`#field-yearly-type-1`)을 year_from~year_to 범위로 순회.
  3. 각 연도 페이지에서 Q1/Q2/Q3/Q4 4개 카드의 "실적 발표 자료" 버튼을 순서대로 click.
  4. `page.expect_download()`로 PDF 캡쳐 → `data/_hyundai_quarterly_downloads/{year}_q{n}.pdf`.
  5. sha256 계산 → DB에 저장된 pdf_sha256과 비교, 일치하면 LLM 호출 skip(cache hit).
  6. Anthropic(claude-opus-4-7) + PDF document + tool_use(submit_earnings)로 구조화 추출.
  7. WriteSession으로 hyundai_quarterly_earnings upsert(PK 충돌 시 덮어쓰기 — 재진술 자연 수용).

플래그:
  --year-from 2021     수집 시작 연도 (default 2021)
  --year-to <year>     수집 마지막 연도 (default 현재 연도)
  --quarter {1,2,3,4}  특정 분기만 (default 전체)
  --reprocess-all      sha256 cache 무시하고 모든 PDF 재처리
  --dry-run            LLM 호출 없이 PDF 다운로드 + sha256까지만

비용 (Opus 4.7, PDF당):
  입력 ~30K tokens × $15/M + 출력 ~1.5K × $75/M ≈ $0.56
  4분기 × 5년 = 20건 백필 ≈ $11. cache hit 시 거의 0.
  매분기 cron은 1건만 새로 추가되므로 ≈ $0.6.

멱등성: PK(fiscal_year, fiscal_quarter) upsert + sha256 cache.
"""
import argparse
import base64
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession, get_client  # noqa: E402

SOURCE_URL = (
  'https://www.hyundai.com/worldwide/ko/company/ir/financial-information/quarterly-earnings'
)
DOWNLOAD_DIR = (
  Path(__file__).resolve().parent.parent / 'data' / '_hyundai_quarterly_downloads'
)
DEFAULT_YEAR_FROM = 2021
ANTHROPIC_MODEL = os.environ.get('HYUNDAI_QUARTERLY_MODEL', 'claude-opus-4-7')
PLAYWRIGHT_TIMEOUT_MS = 60_000
DOWNLOAD_TIMEOUT_MS = 60_000
DROPDOWN_WAIT_MS = 2_500
QUARTER_END_DATES = {1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31'}

# IR PDF 구조화 추출용 tool 정의.
# PDF가 KRW 십억원/천대 단위로 표기 → DB도 동일 단위(_krw_bn / _k_units)로 저장.
EARNINGS_TOOL = {
  'name': 'submit_earnings',
  'description': (
    "Submit extracted quarterly earnings KPIs from Hyundai Motor's IR presentation PDF "
    '(in Korean Won billions for finance, thousand units for sales). '
    'Only include metrics explicitly reported in the CURRENT quarter column. '
    'Omit unknowns rather than inventing values.'
  ),
  'input_schema': {
    'type': 'object',
    'properties': {
      'fiscal_year': {'type': 'integer', 'minimum': 2010, 'maximum': 2050},
      'fiscal_quarter': {'type': 'integer', 'enum': [1, 2, 3, 4]},
      'period_end_date': {
        'type': 'string',
        'description': 'YYYY-MM-DD (quarter end, e.g. 2025-03-31 for Q1)',
      },
      # 손익 (KRW 십억원)
      'revenue_krw_bn': {'type': ['number', 'null'], 'description': '연결 매출액 (십억원)'},
      'revenue_auto_krw_bn': {'type': ['number', 'null'], 'description': '자동차 부문 매출'},
      'revenue_finance_krw_bn': {'type': ['number', 'null'], 'description': '금융 부문 매출'},
      'revenue_other_krw_bn': {'type': ['number', 'null'], 'description': '기타 부문 매출'},
      'cogs_krw_bn': {'type': ['number', 'null'], 'description': '매출원가'},
      'gross_profit_krw_bn': {'type': ['number', 'null'], 'description': '매출총이익'},
      'gross_margin_pct': {'type': ['number', 'null']},
      'sga_krw_bn': {'type': ['number', 'null'], 'description': '판매비와관리비'},
      'operating_income_krw_bn': {'type': ['number', 'null'], 'description': '영업이익'},
      'operating_margin_pct': {'type': ['number', 'null']},
      'pretax_income_krw_bn': {'type': ['number', 'null'], 'description': '세전이익(법인세비용차감전순이익)'},
      'net_income_krw_bn': {
        'type': ['number', 'null'],
        'description': '당기순이익 (지배+비지배 합산). 보고서가 분리 표기하면 net_income_controlling_krw_bn에 지배주주 별도.',
      },
      'net_income_controlling_krw_bn': {
        'type': ['number', 'null'],
        'description': '지배주주 순이익 (분리 보고된 경우만)',
      },
      'ebitda_krw_bn': {'type': ['number', 'null']},
      # 판매량 (천대)
      'global_wholesale_k_units': {
        'type': ['integer', 'null'],
        'description': '글로벌 도매 합계 (천대). 페이지 5의 도매 그래프 합계.',
      },
      'global_retail_k_units': {
        'type': ['integer', 'null'],
        'description': '글로벌 소매 합계 (천대)',
      },
      'domestic_wholesale_k_units': {
        'type': ['integer', 'null'],
        'description': '국내(내수) 도매 (천대)',
      },
      'domestic_retail_k_units': {
        'type': ['integer', 'null'],
        'description': '국내 소매 (천대)',
      },
      'overseas_wholesale_k_units': {
        'type': ['integer', 'null'],
        'description': '해외 도매 (천대, 글로벌 - 내수)',
      },
      'ev_k_units': {'type': ['integer', 'null'], 'description': '순수 전기차 (천대)'},
      'hev_k_units': {'type': ['integer', 'null'], 'description': '하이브리드'},
      'phev_k_units': {'type': ['integer', 'null'], 'description': '플러그인 하이브리드'},
      'fcev_k_units': {'type': ['integer', 'null'], 'description': '수소전기차'},
      'eco_total_k_units': {
        'type': ['integer', 'null'],
        'description': '친환경 합계 (= EV+HEV+PHEV+FCEV)',
      },
    },
    'required': ['fiscal_year', 'fiscal_quarter', 'period_end_date'],
  },
}


# ---------------------------------------------------------------------------
# Playwright — 연도 선택 + Q1~Q4 PDF 다운로드
# ---------------------------------------------------------------------------
def _select_year(page, year: int) -> bool:
  """`#field-yearly-type-1` dropdown에서 연도 선택. 성공 시 True."""
  try:
    page.locator('#field-yearly-type-1 .btn-dropdown').first.click()
    page.wait_for_timeout(400)
    page.locator(
      f'#field-yearly-type-1 .btn-option:has-text("{year}")'
    ).first.click()
    page.wait_for_timeout(DROPDOWN_WAIT_MS)
    return True
  except Exception as e:
    logger.warning(f'{year}년 dropdown 선택 실패: {e}')
    return False


def _download_quarter_pdf(page, year: int, quarter: int) -> Path | None:
  """선택된 연도 페이지에서 quarter번째 '실적 발표 자료' 버튼 click → PDF 저장.

  Q1=index 0, Q2=1, Q3=2, Q4=3. hidden(미발표 분기) 버튼이 있으면 건너뛴다.
  """
  selector = 'button.btn-download:has-text("실적 발표 자료")'
  try:
    # hidden 버튼은 dom에는 있지만 보이지 않음 → visible만 카운트.
    btns = page.locator(f'{selector}:visible').all()
  except Exception as e:
    logger.warning(f'{year}Q{quarter} 버튼 조회 실패: {e}')
    return None

  if len(btns) < quarter:
    # 미발표 분기 (예: 2026 Q3/Q4)
    logger.info(f'{year}Q{quarter}: 발표 자료 버튼 없음(미발표 가능성)')
    return None

  btn = btns[quarter - 1]
  try:
    btn.scroll_into_view_if_needed(timeout=5_000)
  except Exception:
    pass

  try:
    with page.expect_download(timeout=DOWNLOAD_TIMEOUT_MS) as dl_info:
      btn.click()
    dl = dl_info.value
  except Exception as e:
    logger.error(f'{year}Q{quarter} 다운로드 실패: {e}')
    return None

  suggested = dl.suggested_filename or f'{year}_q{quarter}.pdf'
  # 파일명 정상화: q{n}-{YYYY}-... → {YYYY}_q{n}.pdf 통일
  dest = DOWNLOAD_DIR / f'{year}_q{quarter}.pdf'
  try:
    dl.save_as(str(dest))
  except Exception as e:
    logger.error(f'{year}Q{quarter} 저장 실패: {e}')
    return None
  logger.info(
    f'{year}Q{quarter}: 다운로드 완료 → {suggested} ({dest.stat().st_size/1024:.0f} KB)'
  )
  return dest


# ---------------------------------------------------------------------------
# LLM — Anthropic API로 PDF 추출
# ---------------------------------------------------------------------------
def _call_llm_for_pdf(
  client, pdf_bytes: bytes, year: int, quarter: int
) -> dict | None:
  """PDF를 Anthropic API에 전송하고 submit_earnings 도구 호출 결과 dict 반환."""
  b64 = base64.standard_b64encode(pdf_bytes).decode('utf-8')
  expected_end = f'{year}-{QUARTER_END_DATES[quarter]}'
  user_prompt = (
    f'This PDF is Hyundai Motor Company\'s quarterly earnings call presentation '
    f'for fiscal year {year}, quarter Q{quarter}.\n\n'
    f'Extract the CONSOLIDATED quarterly KPIs from the CURRENT-QUARTER column '
    f'(do NOT use prior-year or prior-quarter comparison columns).\n\n'
    f'Expected metadata:\n'
    f'  - fiscal_year: {year}\n'
    f'  - fiscal_quarter: {quarter}\n'
    f'  - period_end_date: {expected_end}\n\n'
    f'Reporting units in the PDF (preserve as-is):\n'
    f'  - Financial values: KRW billions ("십억원"). Store in *_krw_bn fields.\n'
    f'  - Sales volumes: thousand units ("천대"). Store in *_k_units fields.\n\n'
    f'Rules:\n'
    f'  - Operating income, EBITDA, net income are typically on the summary income '
    f'statement page (요약 손익) and detailed income statement (손익계산서).\n'
    f'  - Revenue segmentation (자동차/금융/기타) is on the income statement page.\n'
    f'  - Global wholesale total is on the sales-by-region page (페이지 5).\n'
    f'  - Eco-friendly breakdown (EV/HEV/PHEV/FCEV) is on the powertrain page (페이지 6).\n'
    f'  - Domestic = 국내, overseas = 해외/Export. Wholesale = 도매, retail = 소매.\n'
    f'  - If pretax_income / net_income / EBITDA appear with leading minus, treat as negative.\n'
    f'  - Omit any metric not explicitly reported rather than guessing.\n\n'
    f'Call the submit_earnings tool with the extracted values.'
  )

  try:
    msg = client.messages.create(
      model=ANTHROPIC_MODEL,
      max_tokens=2000,
      tools=[EARNINGS_TOOL],
      tool_choice={'type': 'tool', 'name': 'submit_earnings'},
      messages=[{
        'role': 'user',
        'content': [
          {
            'type': 'document',
            'source': {
              'type': 'base64',
              'media_type': 'application/pdf',
              'data': b64,
            },
          },
          {'type': 'text', 'text': user_prompt},
        ],
      }],
    )
  except Exception as e:
    logger.error(f'  Anthropic 호출 실패 ({year}Q{quarter}): {e}')
    return None

  for block in msg.content:
    if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_earnings':
      return dict(block.input)

  logger.error(
    f'  tool_use 응답 없음 ({year}Q{quarter}). stop_reason={msg.stop_reason}'
  )
  return None


# ---------------------------------------------------------------------------
# Cache 비교 + row build
# ---------------------------------------------------------------------------
def load_cache() -> dict[tuple[int, int], dict]:
  """기존 hyundai_quarterly_earnings rows 조회. (fy, fq) → row."""
  cli = get_client()
  try:
    rows = (
      cli.table('hyundai_quarterly_earnings')
      .select('fiscal_year, fiscal_quarter, pdf_sha256, pdf_url')
      .execute()
      .data
      or []
    )
  except Exception as e:
    logger.warning(f'cache 조회 실패(빈 cache로 진행): {e}')
    return {}
  return {(r['fiscal_year'], r['fiscal_quarter']): r for r in rows}


def build_row(extracted: dict, year: int, quarter: int, pdf_url: str,
              sha256: str) -> dict[str, Any]:
  """추출 결과 + 메타를 row dict로 변환."""
  row: dict[str, Any] = {
    'fiscal_year': year,
    'fiscal_quarter': quarter,
    'period_end_date': (
      extracted.get('period_end_date') or f'{year}-{QUARTER_END_DATES[quarter]}'
    ),
    'pdf_url': pdf_url,
    'pdf_sha256': sha256,
    'source_url': SOURCE_URL,
    'last_processed_at': datetime.now(timezone.utc).isoformat(),
  }
  # 손익 + 판매량 — extracted에 있는 것만 row에 추가
  for col in (
    'revenue_krw_bn', 'revenue_auto_krw_bn', 'revenue_finance_krw_bn',
    'revenue_other_krw_bn', 'cogs_krw_bn', 'gross_profit_krw_bn',
    'gross_margin_pct', 'sga_krw_bn', 'operating_income_krw_bn',
    'operating_margin_pct', 'pretax_income_krw_bn', 'net_income_krw_bn',
    'net_income_controlling_krw_bn', 'ebitda_krw_bn',
    'global_wholesale_k_units', 'global_retail_k_units',
    'domestic_wholesale_k_units', 'domestic_retail_k_units',
    'overseas_wholesale_k_units',
    'ev_k_units', 'hev_k_units', 'phev_k_units', 'fcev_k_units',
    'eco_total_k_units',
  ):
    v = extracted.get(col)
    if v is None:
      continue
    row[col] = v
  return row


def _sha256(data: bytes) -> str:
  return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description='현대차 분기별 IR PDF → DB 수집.')
  p.add_argument('--year-from', type=int, default=DEFAULT_YEAR_FROM)
  p.add_argument('--year-to', type=int, default=None,
                 help='마지막 연도 (default 현재 연도)')
  p.add_argument('--quarter', type=int, choices=[1, 2, 3, 4], default=None,
                 help='특정 분기만 처리 (default 전체 Q1~Q4)')
  p.add_argument('--reprocess-all', action='store_true',
                 help='sha256 cache 무시하고 모든 PDF 재처리')
  p.add_argument('--dry-run', action='store_true',
                 help='LLM 호출 없이 PDF 다운로드 + sha256까지만')
  return p.parse_args()


def _iter_targets(year_range: list[int], quarter: int | None) -> list[tuple[int, int]]:
  quarters = [quarter] if quarter else [1, 2, 3, 4]
  return [(y, q) for y in year_range for q in quarters]


def _process_one(
  page, year: int, quarter: int, cache: dict, reprocess: bool, dry_run: bool,
  client, summary: dict, writer: WriteSession,
) -> None:
  """1개 (year, quarter) 처리. summary에 결과 누적."""
  pdf_path = _download_quarter_pdf(page, year, quarter)
  if pdf_path is None:
    summary['skipped'] += 1
    summary['items'].append({'year': year, 'quarter': quarter, 'status': 'no_pdf'})
    return

  pdf_bytes = pdf_path.read_bytes()
  sha = _sha256(pdf_bytes)
  cached = cache.get((year, quarter))
  pdf_url = f'(hyundai-ir-quarterly)/{pdf_path.name}'

  if not reprocess and cached and cached.get('pdf_sha256') == sha:
    logger.info(f'  CACHED {year}Q{quarter} (sha256 match)')
    summary['cached'] += 1
    summary['items'].append({'year': year, 'quarter': quarter, 'status': 'cached'})
    return

  if dry_run:
    logger.info(f'  DRY-RUN {year}Q{quarter} sha256={sha[:12]}... ({len(pdf_bytes)/1024:.0f} KB)')
    summary['dry_run'] += 1
    summary['items'].append({
      'year': year, 'quarter': quarter, 'status': 'dry_run',
      'sha256': sha, 'size': len(pdf_bytes),
    })
    return

  logger.info(f'  PROCESS {year}Q{quarter} ({len(pdf_bytes)/1024:.0f} KB)')
  extracted = _call_llm_for_pdf(client, pdf_bytes, year, quarter)
  if not extracted:
    summary['failed'] += 1
    summary['items'].append({'year': year, 'quarter': quarter, 'status': 'llm_failed'})
    return

  row = build_row(extracted, year, quarter, pdf_url=pdf_url, sha256=sha)
  try:
    writer.table('hyundai_quarterly_earnings').upsert(
      row, on_conflict='fiscal_year,fiscal_quarter'
    ).execute()
    summary['processed'] += 1
    summary['items'].append({
      'year': year, 'quarter': quarter, 'status': 'processed',
      'revenue_krw_bn': row.get('revenue_krw_bn'),
      'operating_income_krw_bn': row.get('operating_income_krw_bn'),
      'global_wholesale_k_units': row.get('global_wholesale_k_units'),
    })
    logger.success(
      f'    revenue={row.get("revenue_krw_bn")} op_income={row.get("operating_income_krw_bn")} '
      f'global_sales={row.get("global_wholesale_k_units")}'
    )
  except Exception as e:
    logger.error(f'  UPSERT failed {year}Q{quarter}: {e}')
    summary['failed'] += 1
    summary['items'].append({
      'year': year, 'quarter': quarter, 'status': 'upsert_failed', 'error': str(e),
    })


def main() -> int:
  args = parse_args()
  current_year = datetime.now(timezone.utc).year
  year_to = args.year_to or current_year
  year_range = list(range(args.year_from, year_to + 1))
  logger.info(
    f'현대차 분기 IR 수집: {year_range[0]}~{year_range[-1]} '
    f'quarter={args.quarter or "ALL"} model={ANTHROPIC_MODEL} '
    f'(dry_run={args.dry_run}, reprocess={args.reprocess_all})'
  )

  DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

  api_key = os.environ.get('ANTHROPIC_API_KEY')
  if not api_key and not args.dry_run:
    logger.error('ANTHROPIC_API_KEY 환경변수 미설정')
    return 1

  client = None
  if not args.dry_run:
    from anthropic import Anthropic  # noqa: E402
    client = Anthropic(api_key=api_key)

  cache = load_cache()
  logger.info(f'기존 cache 행: {len(cache)}개')

  summary = {
    'processed': 0, 'cached': 0, 'dry_run': 0, 'failed': 0, 'skipped': 0,
    'items': [],
  }

  from playwright.sync_api import sync_playwright  # noqa: E402

  with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(accept_downloads=True)
    page = ctx.new_page()
    try:
      page.goto(SOURCE_URL, wait_until='domcontentloaded',
                timeout=PLAYWRIGHT_TIMEOUT_MS)
      page.wait_for_load_state('load', timeout=30_000)
      page.wait_for_timeout(3_000)
    except Exception as e:
      logger.error(f'IR 페이지 로드 실패: {e}')
      ctx.close()
      browser.close()
      return 1

    with WriteSession() as writer:
      for year in year_range:
        if not _select_year(page, year):
          summary['failed'] += 1
          continue
        for (yy, qq) in _iter_targets([year], args.quarter):
          try:
            _process_one(
              page, yy, qq, cache, args.reprocess_all, args.dry_run,
              client, summary, writer,
            )
          except Exception as e:
            logger.exception(f'{yy}Q{qq} 처리 실패: {e}')
            summary['failed'] += 1
            summary['items'].append({
              'year': yy, 'quarter': qq, 'status': 'unexpected', 'error': str(e),
            })

    ctx.close()
    browser.close()

  log_path = (
    Path(__file__).resolve().parent
    / f'_hyundai_quarterly_run_{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")}.json'
  )
  log_path.write_text(
    json.dumps(summary, ensure_ascii=False, indent=2, default=str),
    encoding='utf-8',
  )
  logger.info(f'실행 로그: {log_path}')
  logger.success(
    f'완료: processed={summary["processed"]}, cached={summary["cached"]}, '
    f'dry_run={summary["dry_run"]}, failed={summary["failed"]}, skipped={summary["skipped"]}'
  )
  return 0 if summary['failed'] == 0 else 1


if __name__ == '__main__':
  try:
    sys.exit(main())
  except KeyboardInterrupt:
    logger.warning('사용자 중단')
    sys.exit(130)
  except Exception as e:
    logger.exception(f'예기치 못한 오류: {e}')
    sys.exit(1)
