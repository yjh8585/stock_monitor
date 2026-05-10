#!/usr/bin/env python3
"""
/domestic 페이지 회사들의 business_summary / customers 자동 보강.

자료원 분기:
  - 상장사 (data_source='fnguide'): DART 사업보고서 'II. 사업의 내용' 본문 → 100~300자 요약
  - 비상장사 (data_source='dart'):
      1차: 결산감사보고서 본문에서 '회사의 개요' / '일반 사항' 섹션 추출
      1차 결과 < 50자이면 2차: Playwright 네이버 검색 (실패 시 구글 폴백)

저장 형식:
  - business_summary: text (한국어 1~2문장)
  - customers: jsonb 배열 [{"name": "현대차"}, ...]

회사 1건씩 즉시 UPDATE flush — 중간 종료 시 손실 방지.
"""
import json
import os
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client
from collect_dart_audit import (
  _fetch_tables,
  _get_audit_rcpt,
  _get_dart,
  _get_main_doc_url,
  _normalize,
)
from collect_dart_domestic import _load_manual_mapping, _resolve_corp_code

# ── 상수 ─────────────────────────────────────────────────────────────────
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

KNOWN_OEMS: list[str] = [
  '현대차', '현대자동차', '기아', '제네시스',
  'GM', '지엠', '제너럴모터스', '쉐보레',
  '포드', 'Ford',
  '폭스바겐', 'VW', '아우디', '포르쉐',
  'BMW', '벤츠', 'Mercedes', '메르세데스',
  'BYD', '비야디',
  '테슬라', 'Tesla',
  'Stellantis', '스텔란티스', '크라이슬러', '지프', 'Jeep',
  '르노', 'Renault', 'Nissan', '닛산',
  '도요타', 'Toyota', '혼다', 'Honda',
  '스즈키', '미쓰비시',
  'SK on', 'SK온', '에스케이온',
  'LG에너지솔루션', 'LGES', 'LG엔솔',
  '삼성SDI', 'Samsung SDI',
  '만도', 'HL만도', '현대모비스', '현대트랜시스', '현대위아', '현대케피코', '현대오토에버',
  'CATL', '파나소닉', 'Panasonic',
]

# 본문 섹션 헤더 매칭 패턴
OVERVIEW_PAT = re.compile(r'(회사의\s*개요|회사개요|일반\s*사항|기업의\s*개요|사업의\s*내용)')
CUSTOMERS_PAT = re.compile(r'(주요\s*매출처|주요\s*거래처|매출\s*비중|판매\s*경로)')

# 요약 길이 제한
SUMMARY_MIN = 50
SUMMARY_MAX = 300

# 본문 페치 옵션
FETCH_TIMEOUT = 30


# ── DART 본문 페치 ───────────────────────────────────────────────────────
def _list_recent_report(odr, corp_code: str, kind: str) -> str | None:
  """가장 최근 보고서 rcpt_no 반환. kind ∈ {'사업보고서','감사보고서'}.
  final=False — [기재정정] 보고서를 포함해 조회한다. 기본 final=True 는 정정된
  보고서가 안 잡혀 일부 회사가 누락되는 사례 발견.
  """
  try:
    df = odr.list(corp_code, kind='A', start='2022-01-01', final=False)
  except Exception as e:
    logger.debug(f'list({corp_code}) 실패: {e}')
    return None
  if df is None or df.empty:
    return None
  for _, row in df.iterrows():
    rpt = str(row.get('report_nm', ''))
    if kind in rpt:
      return str(row['rcept_no'])
  return None


def _fetch_main_html(odr, rcpt_no: str) -> BeautifulSoup | None:
  """sub_docs 메인 문서 HTML soup 반환."""
  url = _get_main_doc_url(odr, rcpt_no)
  if not url:
    return None
  try:
    r = requests.get(url, headers=HEADERS, timeout=FETCH_TIMEOUT)
    return BeautifulSoup(r.content, 'html.parser')
  except Exception as e:
    logger.debug(f'fetch_main_html 실패 ({url}): {e}')
    return None


def _fetch_business_report_html(odr, corp_code: str) -> BeautifulSoup | None:
  """상장사 사업보고서 본문 soup. 실패 시 None."""
  rcpt = _list_recent_report(odr, corp_code, '사업보고서')
  return _fetch_main_html(odr, rcpt) if rcpt else None


def _fetch_audit_report_html(odr, corp_code: str) -> BeautifulSoup | None:
  """비상장사 결산감사보고서 본문 soup. 가장 최근 회계연도 우선."""
  for y in (2024, 2023, 2022):
    rcpt = _get_audit_rcpt(odr, corp_code, y)
    if rcpt:
      soup = _fetch_main_html(odr, rcpt)
      if soup:
        return soup
  return None


# ── 텍스트 추출 ──────────────────────────────────────────────────────────
def _extract_section_text(soup: BeautifulSoup, pattern: re.Pattern) -> str:
  """헤더 패턴 첫 매칭 이후 ~1500자 텍스트 추출 (다음 섹션 시작 직전까지)."""
  if soup is None:
    return ''
  full = soup.get_text(separator=' ', strip=True)
  m = pattern.search(full)
  if not m:
    return ''
  start = m.end()
  chunk = full[start:start + 1500]
  return chunk.strip()


def _summarize(text: str) -> str:
  """원문 → 100~300자 한국어 요약. 첫 2~3문장 기준 룰 추출."""
  if not text:
    return ''
  cleaned = re.sub(r'\s+', ' ', text).strip()
  # 한국어 종결어미(다. / 음.) 기준 분할
  sentences = re.split(r'(?<=[다음음함됨임음])\.\s+', cleaned)
  out = ''
  for s in sentences:
    if len(out) + len(s) + 2 > SUMMARY_MAX:
      break
    out += s.strip() + '. '
    if len(out) >= 100:
      break
  return out.strip()[:SUMMARY_MAX]


def _extract_customers(text: str) -> list[dict]:
  """본문 텍스트에서 KNOWN_OEMS 매칭 토큰 추출 → [{'name': X}] dedup."""
  if not text:
    return []
  found: list[str] = []
  seen: set[str] = set()
  for oem in KNOWN_OEMS:
    if oem in text and oem not in seen:
      # 동일 OEM 변형은 대표명으로 통일 (예: '현대자동차' → '현대차')
      canonical = _canonical_oem(oem)
      if canonical not in seen:
        found.append(canonical)
        seen.add(canonical)
  return [{'name': name} for name in found]


def _canonical_oem(oem: str) -> str:
  """OEM 변형을 대표명으로 통일."""
  mapping = {
    '현대자동차': '현대차', '제네시스': '현대차',
    '지엠': 'GM', '제너럴모터스': 'GM', '쉐보레': 'GM',
    'Ford': '포드',
    'VW': '폭스바겐', '아우디': '폭스바겐', '포르쉐': '폭스바겐',
    'Mercedes': '벤츠', '메르세데스': '벤츠',
    '비야디': 'BYD',
    'Tesla': '테슬라',
    '크라이슬러': 'Stellantis', '지프': 'Stellantis', 'Jeep': 'Stellantis', '스텔란티스': 'Stellantis',
    'Renault': '르노',
    'Nissan': '닛산',
    'Toyota': '도요타',
    'Honda': '혼다',
    'SK on': '에스케이온', 'SK온': '에스케이온',
    'LGES': 'LG에너지솔루션', 'LG엔솔': 'LG에너지솔루션',
    'Samsung SDI': '삼성SDI',
    'HL만도': '만도',
    'Panasonic': '파나소닉',
  }
  return mapping.get(oem, oem)


# ── Playwright 폴백 ─────────────────────────────────────────────────────
def _web_search_summary(name_kr: str) -> tuple[str, str, str]:
  """Playwright headless로 네이버/구글 검색해 회사 소개 + 거래처 정보 추출.

  네이버에서 회사소개 + 거래처 두 쿼리 검색하여 텍스트 합산 → customers 매칭에 활용.

  Returns: (summary_text, full_search_text, source_label)
  실패 시 ('', '', '')
  """
  try:
    from playwright.sync_api import sync_playwright
  except ImportError:
    logger.error('playwright 미설치')
    return '', '', ''

  with sync_playwright() as pw:
    try:
      browser = pw.chromium.launch(headless=True)
      page = browser.new_page(viewport={'width': 1280, 'height': 800})

      # 1차: 네이버 회사소개 + 거래처 쿼리 두 번 (customers 매칭률 향상 목적)
      naver_text = ''
      for q in (f'{name_kr} 자동차부품 회사소개', f'{name_kr} 주요거래처 매출처'):
        try:
          page.goto(f'https://search.naver.com/search.naver?query={q}', timeout=15_000)
          page.wait_for_selector('#main_pack', timeout=5_000)
          loc = page.locator('#main_pack').first
          if loc.count() > 0:
            raw = loc.inner_text(timeout=3_000)
            naver_text += ' ' + re.sub(r'\s+', ' ', raw).strip()
        except Exception:
          continue

      summary = ''
      full_text = naver_text[:5000]
      source = ''
      if len(naver_text) >= SUMMARY_MIN:
        summary = _summarize(naver_text)
        source = 'naver'

      # 1차 부족 시 구글 폴백
      if len(summary) < SUMMARY_MIN:
        try:
          page.goto(f'https://www.google.com/search?q={name_kr}+자동차부품+회사소개', timeout=15_000)
          page.wait_for_selector('#search', timeout=5_000)
          raw = page.locator('#search').first.inner_text(timeout=3_000) if page.locator('#search').count() else ''
          gtxt = re.sub(r'\s+', ' ', raw).strip()
          if len(gtxt) >= SUMMARY_MIN:
            summary = _summarize(gtxt)
            full_text += ' ' + gtxt[:3000]
            source = 'google'
        except Exception:
          pass

      browser.close()
      return summary, full_text, source
    except Exception as e:
      logger.debug(f'web_search 실패 ({name_kr}): {e}')
  return '', '', ''


# ── 단일 회사 처리 ─────────────────────────────────────────────────────
def _process_listed(odr, corp_code: str, name_kr: str) -> tuple[str, list[dict]]:
  """상장사: 사업보고서 본문에서 사업 설명 + customers 추출."""
  soup = _fetch_business_report_html(odr, corp_code)
  if soup is None:
    return '', []
  full_text = soup.get_text(separator=' ', strip=True)
  overview = _extract_section_text(soup, OVERVIEW_PAT)
  summary = _summarize(overview) if overview else _summarize(full_text[:1500])
  customers_section = _extract_section_text(soup, CUSTOMERS_PAT)
  customers = _extract_customers(customers_section + ' ' + full_text[:5000])
  return summary, customers


def _process_unlisted(odr, corp_code: str, name_kr: str) -> tuple[str, list[dict], str]:
  """비상장사: 감사보고서 1차 → Playwright 폴백.

  Returns: (summary, customers, source)  source ∈ {'audit','naver','google',''}
  """
  soup = _fetch_audit_report_html(odr, corp_code)
  customers: list[dict] = []
  summary = ''
  source = ''
  if soup is not None:
    full_text = soup.get_text(separator=' ', strip=True)
    overview = _extract_section_text(soup, OVERVIEW_PAT)
    summary = _summarize(overview) if overview else _summarize(full_text[:1500])
    customers_section = _extract_section_text(soup, CUSTOMERS_PAT)
    customers = _extract_customers(customers_section + ' ' + full_text[:5000])
    if summary:
      source = 'audit'

  if len(summary) < SUMMARY_MIN or not customers:
    web_summary, web_full_text, web_source = _web_search_summary(name_kr)
    if web_summary and len(summary) < SUMMARY_MIN:
      summary = web_summary
      source = web_source
    if not customers and web_full_text:
      customers = _extract_customers(web_full_text)
  return summary, customers, source


# ── 메인 ────────────────────────────────────────────────────────────────
def _flush_company(client, cid: str, summary: str, customers: list[dict], also_summary: bool, also_customers: bool) -> None:
  """단일 회사 결과 즉시 UPDATE."""
  patch: dict = {}
  if also_summary and summary:
    patch['business_summary'] = summary
  if also_customers and customers:
    patch['customers'] = customers
  if patch:
    client.table('companies').update(patch).eq('id', cid).execute()


def collectDartSummary() -> None:
  """data_source 분기로 business_summary/customers 보강."""
  odr = _get_dart()
  if not odr:
    sys.exit(1)
  client = get_client()
  manual = _load_manual_mapping()

  # 대상: domestic 페이지 active 회사 중 보강 필요
  resp = (
    client.table('companies')
    .select('id,ticker,name_kr,data_source,business_summary,customers,company_pages!inner(page)')
    .eq('status', 'active')
    .eq('company_pages.page', 'domestic')
    .execute()
  )
  rows = resp.data or []

  pending = []
  for r in rows:
    need_summary = not r.get('business_summary')
    cust = r.get('customers')
    need_customers = not cust or (isinstance(cust, list) and len(cust) == 0)
    if need_summary or need_customers:
      r['_need_summary'] = need_summary
      r['_need_customers'] = need_customers
      pending.append(r)

  logger.info(f'대상 {len(rows)}개 / 보강 필요 {len(pending)}개')

  for idx, c in enumerate(pending, 1):
    cid: str = c['id']
    ticker: str = c['ticker']
    name: str = c['name_kr']
    data_source: str = c.get('data_source', '')
    need_s: bool = c['_need_summary']
    need_c: bool = c['_need_customers']

    try:
      corp_code = _resolve_corp_code(odr, name, ticker, manual)
      if not corp_code:
        logger.warning(f'[{idx}/{len(pending)}] [{ticker}] {name}: corp_code 없음')
        continue

      if data_source == 'fnguide':
        summary, customers = _process_listed(odr, corp_code, name)
        source = 'business_report'
      else:
        summary, customers, source = _process_unlisted(odr, corp_code, name)

      _flush_company(client, cid, summary, customers, need_s, need_c)
      logger.info(
        f'[{idx}/{len(pending)}] [{ticker}] {name}({data_source}): '
        f'summary {len(summary)}자 [{source}] / customers {len(customers)}개'
      )
    except Exception as e:
      logger.error(f'[{idx}/{len(pending)}] [{ticker}] {name}: 예외 {type(e).__name__}: {e}')
      continue


if __name__ == '__main__':
  try:
    collectDartSummary()
  except Exception as e:
    logger.error(f'DART summary 수집 실패: {e}')
    sys.exit(1)
