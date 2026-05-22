"""#13 회사 제품·고객사 일괄 재수집 — Anthropic Sonnet 4.6 + Playwright.

각 회사의:
- products: jsonb 배열 [{name, category?}]
- customers: jsonb 배열 [{name}]

1차 출처(홈페이지/검색)에서 검증된 내용만. DART 제외.

사용:
  TARGET_NAMES="한세모빌리티" python scripts/enrich_products_customers_sonnet.py
"""
import json
import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

import anthropic  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

from lib.db import get_client  # noqa: E402

# 사용자 정책 (2026-05-12): Sonnet 비용 우려로 Haiku 4.5 사용.
DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
TEXT_DIR = Path(__file__).parent / '_tmp' / 'company_texts'
TEXT_DIR.mkdir(exist_ok=True, parents=True)

TOOL_EXTRACT = {
    'name': 'submit_products_customers',
    'description': '회사의 주요 제품과 고객사를 1차 출처에서 추출. 추측 금지.',
    'input_schema': {
        'type': 'object',
        'properties': {
            'products': {
                'type': 'array',
                'description': '제품 또는 사업 영역 한국어 배열 (예: ["드라이브샤프트", "등속조인트"])',
                'items': {
                    'type': 'object',
                    'properties': {
                        'name': {'type': 'string', 'description': '제품/사업 명 (한국어)'},
                        'category': {'type': 'string', 'description': '대분류 (예: 구동계, 조향, 제동, 전장)'},
                    },
                    'required': ['name'],
                },
            },
            'customers': {
                'type': 'array',
                'description': '주요 고객사/거래처 한국어 배열 (예: [{"name": "현대차"}, {"name": "기아"}])',
                'items': {
                    'type': 'object',
                    'properties': {
                        'name': {'type': 'string', 'description': '고객사명 (한국어 표기 우선)'},
                    },
                    'required': ['name'],
                },
            },
            'sources': {
                'type': 'array',
                'items': {'type': 'string'},
                'description': '사용한 출처 URL/출처명',
            },
        },
        'required': ['products', 'customers', 'sources'],
    },
}


def _anthropic_web_search(llm, query: str, max_uses: int = 1) -> str | None:
    """Anthropic web_search server tool로 Google 검색 우회 — 봇 차단 없음."""
    try:
        resp = llm.messages.create(
            model=DEFAULT_MODEL,
            max_tokens=2048,
            tools=[{
                'type': 'web_search_20250305',
                'name': 'web_search',
                'max_uses': max_uses,
            }],
            messages=[{'role': 'user', 'content': f'다음 회사 정보 한국어 검색 결과 요약: {query}'}],
        )
        out = []
        for block in resp.content:
            if getattr(block, 'type', None) == 'text':
                out.append(block.text)
        return '\n'.join(out) if out else None
    except Exception as e:
        logger.warning(f'Anthropic WebSearch 실패: {e}')
        return None


def fetch_text(page, c, llm=None):
    """텍스트 캐시 우선, 없으면 새로 수집.
    한국 회사: Naver, 외국 회사: Anthropic WebSearch (Google 기반, Bing 금지)
    """
    cache = TEXT_DIR / f'{c["id"]}.txt'
    if cache.exists() and cache.stat().st_size > 200:
        return cache.read_text(encoding='utf-8')
    parts = [f'=== 회사: {c["name_kr"]} ({c.get("name") or ""}) ===']
    if c.get('homepage_url'):
        try:
            page.goto(c['homepage_url'], timeout=15_000)
            page.wait_for_load_state('domcontentloaded', timeout=10_000)
            page.wait_for_timeout(1500)
            txt = page.locator('body').inner_text(timeout=3_000)
            txt = re.sub(r'\s{2,}', ' ', txt)[:4000]
            parts.append(f'\n=== HOMEPAGE ===\n{txt}')
        except Exception:
            pass
    is_kr = c.get('country') == 'KR'
    q1 = f'{c["name_kr"]} 주요 제품' if is_kr else f'{c.get("name") or c["name_kr"]} products business'
    q2 = f'{c["name_kr"]} 거래처 고객사' if is_kr else f'{c.get("name") or c["name_kr"]} customers OEM clients'
    for q in [q1, q2]:
        try:
            if is_kr:
                page.goto(f'https://search.naver.com/search.naver?query={q}', timeout=15_000)
                page.wait_for_selector('#main_pack', timeout=5_000)
                txt = page.locator('#main_pack').first.inner_text(timeout=3_000)
                parts.append(f'\n=== NAVER: {q} ===\n{re.sub(r"\\s{2,}", " ", txt)[:3000]}')
            elif llm:
                # 외국 회사: Anthropic WebSearch (Bing 금지 정책 2026-05-12)
                txt = _anthropic_web_search(llm, q)
                if txt:
                    parts.append(f'\n=== GOOGLE (WebSearch): {q} ===\n{txt[:3000]}')
            time.sleep(0.6)
        except Exception:
            continue
    combined = '\n'.join(parts)
    cache.write_text(combined, encoding='utf-8')
    return combined


def extract(llm, text: str, name_kr: str, description: str | None = None) -> dict | None:
    """검색 텍스트 + (선택) description을 LLM 입력으로 사용.
    description은 1차 출처(fnguide/yfinance/홈페이지) 기반이라 거래처 명시가 많음.
    """
    desc_section = ''
    if description and len(description) >= 50:
        desc_section = f"=== 회사 설명 (1차 출처 기반) ===\n{description}\n\n"

    prompt = (
        f"다음은 회사 '{name_kr}'의 정보 자료입니다. "
        "회사 설명(1차 출처) + 홈페이지/검색 결과에서 검증된 제품과 고객사만 추출하세요. "
        "검증되지 않은 내용은 절대 포함하지 마세요. DART는 사용하지 마세요.\n\n"
        f"{desc_section}"
        f"=== 홈페이지/검색 자료 ===\n{text}\n=== 끝 ===\n\n"
        "submit_products_customers 도구를 호출하세요."
    )
    resp = llm.messages.create(
        model=DEFAULT_MODEL,
        max_tokens=2048,
        tools=[TOOL_EXTRACT],
        tool_choice={'type': 'tool', 'name': 'submit_products_customers'},
        messages=[{'role': 'user', 'content': prompt}],
    )
    for block in resp.content:
        if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_products_customers':
            return dict(block.input)
    return None


def main():
    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        sys.exit('ANTHROPIC_API_KEY 미설정')

    target_raw = os.environ.get('TARGET_NAMES', '').strip()
    target = {t.strip() for t in target_raw.split(',') if t.strip()}

    # OEM whitelist + 별칭 매핑 import
    sys.path.insert(0, str(Path(__file__).parent / '_tmp'))
    from lib.normalize_customers_oem_only import ALIAS_TO_STANDARD, _extract_name, _normalize_one  # noqa

    client = get_client()
    rows = client.table('companies').select('id,name_kr,name,country,homepage_url,customers,products,business_summary,company_type').eq('status', 'active').execute().data
    only_empty_customers = os.environ.get('ONLY_EMPTY_CUSTOMERS', '').strip() == '1'
    only_empty_products = os.environ.get('ONLY_EMPTY_PRODUCTS', '').strip() == '1'
    if target:
        rows = [r for r in rows if r['name_kr'] in target]
    elif only_empty_products:
        # products 빈 회사만 (OEM 본사 제외)
        rows = [r for r in rows
                if (not r.get('products') or len(r.get('products') or []) == 0)
                and r.get('company_type') != 'OEM']
        rows.sort(key=lambda r: r['name_kr'])
    elif only_empty_customers:
        # customers 빈 부품사만 (OEM 본사는 자기 자신이 OEM이라 customers 0 정상)
        rows = [r for r in rows
                if (not r.get('customers') or len(r.get('customers') or []) == 0)
                and r.get('company_type') != 'OEM']
        rows.sort(key=lambda r: r['name_kr'])
    else:
        # 우선순위: products가 비어있는 회사 먼저 처리
        def priority(r):
            has_products = r.get('products') and len(r.get('products') or []) > 0
            return (1 if has_products else 0, r['name_kr'])
        rows = sorted(rows, key=priority)

    logger.info(f'대상: {len(rows)}개, model={DEFAULT_MODEL}')
    llm = anthropic.Anthropic(api_key=api_key)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
            viewport={'width': 1280, 'height': 900},
            locale='ko-KR',
        )
        page = ctx.new_page()

        for i, c in enumerate(rows, 1):
            name = c['name_kr']
            logger.info(f'[{i}/{len(rows)}] {name}')
            try:
                text = fetch_text(page, c, llm=llm)
                desc = c.get('business_summary') or ''
                # 텍스트 부족 시 description으로 보완 — description이 100자 이상이면 LLM 처리 진행
                if len(text) < 200:
                    if len(desc) >= 100:
                        logger.info(f'  텍스트 부족({len(text)}) — description({len(desc)}자)으로 LLM 처리 진행')
                    else:
                        logger.warning(f'  텍스트 부족 + description 부족 — 스킵')
                        continue
                # description을 LLM 입력에 포함 — 거래처/제품 추출 누락 방지
                result = extract(llm, text, name, description=desc)
                if not result:
                    logger.warning('  Sonnet 응답 없음')
                    continue
                new_products = result.get('products') or []
                new_customers_raw = result.get('customers') or []

                # === 사용자 정책: customers는 기존 보존 + 보완, OEM만 ===
                # 1) 기존 customers를 OEM 표준명으로 정규화
                existing_oems: list[str] = []
                for item in (c.get('customers') or []):
                    nm = _extract_name(item)
                    std = _normalize_one(nm) if nm else None
                    if std and std not in existing_oems:
                        existing_oems.append(std)
                # 2) Sonnet/Haiku 결과에서 추출한 customers를 OEM 표준명으로 정규화 + 기존에 추가
                for item in new_customers_raw:
                    nm = _extract_name(item)
                    std = _normalize_one(nm) if nm else None
                    if std and std not in existing_oems:
                        existing_oems.append(std)
                # 3) string array로 저장 (CustomerBadges는 둘 다 지원하지만 표준화)
                final_customers = existing_oems

                # products는 LLM 결과로 교체 (기존 데이터 보강 의도)
                update = {'products': new_products, 'customers': final_customers}
                client.table('companies').update(update).eq('id', c['id']).execute()
                logger.info(f'  ✓ products={len(new_products)} customers={len(final_customers)} (OEM only) sources={result.get("sources", [])[:2]}')
            except Exception as e:
                logger.error(f'  예외: {e}')
            time.sleep(1.0)

        browser.close()

    # Next.js 캐시 무효화 — client.table().update()로 companies.products/customers 우회 갱신
    try:
        from lib.revalidate import revalidate_for_tables
        revalidate_for_tables(['companies'])
    except Exception as e:
        logger.debug(f'  revalidate skip: {e}')


if __name__ == '__main__':
    main()
