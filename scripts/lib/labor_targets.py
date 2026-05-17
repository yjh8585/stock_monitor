"""
DART 연결감사보고서 주석에서 인건비를 추출하기 위한 회사별 매핑.

비교 페이지(company_pages.page='compare') 매핑 회사가 자동 수집 대상이며,
회사별 섹션/키워드 차이를 흡수하기 위해 LABOR_TARGETS에 명시적 매핑을 둔다.
매핑이 없는 새 회사는 DEFAULT_*을 사용해 자동 탐지를 시도한다.

GOLDEN_2025: 2025년 인건비율 검증 기준값 (사용자 제공 이미지 기준).
파싱 결과가 이 값과 ±1%p 이상 어긋나면 매핑/파싱 로직을 재검토한다.
"""

# 매핑이 없는 신규 회사용 기본값 (대부분의 한국 외감 법인이 채택하는 표현)
DEFAULT_SECTION_CANDIDATES: list[str] = [
  '비용의 성격별 분류',
  '부가가치 계산에 필요한 항목',
  '부가가치 관련자료',
  '부가가치 관련 자료',
  '부가가치',
]
DEFAULT_LABOR_KEYWORDS: list[str] = ['급여', '퇴직급여', '복리후생', '인건비', '종업원급여']


def get_target(name_kr: str) -> dict[str, list[str]]:
  """회사명으로 인건비 추출 설정 반환. 매핑 없으면 DEFAULT_* 사용."""
  return LABOR_TARGETS.get(name_kr, {
    'section_candidates': DEFAULT_SECTION_CANDIDATES,
    'labor_keywords': DEFAULT_LABOR_KEYWORDS,
  })


LABOR_TARGETS: dict[str, dict[str, list[str]]] = {
  '한세모빌리티': {
    'section_candidates': ['비용의 성격별 분류'],
    'labor_keywords': ['급여', '퇴직급여', '복리후생', '주식보상비용'],
  },
  '한국무브넥스': {
    'section_candidates': ['비용의 성격별 분류'],
    'labor_keywords': ['급여', '퇴직급여', '복리후생'],
  },
  '서한이노빌리티': {
    'section_candidates': ['부가가치 관련자료', '부가가치 관련 자료', '부가가치'],
    'labor_keywords': ['급여', '퇴직급여', '복리후생', '인건비'],
  },
  '남양넥스모': {
    'section_candidates': ['부가가치 계산에 필요한 항목', '부가가치 관련', '부가가치'],
    'labor_keywords': ['급여', '퇴직급여', '복리후생', '인건비'],
  },
}

# 라벨에 들어가면 인건비 행에서 제외할 키워드 (비율 표기, 비교 컬럼, "X 제외" 부연 설명 행 등)
LABOR_REJECT: frozenset[str] = frozenset({'비율', '%', '구성비', '제외'})

# 2025년 인건비율 골든값 (회사 → 비율 0.0~1.0)
GOLDEN_2025: dict[str, float] = {
  '한세모빌리티': 0.174,
  '한국무브넥스': 0.072,
  '서한이노빌리티': 0.042,
  '남양넥스모': 0.149,
}

# 골든값 허용 오차 (퍼센트포인트)
GOLDEN_TOLERANCE_PP: float = 1.0
