#!/usr/bin/env python3
"""UzAuto Motors IFRS PDF 보고서 → financials 적재.

플로우:
  1. https://uzautomotors.com/investors HTML fetch.
  2. <a href*=".pdf"> 추출 + 링크 텍스트에서 (annual|half_year, fiscal_year) 파싱.
  3. 각 PDF에 대해 sha256 계산 → uzauto_pdf_cache 비교 → 변경된 것만 LLM 호출.
  4. 연도 오름차순 정렬(재진술 정책: 최신 보고서가 마지막 적재 → 자연 우선).
  5. anthropic-sdk(claude-opus-4-7)에 PDF document + tool_use(submit_financials)로 구조화 추출.
  6. WriteSession으로 financials + uzauto_pdf_cache upsert → revalidate 자동.

매주 월요일 03:00 UTC에 .github/workflows/collect-uzauto-financials.yml 호출.
재실행 안전(멱등): 변경 없는 PDF는 cache hit → 호출 0.
소스 측 죽은 링크(HTTP 404/410)는 hard failure가 아니라 source_link_missing으로 집계하고
워크플로 exit 0을 유지한다(로그·JSON엔 기록). 타임아웃·5xx·연결오류 등은 그대로 실패 처리.

플래그:
  --reprocess-all   cache 무시하고 모든 PDF 재처리.
  --dry-run         LLM 호출 없이 PDF 링크 추출까지만.

비용 (참고, Opus 4.7):
  PDF당 입력 ~50K tokens × $15/M + 출력 ~1K × $75/M ≈ $0.83
  첫 11건 일괄 ≈ $9
  매주 cache hit 시 거의 0
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from urllib.parse import quote, urljoin, urlsplit, urlunsplit

import requests
from anthropic import Anthropic
from bs4 import BeautifulSoup
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession, get_client  # noqa: E402

INVESTORS_URL = 'https://uzautomotors.com/investors'
COMPANY_TICKER = 'UZMT'
COMPANY_DATA_SOURCE = 'uzauto-pdf'
CURRENCY = 'USD'
ANTHROPIC_MODEL = os.environ.get('UZAUTO_FINANCIALS_MODEL', 'claude-opus-4-7')
# Sonnet 4.6으로 비용 절감하고 싶으면 UZAUTO_FINANCIALS_MODEL=claude-sonnet-4-6 env var.

# 링크 텍스트 파싱. 페이지가 우즈벡어 기본이라 두 언어 모두 처리:
#   영문: "IFRS ANNUAL REPORT 2024" / "IFRS HALF YEAR REPORT 2025"
#   우즈벡: "MHXS YILLIK HISOBOTI 2024" / "MXHS YARIM YILLIK HISOBOT 2021"
#     - YILLIK HISOBOT(I) = ANNUAL REPORT
#     - YARIM YILLIK HISOBOT(I) = HALF YEAR REPORT (YARIM=half)
# 연도는 4자리 숫자.
_HALF_YEAR_RE = re.compile(
  r'(?:HALF[-_ ]?YEAR|YARIM[-_ ]+YILLIK)', re.IGNORECASE
)
_ANNUAL_RE = re.compile(r'(?:ANNUAL|YILLIK)', re.IGNORECASE)
_YEAR_RE = re.compile(r'(20\d{2})')

FINANCIALS_TOOL = {
  'name': 'submit_financials',
  'description': (
    'Submit extracted IFRS consolidated financial statements (Group level, in USD thousands).'
    ' Only include metrics explicitly reported; omit unknowns rather than inventing values.'
  ),
  'input_schema': {
    'type': 'object',
    'properties': {
      'period_type': {'type': 'string', 'enum': ['annual', 'quarterly']},
      'fiscal_year': {'type': 'integer', 'minimum': 2015, 'maximum': 2030},
      'fiscal_quarter': {
        'type': ['integer', 'null'],
        'enum': [None, 1, 2, 3, 4],
        'description': 'NULL for annual; 2 for half-year (cumulative).',
      },
      'period_end_date': {'type': 'string', 'description': 'YYYY-MM-DD'},
      'currency': {'type': 'string', 'enum': ['USD']},
      'revenue': {'type': ['number', 'null'], 'description': 'Total revenue, USD thousands'},
      'cogs': {'type': ['number', 'null']},
      'gross_profit': {'type': ['number', 'null']},
      'sga': {'type': ['number', 'null']},
      'operating_income': {'type': ['number', 'null']},
      'ebitda': {'type': ['number', 'null']},
      'net_income': {'type': ['number', 'null']},
      'total_assets': {'type': ['number', 'null']},
      'total_liabilities': {'type': ['number', 'null']},
      'total_equity': {'type': ['number', 'null']},
      'inventory': {'type': ['number', 'null']},
    },
    'required': ['period_type', 'fiscal_year', 'period_end_date', 'currency'],
  },
}


def fetch_investors_page() -> str:
  """investors HTML 가져오기."""
  r = requests.get(
    INVESTORS_URL,
    headers={'User-Agent': 'Mozilla/5.0 (stock_monitor)'},
    timeout=30.0,
    allow_redirects=True,
  )
  r.raise_for_status()
  return r.text


def parse_pdf_links(html: str) -> list[dict]:
  """PDF 링크 + 메타 추출. 같은 (type, year) 중복 시 첫 항목 채택."""
  soup = BeautifulSoup(html, 'html.parser')
  seen: set[tuple[str, int]] = set()
  out: list[dict] = []
  for a in soup.find_all('a', href=True):
    href = a['href'].strip()
    if not href.lower().endswith('.pdf'):
      continue
    # 링크 텍스트가 비면 부모 텍스트도 확인
    text = a.get_text(' ', strip=True) or (
      a.parent.get_text(' ', strip=True) if a.parent else ''
    )
    year_m = _YEAR_RE.search(text)
    if not year_m:
      continue
    fiscal_year = int(year_m.group(1))
    # half_year를 먼저 검사 (annual의 키워드인 YILLIK이 half_year 텍스트에도 포함됨)
    if _HALF_YEAR_RE.search(text):
      report_type = 'half_year'
    elif _ANNUAL_RE.search(text):
      report_type = 'annual'
    else:
      continue
    key = (report_type, fiscal_year)
    if key in seen:
      continue
    seen.add(key)
    out.append({
      'url': urljoin(INVESTORS_URL, href),
      'report_type': report_type,
      'fiscal_year': fiscal_year,
      'title': text,
    })
  out.sort(key=lambda r: (r['fiscal_year'], 0 if r['report_type'] == 'half_year' else 1))
  return out


def get_uzmt_company_id() -> str:
  """companies 테이블에서 UzAuto row의 id 조회."""
  cli = get_client()
  rows = (
    cli.table('companies')
    .select('id, data_source, status')
    .eq('ticker', COMPANY_TICKER)
    .execute()
    .data
    or []
  )
  if not rows:
    raise SystemExit(
      f"companies 테이블에 ticker={COMPANY_TICKER} 행이 없습니다. 회사부터 등록하세요."
    )
  c = rows[0]
  if c['data_source'] != COMPANY_DATA_SOURCE:
    logger.warning(
      f"{COMPANY_TICKER}: data_source={c['data_source']!r}, 기대값 {COMPANY_DATA_SOURCE!r}"
    )
  if c['status'] != 'active':
    logger.warning(f"{COMPANY_TICKER}: status={c['status']!r} (active 아님)")
  return c['id']


def load_pdf_cache() -> dict[str, dict]:
  """uzauto_pdf_cache 전체 조회. url → row dict."""
  cli = get_client()
  rows = cli.table('uzauto_pdf_cache').select('*').execute().data or []
  return {r['url']: r for r in rows}


def _encode_url_path(url: str) -> str:
  """URL의 path 부분 공백·비-ASCII를 인코딩. 이미 인코딩된 %XX는 보존."""
  parts = urlsplit(url)
  encoded_path = quote(parts.path, safe='/%')
  return urlunsplit((parts.scheme, parts.netloc, encoded_path, parts.query, parts.fragment))


def download_pdf(url: str) -> tuple[bytes, str, str | None]:
  """PDF 다운로드 → (bytes, sha256, etag). 공백 포함 URL도 처리."""
  r = requests.get(
    _encode_url_path(url),
    headers={'User-Agent': 'Mozilla/5.0 (stock_monitor)'},
    timeout=120.0,
    allow_redirects=True,
  )
  r.raise_for_status()
  pdf_bytes = r.content
  sha = hashlib.sha256(pdf_bytes).hexdigest()
  etag = r.headers.get('etag') or r.headers.get('last-modified')
  return pdf_bytes, sha, etag


def call_anthropic_for_pdf(
  client: Anthropic, pdf_bytes: bytes, link: dict
) -> dict | None:
  """PDF를 Anthropic에 전송하고 submit_financials 도구 호출 결과 dict 반환."""
  b64 = base64.standard_b64encode(pdf_bytes).decode('utf-8')
  expected_period_type = 'annual' if link['report_type'] == 'annual' else 'quarterly'
  expected_fq = 'NULL (annual)' if link['report_type'] == 'annual' else '2 (half-year cumulative)'
  expected_pe = (
    f"{link['fiscal_year']}-12-31" if link['report_type'] == 'annual'
    else f"{link['fiscal_year']}-06-30"
  )

  user_prompt = (
    f"This PDF is UzAuto Motors IFRS {link['report_type'].replace('_', '-')} "
    f"report for fiscal year {link['fiscal_year']}.\n\n"
    f"Extract the GROUP CONSOLIDATED financial statements (not the parent-only / "
    f"separate financials, and NOT the UzAuto Motors Powertrain subsidiary tables).\n\n"
    f"Expected metadata:\n"
    f"  - period_type: {expected_period_type}\n"
    f"  - fiscal_year: {link['fiscal_year']}\n"
    f"  - fiscal_quarter: {expected_fq}\n"
    f"  - period_end_date: {expected_pe}\n"
    f"  - currency: USD (values reported in USD thousands)\n\n"
    f"Rules:\n"
    f"  - Use the CURRENT period column for the reported year. Do NOT use prior-year "
    f"comparison columns.\n"
    f"  - Values should be in USD thousands as reported in the statements.\n"
    f"  - If gross_profit is not explicitly reported but revenue and cogs are, leave gross_profit null.\n"
    f"  - Omit any metric not explicitly present rather than guessing.\n"
    f"  - For half-year report, fiscal_quarter MUST be 2 and revenue/op_income are 6-month cumulative.\n\n"
    f"Call the submit_financials tool with the extracted values."
  )

  try:
    msg = client.messages.create(
      model=ANTHROPIC_MODEL,
      max_tokens=2000,
      tools=[FINANCIALS_TOOL],
      tool_choice={'type': 'tool', 'name': 'submit_financials'},
      messages=[
        {
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
        }
      ],
    )
  except Exception as e:
    logger.error(f"  Anthropic 호출 실패: {e}")
    return None

  for block in msg.content:
    if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_financials':
      return dict(block.input)

  logger.error(f"  tool_use 응답 없음. stop_reason={msg.stop_reason}, content={msg.content!r}")
  return None


def build_financial_row(company_id: str, extracted: dict, link: dict) -> dict:
  """추출 결과를 financials 테이블 row로 변환."""
  expected_period_type = 'annual' if link['report_type'] == 'annual' else 'quarterly'
  if extracted.get('period_type') != expected_period_type:
    logger.warning(
      f"  period_type mismatch: got={extracted.get('period_type')!r}, "
      f"expected={expected_period_type!r} — 링크 메타를 신뢰합니다."
    )
  if extracted.get('fiscal_year') != link['fiscal_year']:
    logger.warning(
      f"  fiscal_year mismatch: got={extracted.get('fiscal_year')!r}, "
      f"expected={link['fiscal_year']} — 링크 메타를 신뢰합니다."
    )

  fiscal_quarter = None
  if link['report_type'] == 'half_year':
    fiscal_quarter = 2

  expected_pe = (
    f"{link['fiscal_year']}-12-31" if link['report_type'] == 'annual'
    else f"{link['fiscal_year']}-06-30"
  )

  row = {
    'company_id': company_id,
    'period_type': expected_period_type,
    'fiscal_year': link['fiscal_year'],
    'fiscal_quarter': fiscal_quarter,
    'period_end_date': extracted.get('period_end_date') or expected_pe,
    'currency': CURRENCY,
    'consolidation': 'consolidated',
    'source': f"uzauto-pdf:{link['url']}",
  }

  # UzAuto IFRS PDF는 "in thousands of US Dollars"로 표시하지만, DB 단위 규약은 USD millions
  # (다른 yfinance USD 회사들과 동일). 따라서 적재 시 thousands → millions 변환(÷1000).
  for col in (
    'revenue', 'cogs', 'gross_profit', 'sga', 'operating_income', 'ebitda',
    'net_income', 'total_assets', 'total_liabilities', 'total_equity', 'inventory',
  ):
    v = extracted.get(col)
    if v is not None:
      row[col] = v / 1000.0

  return row


def parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description='UzAuto IFRS PDF → financials 수집.')
  p.add_argument('--reprocess-all', action='store_true', help='cache 무시하고 모든 PDF 재처리')
  p.add_argument('--dry-run', action='store_true', help='LLM 호출 없이 링크 추출까지만')
  return p.parse_args()


def main() -> int:
  args = parse_args()
  logger.info(f"UzAuto financials 수집 시작 (model={ANTHROPIC_MODEL})")

  api_key = os.environ.get('ANTHROPIC_API_KEY')
  if not api_key and not args.dry_run:
    logger.error('ANTHROPIC_API_KEY 환경변수 미설정')
    return 1

  html = fetch_investors_page()
  links = parse_pdf_links(html)
  logger.info(f"PDF 링크 {len(links)}건 감지")
  for link in links:
    logger.info(f"  {link['fiscal_year']:>4} {link['report_type']:<10} {link['url']}")

  if not links:
    logger.error('PDF 링크 추출 실패 — 페이지 구조 변경 가능성')
    return 1

  if args.dry_run:
    logger.success('dry-run 종료')
    return 0

  cache = load_pdf_cache()
  company_id = get_uzmt_company_id()
  client = Anthropic(api_key=api_key)

  summary = {'processed': 0, 'cached': 0, 'failed': 0, 'source_link_missing': 0, 'pdfs': []}

  with WriteSession() as w:
    for link in links:
      try:
        pdf_bytes, sha, etag = download_pdf(link['url'])
      except Exception as e:
        # 404/410 = 소스 사이트가 안내한 링크가 깨진 경우(파일이 그 URL에 없음).
        # 재시도로 해결 불가한 소스 측 문제이므로 hard failure에서 제외(skip)하되 로그·JSON엔 기록.
        # 타임아웃·5xx·연결오류 등 일시적/인프라 문제는 그대로 hard failure로 둬 다음 실행에 재시도·알림.
        status_code = getattr(getattr(e, 'response', None), 'status_code', None)
        if status_code in (404, 410):
          logger.warning(
            f"  SOURCE LINK MISSING {link['fiscal_year']} {link['report_type']} "
            f"(HTTP {status_code}) — 소스가 안내한 링크가 깨짐, skip(hard-fail 아님): {link['url']}"
          )
          summary['source_link_missing'] += 1
          summary['pdfs'].append({**link, 'status': 'source_link_missing', 'http': status_code})
          continue
        logger.error(f"  DOWNLOAD failed {link['fiscal_year']} {link['report_type']}: {e}")
        summary['failed'] += 1
        summary['pdfs'].append({**link, 'status': 'download_failed', 'error': str(e)})
        continue

      cached = cache.get(link['url'])
      if not args.reprocess_all and cached and cached.get('sha256') == sha:
        logger.info(f"  CACHED {link['fiscal_year']} {link['report_type']} (sha256 match)")
        summary['cached'] += 1
        summary['pdfs'].append({**link, 'status': 'cached'})
        continue

      logger.info(f"  PROCESS {link['fiscal_year']} {link['report_type']} ({len(pdf_bytes)/1024:.0f} KB)")
      try:
        extracted = call_anthropic_for_pdf(client, pdf_bytes, link)
      except Exception as e:
        logger.error(f"  LLM error {link['fiscal_year']} {link['report_type']}: {e}")
        summary['failed'] += 1
        summary['pdfs'].append({**link, 'status': 'llm_error', 'error': str(e)})
        continue

      if not extracted:
        summary['failed'] += 1
        summary['pdfs'].append({**link, 'status': 'llm_failed'})
        continue

      try:
        row = build_financial_row(company_id, extracted, link)
        w.table('financials').upsert(
          row,
          on_conflict='company_id,period_type,fiscal_year,fiscal_quarter',
        ).execute()
        w.table('uzauto_pdf_cache').upsert({
          'url': link['url'],
          'fiscal_year': link['fiscal_year'],
          'report_type': link['report_type'],
          'etag': etag,
          'sha256': sha,
          'last_processed_at': datetime.now(timezone.utc).isoformat(),
        }).execute()
        summary['processed'] += 1
        summary['pdfs'].append({**link, 'status': 'processed', 'revenue': extracted.get('revenue')})
        logger.success(
          f"    revenue={extracted.get('revenue')} op_income={extracted.get('operating_income')}"
        )
      except Exception as e:
        logger.error(f"  UPSERT failed {link['fiscal_year']} {link['report_type']}: {e}")
        summary['failed'] += 1
        summary['pdfs'].append({**link, 'status': 'upsert_failed', 'error': str(e)})

  scripts_dir = os.path.dirname(os.path.abspath(__file__))
  log_path = os.path.join(
    scripts_dir, f'_uzauto_pdfs_run_{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")}.json'
  )
  with open(log_path, 'w', encoding='utf-8') as f:
    json.dump(summary, f, indent=2, ensure_ascii=False)
  logger.info(f"실행 로그: {log_path}")
  logger.success(
    f"완료: processed={summary['processed']}, cached={summary['cached']}, "
    f"source_link_missing={summary['source_link_missing']}, failed={summary['failed']}"
  )
  return 0 if summary['failed'] == 0 else 1


if __name__ == '__main__':
  try:
    sys.exit(main())
  except Exception as e:
    logger.error(f"UzAuto financials 수집 실패: {e}")
    sys.exit(1)
