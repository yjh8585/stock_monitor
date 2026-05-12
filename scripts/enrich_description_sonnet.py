"""#12 회사 description 일괄 재작성 — Anthropic Sonnet 4.6 + Playwright 텍스트 수집.

1. Playwright로 회사별 홈페이지·네이버/Bing 검색 텍스트 수집
2. Sonnet 4.6 tool_use로 정확한 한국어 description 생성 (1차 출처 검증)
3. companies.business_summary 업데이트

사용:
  TARGET_NAMES="한세모빌리티,남양넥스모" python scripts/enrich_description_sonnet.py
  (없으면 전체 active 회사)
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

import anthropic  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

from lib.db import get_client  # noqa: E402

# 사용자 정책 (2026-05-12): Sonnet 비용 우려로 Haiku 4.5 사용. 환경변수 무시 강제.
DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
TEXT_DIR = Path(__file__).parent / '_tmp' / 'company_texts'
TEXT_DIR.mkdir(exist_ok=True, parents=True)

TOOL_DESCRIPTION = {
    'name': 'submit_description',
    'description': (
        '회사의 정확한 한국어 description을 1차 출처(홈페이지/공시) 검증된 내용으로 작성한다. '
        'DART 사업보고서는 사용하지 않는다. 추측 금지.'
    ),
    'input_schema': {
        'type': 'object',
        'properties': {
            'description': {
                'type': 'string',
                'description': (
                    '한국어 회사 설명 200~400자. 다음 포함: '
                    '①설립연도와 본사 위치 ②주요 제품/사업 영역 ③주요 거래처(있으면) '
                    '④최근 사업 동향. 검증 안 된 정보는 절대 추가 금지.'
                ),
            },
            'verified_facts': {
                'type': 'array',
                'items': {'type': 'string'},
                'description': '홈페이지/공시에서 확인된 사실들 (라인별)',
            },
            'sources': {
                'type': 'array',
                'items': {'type': 'string'},
                'description': '사용한 출처 URL 또는 출처명 (예: "홈페이지 회사소개", "Naver 뉴스 2025-03")',
            },
        },
        'required': ['description', 'verified_facts', 'sources'],
    },
}


def fetch_company_text(page, c):
    """홈페이지 + 네이버/Bing 검색 텍스트 수집."""
    parts = [f'=== 회사: {c["name_kr"]} ({c.get("name") or ""}) ===',
             f'국가: {c.get("country")}']
    if c.get('homepage_url'):
        url = c['homepage_url']
        try:
            page.goto(url, timeout=15_000)
            page.wait_for_load_state('domcontentloaded', timeout=10_000)
            page.wait_for_timeout(1500)
            txt = page.locator('body').inner_text(timeout=3_000)
            txt = re.sub(r'\s{2,}', ' ', txt)[:4000]
            parts.append(f'\n=== HOMEPAGE: {url} ===\n{txt}')
        except Exception as e:
            parts.append(f'\n=== HOMEPAGE ERROR: {e} ===')

    search_engine = 'naver' if c.get('country') == 'KR' else 'bing'
    queries = [f'{c["name_kr"]} 회사 소개 주요 제품', f'{c["name_kr"]} 주요 거래처']
    if c.get('country') != 'KR' and c.get('name'):
        queries = [f'{c["name"]} company products business', f'{c["name"]} customers OEM']

    for q in queries:
        try:
            if search_engine == 'naver':
                url = f'https://search.naver.com/search.naver?query={q}'
                page.goto(url, timeout=15_000)
                page.wait_for_selector('#main_pack', timeout=5_000)
                txt = page.locator('#main_pack').first.inner_text(timeout=3_000)
            else:
                url = f'https://www.bing.com/search?q={q.replace(" ", "+")}'
                page.goto(url, timeout=15_000)
                page.wait_for_selector('#b_results', timeout=5_000)
                txt = page.locator('#b_results').first.inner_text(timeout=3_000)
            txt = re.sub(r'\s{2,}', ' ', txt)[:3000]
            parts.append(f'\n=== {search_engine.upper()}: {q} ===\n{txt}')
            time.sleep(0.6)
        except Exception:
            continue

    return '\n'.join(parts)


def generate_description(llm, company_text: str, name_kr: str) -> dict | None:
    """Sonnet으로 description 생성."""
    prompt = (
        f"다음 텍스트는 회사 '{name_kr}'의 홈페이지/검색 결과입니다. "
        "이 자료를 기반으로 정확한 한국어 회사 description을 작성하세요. "
        "DART 사업보고서는 사용하지 마세요. 검증되지 않은 내용은 절대 추가하지 마세요.\n\n"
        f"=== 자료 ===\n{company_text}\n=== 끝 ===\n\n"
        "submit_description 도구를 호출해 결과를 제출하세요."
    )
    resp = llm.messages.create(
        model=DEFAULT_MODEL,
        max_tokens=2048,
        tools=[TOOL_DESCRIPTION],
        tool_choice={'type': 'tool', 'name': 'submit_description'},
        messages=[{'role': 'user', 'content': prompt}],
    )
    for block in resp.content:
        if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_description':
            return dict(block.input)
    return None


def main():
    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        sys.exit('ANTHROPIC_API_KEY 미설정')

    target_names_raw = os.environ.get('TARGET_NAMES', '').strip()
    target_names = {t.strip() for t in target_names_raw.split(',') if t.strip()}

    client = get_client()
    q = client.table('companies').select('id,name_kr,name,country,homepage_url,business_summary').eq('status', 'active')
    rows = q.execute().data
    if target_names:
        rows = [r for r in rows if r['name_kr'] in target_names]
    else:
        # 우선순위: business_summary가 없거나 100자 미만 회사부터
        rows = sorted(rows, key=lambda r: (len(r.get('business_summary') or ''), r['name_kr']))

    logger.info(f'대상: {len(rows)}개, model={DEFAULT_MODEL}')

    llm = anthropic.Anthropic(api_key=api_key)
    now_iso = datetime.now(timezone.utc).isoformat()

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
                text = fetch_company_text(page, c)
                # 캐시 — 디버그용
                (TEXT_DIR / f'{c["id"]}.txt').write_text(text, encoding='utf-8')
                if len(text) < 200:
                    logger.warning(f'  텍스트 부족 ({len(text)} chars) — 스킵')
                    continue
                result = generate_description(llm, text, name)
                if not result or not result.get('description'):
                    logger.warning('  Sonnet 응답 없음')
                    continue
                desc = result['description']
                client.table('companies').update({
                    'business_summary': desc,
                    'summary_updated_at': now_iso,
                }).eq('id', c['id']).execute()
                logger.info(f'  ✓ {len(desc)}자 | sources={result.get("sources", [])[:2]}')
            except Exception as e:
                logger.error(f'  예외: {e}')
            time.sleep(1.0)

        browser.close()


if __name__ == '__main__':
    main()
