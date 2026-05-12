"""Next.js 캐시 무효화 헬퍼.

데이터 수집 스크립트가 Supabase UPDATE/INSERT 후 호출하면
/api/revalidate API를 통해 cacheTag 무효화 → 사용자 페이지 즉시 최신 데이터 반영.

환경변수 (scripts/.env 또는 .env.local):
  NEXT_REVALIDATE_URL=http://localhost:3000/api/revalidate   # dev
  NEXT_REVALIDATE_URL=https://example.com/api/revalidate     # prod
  NEXT_REVALIDATE_SECRET=<강력한 임의 문자열>

사용:
  from lib.revalidate import revalidate_tags
  revalidate_tags(['related_stocks_view'])         # 특정 태그
  revalidate_tags(['all'])                         # 모든 페이지
"""
import os
from loguru import logger

try:
    import requests
except ImportError:  # 옵션 의존
    requests = None


# 컬럼별 캐시 태그 매핑 (companies/financials 변경 시 어느 페이지가 영향받는지)
# 데이터 update 후 정확한 페이지 캐시만 무효화하도록 사용
COLUMN_TO_TAGS = {
    'companies': ['related_stocks_view', 'domestic_stocks_view', 'parts_top100_stocks_view'],
    'financials': ['related_stocks_view', 'domestic_stocks_view', 'parts_top100_stocks_view'],
    'exchange_rates_live': ['exchange_rates_live'],
    'oem_sales_group_month': ['oem_sales_group_month'],
    'oem_sales_group_pt_month': ['oem_sales_group_pt_month'],
    'oem_sales_group_country_month': ['oem_sales_group_country_month'],
    'oem_sales_type_seg_month': ['oem_sales_type_seg_month'],
}


def revalidate_tags(tags: list[str]) -> bool:
    """Next.js /api/revalidate 호출. 실패해도 silent fail (수집 작업은 성공해야 함)."""
    if not requests:
        logger.debug('requests 미설치 — revalidate 스킵')
        return False
    url = os.environ.get('NEXT_REVALIDATE_URL', '').strip()
    secret = os.environ.get('NEXT_REVALIDATE_SECRET', '').strip()
    if not url or not secret:
        logger.debug('NEXT_REVALIDATE_URL/SECRET 미설정 — revalidate 스킵')
        return False
    try:
        resp = requests.post(
            url,
            headers={'x-revalidate-secret': secret, 'Content-Type': 'application/json'},
            json={'tags': tags},
            timeout=10,
        )
        if resp.status_code == 200:
            logger.info(f'  ✓ cache revalidated: {tags}')
            return True
        logger.warning(f'  revalidate 실패 {resp.status_code}: {resp.text[:200]}')
        return False
    except Exception as e:
        logger.warning(f'  revalidate 예외: {e}')
        return False


def revalidate_for_tables(tables: list[str]) -> bool:
    """변경된 테이블 목록 → 영향받는 cacheTag 자동 매핑 → 무효화."""
    tags: set[str] = set()
    for t in tables:
        for tag in COLUMN_TO_TAGS.get(t, []):
            tags.add(tag)
    if not tags:
        return False
    return revalidate_tags(sorted(tags))


def revalidate_all() -> bool:
    """모든 페이지 캐시 무효화 (수집 워크플로 종료 시)."""
    return revalidate_tags(['all'])
