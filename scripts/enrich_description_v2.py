"""#12 회사 description 통합 수집 로직 v2 (2026-05-12 정책 반영).

데이터 출처별 우선순위:
  - data_source='fnguide':  1차 fnguide Snapshot bizSummaryContent  → 2차 홈페이지+검색
  - data_source='yfinance': 1차 yfinance.info.longBusinessSummary → Haiku 번역 → 2차 홈페이지+검색
  - data_source='dart':     홈페이지 + Naver 검색 → Haiku 추출 (DART 사업보고서 제외 — 사용자 정책)
  - data_source='marklines': marklines profile + 홈페이지 → Haiku 추출 → 2차 Bing

원칙: 1차 출처에서 >=100자 충분히 확보되면 2차 건너뜀. 출처별 표준 워크플로 우선.

사용:
  TARGET_NAMES="한세모빌리티" python scripts/enrich_description_v2.py
"""
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
import yfinance as yf  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

from lib import fnguide_client as fng  # noqa: E402
from lib.db import WriteSession  # noqa: E402
from lib.fnguide_guard import is_fnguide_fallback  # noqa: E402
from lib.text import is_rejection_response, strip_citation_tags  # noqa: E402

# 사용자 정책: Haiku 4.5 (비용 절감)
DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
MIN_LEN_THRESHOLD = 100  # 1차 출처가 이 길이 미만이면 2차 보완 진행

# fnguide 신버전(wcomp). 구 comp.fnguide.com은 폐지돼 전 경로가 HTTP 200 안내 페이지다.
# 기업개요 셀렉터(ul#bizSummaryContent, #giName)는 신버전에서도 그대로 유효하다.
FNGUIDE_SNAPSHOT_URL = f'{fng.BASE_URL}/CompanyInfo/Snapshot?cmp_cd={{cmp_cd}}'


def _to_cmp_cd(ticker: str) -> str:
    """종목코드를 fnguide 신버전 파라미터 형식(6자리, 접두어 없음)으로 정규화한다."""
    return str(ticker).strip().zfill(6)


# ─────────────────────────────────────────────────────────────
# 1차 출처별 수집 함수
# ─────────────────────────────────────────────────────────────

def fetch_fnguide_summary(page, ticker: str) -> str | None:
    """fnguide Snapshot 페이지에서 회사 개요 텍스트 추출."""
    try:
        url = FNGUIDE_SNAPSHOT_URL.format(cmp_cd=_to_cmp_cd(ticker))
        page.goto(url, timeout=30_000)
        page.wait_for_load_state('networkidle', timeout=20_000)
        page.wait_for_timeout(2500)
        # 페이지 신원: 로그인 없는 세션은 fnguide가 기본 페이지(삼성전자)를 반환할 수 있다.
        gi_name = page.evaluate(
            "() => (document.querySelector('#giName')?.innerText || '').trim()"
        )
        items = page.evaluate("""
            () => Array.from(
                document.querySelectorAll('ul#bizSummaryContent li')
            ).map(li => li.innerText.trim()).filter(t => t.length > 0)
        """)
        if not items:
            return None
        text = ' '.join(items)
        if is_fnguide_fallback(text, ticker, gi_name):
            logger.warning(f'fnguide {ticker}: 폴백 페이지(삼성전자 기본) 감지 — 저장 skip')
            return None
        return text
    except Exception as e:
        logger.debug(f'fnguide {ticker} 실패: {e}')
        return None


def fetch_yfinance_summary(ticker: str) -> str | None:
    """yfinance.info.longBusinessSummary (영문) 추출."""
    try:
        info = yf.Ticker(ticker).info
        return info.get('longBusinessSummary')
    except Exception as e:
        logger.debug(f'yfinance {ticker} 실패: {e}')
        return None


def translate_summary(llm, en_text: str, name_kr: str) -> str | None:
    """yfinance 영문 요약 → Haiku로 한국어 비즈니스 요약 재작성."""
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
        msg = llm.messages.create(
            model=DEFAULT_MODEL, max_tokens=600,
            messages=[{'role': 'user', 'content': prompt}],
        )
        return msg.content[0].text.strip()
    except Exception as e:
        logger.warning(f'{name_kr} Haiku 번역 실패: {e}')
        return None


# ─────────────────────────────────────────────────────────────
# 2차 보완: 홈페이지 + 네이버/Bing 검색 + Haiku 추출
# ─────────────────────────────────────────────────────────────

TOOL_DESCRIPTION = {
    'name': 'submit_description',
    'description': '회사의 정확한 한국어 description을 1차 출처(홈페이지/검색)에서 검증된 내용으로 작성.',
    'input_schema': {
        'type': 'object',
        'properties': {
            'description': {'type': 'string', 'description': '한국어 회사 설명 200~400자.'},
            'sources': {'type': 'array', 'items': {'type': 'string'}},
        },
        'required': ['description', 'sources'],
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
            messages=[{'role': 'user', 'content': f'다음 회사에 대해 한국어 검색 결과 5개 요약: {query}'}],
        )
        out = []
        for block in resp.content:
            if getattr(block, 'type', None) == 'text':
                out.append(block.text)
        return '\n'.join(out) if out else None
    except Exception as e:
        logger.warning(f'Anthropic WebSearch 실패: {e}')
        return None


def fetch_web_text(page, c, llm=None) -> str:
    """홈페이지 + 검색 텍스트 합치기.
    - 홈페이지: Playwright
    - 한국 회사: Naver 검색 (Playwright)
    - 외국 회사: Anthropic WebSearch (Google 기반, 봇 차단 우회)
    사용자 정책 2026-05-12: Bing 사용 금지, Google 또는 WebSearch.
    """
    parts = [f'=== 회사: {c["name_kr"]} ({c.get("name") or ""}) ===']
    if c.get('homepage_url'):
        try:
            page.goto(c['homepage_url'], timeout=15_000)
            page.wait_for_load_state('domcontentloaded', timeout=10_000)
            page.wait_for_timeout(1500)
            txt = page.locator('body').inner_text(timeout=3_000)
            parts.append(f'\n=== HOMEPAGE ===\n{re.sub(r"\\s{2,}", " ", txt)[:4000]}')
        except Exception:
            pass
    is_kr = c.get('country') == 'KR'
    if is_kr:
        # 한국 회사: Naver 검색 (한국어 정보 풍부)
        q = f'{c["name_kr"]} 회사 소개 주요 제품'
        try:
            page.goto(f'https://search.naver.com/search.naver?query={q}', timeout=15_000)
            page.wait_for_selector('#main_pack', timeout=5_000)
            txt = page.locator('#main_pack').first.inner_text(timeout=3_000)
            parts.append(f'\n=== NAVER ===\n{re.sub(r"\\s{2,}", " ", txt)[:3000]}')
        except Exception:
            pass
    else:
        # 외국 회사: Anthropic WebSearch (Google 기반)
        if llm:
            q = f'{c.get("name") or c["name_kr"]} company business products customers'
            txt = _anthropic_web_search(llm, q)
            if txt:
                parts.append(f'\n=== GOOGLE (WebSearch) ===\n{txt[:3000]}')
    return '\n'.join(parts)


def haiku_extract(llm, text: str, name_kr: str) -> str | None:
    """Haiku에 텍스트 주고 description 추출."""
    prompt = (
        f"다음은 회사 '{name_kr}'의 홈페이지/검색 결과 텍스트입니다. "
        "1차 출처에서 검증된 사실로만 한국어 description 200~400자 작성. "
        "DART 사업보고서 사용 금지. 추측 절대 금지.\n\n"
        f"=== 자료 ===\n{text}\n=== 끝 ==="
    )
    try:
        resp = llm.messages.create(
            model=DEFAULT_MODEL, max_tokens=2048,
            tools=[TOOL_DESCRIPTION],
            tool_choice={'type': 'tool', 'name': 'submit_description'},
            messages=[{'role': 'user', 'content': prompt}],
        )
        for block in resp.content:
            if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_description':
                return dict(block.input).get('description')
    except Exception as e:
        logger.warning(f'{name_kr} Haiku 추출 실패: {e}')
    return None


# ─────────────────────────────────────────────────────────────
# 메인: 출처별 분기
# ─────────────────────────────────────────────────────────────

def main():
    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        sys.exit('ANTHROPIC_API_KEY 미설정')

    target_raw = os.environ.get('TARGET_NAMES', '').strip()
    target = {t.strip() for t in target_raw.split(',') if t.strip()}

    with WriteSession() as w:
        _main_in_session(w, target, api_key)


def _main_in_session(w, target: set[str], api_key: str) -> None:
    rows = w.table('companies').select('id,name_kr,name,ticker,country,data_source,homepage_url,business_summary').eq('status', 'active').execute().data
    if target:
        rows = [r for r in rows if r['name_kr'] in target]

    logger.info(f'대상: {len(rows)}개, model={DEFAULT_MODEL}')
    llm = anthropic.Anthropic(api_key=api_key)
    now_iso = datetime.now(timezone.utc).isoformat()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
            viewport={'width': 1280, 'height': 900},
            locale='ko-KR',
        )
        page = ctx.new_page()

        for i, c in enumerate(rows, 1):
            name = c['name_kr']
            src = c.get('data_source')
            logger.info(f'[{i}/{len(rows)}] {name} ({src})')
            try:
                desc = None
                used_source = None
                yf_en = None  # yfinance 영문 원본 — 번역·2차 모두 실패 시 fallback

                # === 1차: data_source별 표준 출처 ===
                if src == 'fnguide' and c.get('ticker'):
                    desc = fetch_fnguide_summary(page, c['ticker'])
                    if desc:
                        used_source = 'fnguide'
                elif src == 'yfinance' and c.get('ticker'):
                    yf_en = fetch_yfinance_summary(c['ticker'])
                    if yf_en:
                        desc = translate_summary(llm, yf_en, name)
                        if desc and is_rejection_response(desc):
                            logger.warning(f'  {name}: 번역 결과가 거부 응답 — 폐기')
                            desc = None
                        if desc:
                            used_source = 'yfinance+Haiku'

                # === 2차: 1차가 부족하면 홈페이지+검색 → Haiku ===
                if not desc or len(desc) < MIN_LEN_THRESHOLD:
                    web_text = fetch_web_text(page, c, llm=llm)
                    if len(web_text) >= 200:
                        candidate = haiku_extract(llm, web_text, name)
                        if candidate and is_rejection_response(candidate):
                            logger.warning(f'  {name}: 2차 Haiku 결과가 거부 응답 — 폐기')
                        elif candidate:
                            desc = candidate
                            used_source = '홈페이지+검색+Haiku'

                # === 3차 fallback: yfinance 영문 원본을 그대로 보존 ===
                # 한국어 번역·홈페이지 검색 모두 실패해도 영문 원본이 있으면 빈 값보다 낫다.
                if (not desc or len(desc) < 30) and yf_en and len(yf_en) >= 50:
                    desc = yf_en.strip()
                    used_source = 'yfinance_en_raw'

                if not desc or len(desc) < 30:
                    logger.warning(f'  {name}: description 추출 실패')
                    continue

                desc = strip_citation_tags(desc) or desc
                if is_rejection_response(desc):
                    logger.warning(f'  {name}: 최종 description이 거부 응답 — 저장 skip')
                    continue
                w.table('companies').update({
                    'business_summary': desc,
                    'summary_updated_at': now_iso,
                }).eq('id', c['id']).execute()
                logger.info(f'  ✓ {len(desc)}자 (source={used_source})')
            except Exception as e:
                logger.error(f'  예외: {e}')
            time.sleep(0.8)

        browser.close()

    # WriteSession.__exit__이 자동으로 revalidate_for_tables(['companies'])를 호출한다.


if __name__ == '__main__':
    main()
