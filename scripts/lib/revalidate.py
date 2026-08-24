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


# 테이블 → cacheTag 매핑. db.upsert_rows()가 이 매핑을 통해 자동으로 /api/revalidate를 호출한다.
#
# 매핑 기준: app/**/page.tsx, lib/**/*.ts 의 cacheTag('...') 사용처를 git grep으로 도출.
#   - 동일 테이블이 여러 페이지/뷰에 영향이면 모두 등재 (예: companies → 메인·도메스틱·TOP100 뷰)
#   - 한 테이블이 직접 태그로도 쓰이고 view 태그로도 쓰이면 모두 포함 (예: companies, financials)
#   - 페이지가 'use cache'를 쓰지 않아도(예: hansae) 향후 적용 대비 매핑은 유지
# ALL_TAGS(=app/api/revalidate/route.ts)와 정합성 유지. 신규 cacheTag 추가 시 양쪽 동시 갱신.
COLUMN_TO_TAGS = {
    # 회사 메타·재무 → 3개 view + 직접 태그 + compare 페이지
    'companies': [
        'related_stocks_view',
        'domestic_stocks_view',
        'parts_top100_stocks_view',
        'companies',
    ],
    'financials': [
        'related_stocks_view',
        'domestic_stocks_view',
        'parts_top100_stocks_view',
        'financials',
    ],
    # 네이버 증권사 리포트 — /humanoid/research 한 화면만 읽는다.
    # 수집(하루 1회)과 요약(회차당 20건)이 각각 쓰므로 뷰 태그를 딸려 넣지 않는다.
    'research_reports': ['research_reports'],
    # 주가
    'stock_prices': ['stock_prices', 'related_stocks_view'],
    'stock_quotes_5min': ['stock_quotes_5min', 'related_stocks_view'],
    # 환율
    # 🔴 여기에 뷰 태그(related/domestic/parts_top100)를 넣지 말 것.
    # FX 수집이 하루 ~5회 도는데, 그때마다 무거운 주식 라우트 3개(합 1.5MB)가 통째로
    # 재기록돼 ISR write 를 크게 먹는다(ISR write = payload 크기 8KB 단위 과금).
    # 환산 시총·매출은 주가·재무 무효화나 cacheLife 만료로 최대 1시간 내 따라오고,
    # 사용자가 주시하는 주가·등락률은 각 뷰 태그로 즉시 갱신되므로 영향 없다.
    # 짝이 되는 source.ts 의 cacheTag('exchange_rates_live') 도 함께 제거돼 있다
    # (한쪽만 되돌리면 조용히 원상복구된다). 배경 → docs/isr-write-optimization.md
    'exchange_rates_live': ['exchange_rates_live'],
    'exchange_rates': ['exchange_rates'],
    # 매크로·시계열
    'market_series': ['market_series'],
    'market_series_daily': ['market_series_daily'],
    'market_series_live': ['market_series_live'],
    'macro_outlook_notes': ['macro_outlook_notes'],
    # OEM (전체 탭 — MarkLines 글로벌)
    'oem_sales_group_month': ['oem_sales_group_month'],
    'oem_sales_group_pt_month': ['oem_sales_group_pt_month'],
    'oem_sales_group_country_month': ['oem_sales_group_country_month'],
    'oem_sales_type_seg_month': ['oem_sales_type_seg_month'],
    'oem_sales_model_country_month': ['oem_sales_model_country_month'],
    'oem_model_outlook': ['oem_model_outlook'],
    # MarkLines 생산량 (모델×생산국×월) — /management/stellantis 차트 1
    'oem_production_model_country_month': ['oem_production_model_country_month'],
    # OEM 회사별 탭 (PR2~5) — 회사별 IR 차종 판매 + 4사 공통 PT 매핑
    'kg_mobility_sales': ['oem-kg-mobility-sales'],
    'hyundai_sales': ['oem-hyundai-sales'],
    'hyundai_export_regions': ['oem-hyundai-export-regions'],
    'hyundai_quarterly_earnings': ['oem-hyundai-quarterly'],
    'kia_sales': ['oem-kia-sales'],
    'kia_export_regions': ['oem-kia-export-regions'],
    'stellantis_na_sales': ['oem-stellantis-na-sales'],
    'stellantis_shipments': ['stellantis-shipments'],
    'kia_retail_sales': ['oem-kia-retail'],
    'uzbekistan_auto_stats': ['uzbekistan-auto-stats'],
    'vehicle_powertrain_map': ['vehicle-powertrain-map'],
    # Cox Automotive 브랜드별 신차 재고일수 (공개 데이터)
    'cox_brand_inventory': ['cox-brand-inventory'],
    # 보고서·뉴스
    'posts': ['posts'],
    'news': ['posts'],
    # 경영관리(PnL)
    'pnl_entries': ['pnl_entries'],
    'pnl_cost_structure': ['pnl_cost_structure'],
    'pnl_fixed_variable': ['pnl_fixed_variable'],
    'pnl_plan': ['pnl_plan'],
    'inventory_entries': ['inventory_entries'],
    'personnel_entries': ['personnel_entries'],
    'finance_entries': ['finance_entries'],
    'loan_entries': ['loan_entries'],
    'longterm_revenue_plan': ['longterm_revenue_plan'],
    'org_charts': ['org_charts'],
}


def _post_revalidate(url: str, secret: str, tags: list[str], label: str) -> bool:
    """단일 /api/revalidate 엔드포인트 POST. 실패해도 예외 전파 없이 False 반환."""
    try:
        resp = requests.post(
            url,
            headers={'x-revalidate-secret': secret, 'Content-Type': 'application/json'},
            json={'tags': tags},
            timeout=10,
        )
        if resp.status_code == 200:
            logger.info(f'  ✓ cache revalidated [{label}]: {tags}')
            return True
        logger.warning(f'  revalidate 실패 [{label}] {resp.status_code}: {resp.text[:200]}')
        return False
    except Exception as e:
        logger.warning(f'  revalidate 예외 [{label}]: {e}')
        return False


def revalidate_tags(tags: list[str]) -> bool:
    """Next.js /api/revalidate 호출. 실패해도 silent fail (수집 작업은 성공해야 함).

    대상 URL = NEXT_REVALIDATE_URL (로컬 dev는 localhost, cron은 prod URL)."""
    if not requests:
        logger.debug('requests 미설치 — revalidate 스킵')
        return False
    url = os.environ.get('NEXT_REVALIDATE_URL', '').strip()
    secret = os.environ.get('NEXT_REVALIDATE_SECRET', '').strip()
    if not url or not secret:
        logger.debug('NEXT_REVALIDATE_URL/SECRET 미설정 — revalidate 스킵')
        return False
    return _post_revalidate(url, secret, tags, label='default')


def revalidate_tags_prod(tags: list[str]) -> bool:
    """프로덕션 /api/revalidate 호출 (NEXT_REVALIDATE_PROD_URL).

    로컬에서 수동 실행하는 사외비 sync는 NEXT_REVALIDATE_URL=localhost라 프로덕션
    캐시가 안 비워진다. `--revalidate-prod` 옵션이 이 함수로 프로덕션을 추가 무효화한다.
    설정 누락이나 실패 시 명시적으로 WARNING (사용자가 의도적으로 켠 옵션이므로)."""
    if not requests:
        logger.warning('requests 미설치 — 프로덕션 revalidate 스킵')
        return False
    url = os.environ.get('NEXT_REVALIDATE_PROD_URL', '').strip()
    secret = os.environ.get('NEXT_REVALIDATE_SECRET', '').strip()
    if not url:
        logger.warning('NEXT_REVALIDATE_PROD_URL 미설정 — 프로덕션 revalidate 스킵 '
                       '(.env.local에 prod /api/revalidate URL 추가 필요)')
        return False
    if not secret:
        logger.warning('NEXT_REVALIDATE_SECRET 미설정 — 프로덕션 revalidate 스킵')
        return False
    return _post_revalidate(url, secret, tags, label='prod')


def _tags_for_tables(tables: list[str]) -> list[str]:
    tags: set[str] = set()
    for t in tables:
        for tag in COLUMN_TO_TAGS.get(t, []):
            tags.add(tag)
    return sorted(tags)


def revalidate_for_tables(tables: list[str]) -> bool:
    """변경된 테이블 목록 → 영향받는 cacheTag 자동 매핑 → (기본 URL) 무효화."""
    tags = _tags_for_tables(tables)
    if not tags:
        return False
    return revalidate_tags(tags)


def revalidate_prod_for_tables(tables: list[str]) -> bool:
    """변경된 테이블 목록 → cacheTag 매핑 → 프로덕션 추가 무효화 (--revalidate-prod용)."""
    tags = _tags_for_tables(tables)
    if not tags:
        logger.warning(f'프로덕션 revalidate: {tables} 에 매핑된 cacheTag 없음 — 스킵')
        return False
    return revalidate_tags_prod(tags)


def revalidate_all() -> bool:
    """모든 페이지 캐시 무효화 (수집 워크플로 종료 시)."""
    return revalidate_tags(['all'])
