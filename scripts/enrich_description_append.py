"""200자 미만 description 보완 (사용자 정책 2026-05-12).

정책:
- 상장사 (data_source='fnguide' or 'yfinance'): 기존 description 절대 변경 금지.
  추가 정보를 별도 문장으로 append.
- 비상장사 (data_source='dart' or 'marklines'): 자유 보완 (재작성 OK).

대상: status='active' AND LENGTH(business_summary) < 200

사용:
  python scripts/enrich_description_append.py
"""
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

import anthropic  # noqa: E402

from lib.db import get_client  # noqa: E402
from lib.text import is_rejection_response, strip_citation_tags  # noqa: E402

DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

TOOL_DESCRIPTION = {
    'name': 'submit_description',
    'description': '회사 description을 1차 출처에서 검증된 내용으로 작성.',
    'input_schema': {
        'type': 'object',
        'properties': {
            'description': {'type': 'string', 'description': '한국어 회사 설명 200~400자.'},
            'sources': {'type': 'array', 'items': {'type': 'string'}},
        },
        'required': ['description', 'sources'],
    },
}


def web_search_company(llm, query: str) -> str | None:
    """Anthropic web_search로 회사 정보 검색."""
    try:
        resp = llm.messages.create(
            model=DEFAULT_MODEL,
            max_tokens=3000,
            tools=[{
                'type': 'web_search_20250305',
                'name': 'web_search',
                'max_uses': 2,
            }],
            messages=[{'role': 'user', 'content': f'다음 회사에 대해 한국어 검색 결과 5건 요약: {query}'}],
        )
        out = []
        for block in resp.content:
            if getattr(block, 'type', None) == 'text':
                out.append(block.text)
        return '\n'.join(out) if out else None
    except Exception as e:
        logger.warning(f'WebSearch 실패: {e}')
        return None


def enrich_listed(llm, existing: str, web_text: str, name_kr: str) -> str | None:
    """상장사 (fnguide/yfinance) 정책: 기존 description 절대 보존 + 추가 문장 append.
    Haiku에게 기존 description은 그대로 두고 추가 문장만 작성하라고 지시.
    """
    prompt = (
        f"회사: {name_kr}\n\n"
        f"=== 기존 description (절대 변경 금지) ===\n{existing}\n\n"
        f"=== 추가 정보 (인터넷 검색) ===\n{web_text}\n\n"
        "위 기존 description은 그대로 보존하고, **그 뒤에 이어 붙일 1~3 문장**을 작성하세요. "
        "추가 문장은 기존 description에서 누락된 정보 (예: 본사 위치, 설립연도, 주요 제품, "
        "거래처, 최근 사업 동향, 매출/규모) 중 검증된 사실만 포함합니다. "
        "1차 출처에서 확인된 정보만 사용. 추측 절대 금지.\n\n"
        "submit_description 도구의 description 필드에 [기존 description + 공백 + 추가 문장] 전체를 제출하세요."
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
                result = dict(block.input).get('description')
                # 안전장치: 기존 description이 결과에 포함되어 있는지 확인
                if result and existing[:50] in result:
                    return result
                else:
                    logger.warning(f'{name_kr}: 기존 description 보존 안 됨, 강제로 prefix 추가')
                    if result:
                        return f'{existing} {result}'
    except Exception as e:
        logger.warning(f'{name_kr} enrich_listed 실패: {e}')
    return None


def enrich_unlisted(llm, web_text: str, name_kr: str) -> str | None:
    """비상장사 (dart/marklines) 정책: 자유 보완 (재작성 OK)."""
    prompt = (
        f"회사: {name_kr}\n\n"
        f"=== 검색 결과 텍스트 ===\n{web_text}\n\n"
        "위 자료를 바탕으로 정확한 한국어 description 200~400자 작성. "
        "1차 출처에서 검증된 사실만. 추측 절대 금지. "
        "포함 정보: 설립연도, 본사 위치, 주요 제품/사업 영역, 주요 거래처, 최근 사업 동향."
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
        logger.warning(f'{name_kr} enrich_unlisted 실패: {e}')
    return None


def main():
    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        sys.exit('ANTHROPIC_API_KEY 미설정')

    client = get_client()
    rows = (
        client.table('companies')
        .select('id,name_kr,name,country,data_source,business_summary')
        .eq('status', 'active')
        .execute().data
    )
    targets = [r for r in rows if r.get('business_summary') and len(r['business_summary']) < 200]
    logger.info(f'대상: {len(targets)}개 (200자 미만)')

    llm = anthropic.Anthropic(api_key=api_key)
    now_iso = datetime.now(timezone.utc).isoformat()

    for i, c in enumerate(targets, 1):
        name = c['name_kr']
        src = c.get('data_source')
        existing = c['business_summary']
        old_len = len(existing)
        logger.info(f'[{i}/{len(targets)}] {name} ({src}, {old_len}자)')

        # 검색 쿼리
        is_kr = c.get('country') == 'KR'
        if is_kr:
            query = f'{name} 회사 소개 주요 제품 본사 거래처 설립'
        else:
            query = f'{c.get("name") or name} company headquarters products customers OEM'

        try:
            web_text = web_search_company(llm, query)
            if not web_text or len(web_text) < 200:
                logger.warning('  WebSearch 결과 부족 — 스킵')
                continue

            if src in ('fnguide', 'yfinance'):
                # 상장사: 기존 보존 + append
                new_desc = enrich_listed(llm, existing, web_text, name)
            else:
                # 비상장사: 자유 보완
                new_desc = enrich_unlisted(llm, web_text, name)

            if not new_desc or len(new_desc) < 50:
                logger.warning(f'  생성 실패')
                continue

            new_desc = strip_citation_tags(new_desc) or new_desc
            if is_rejection_response(new_desc):
                logger.warning(f'  거부 응답 — 저장 skip')
                continue
            client.table('companies').update({
                'business_summary': new_desc,
                'summary_updated_at': now_iso,
            }).eq('id', c['id']).execute()
            logger.info(f'  ✓ {old_len}자 → {len(new_desc)}자')
        except Exception as e:
            logger.error(f'  예외: {e}')
        time.sleep(0.5)


if __name__ == '__main__':
    main()
