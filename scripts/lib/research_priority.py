"""증권사 리포트 중 «먼저 제대로 정리할 것»을 고른다.

왜 고르는가(사용자 지시 2026-08-25 "144개가 너무 많네. 의미 있는 것들로만 중요도 높은 것
위주로 추려봐봐"):
    정리본 한 편에 3~4분이 든다. 144편이면 8시간이고, 그중 상당수는 분기 실적 리뷰라
    휴머노이드 관점에서 읽을 것이 거의 없다.

실측으로 본 144편의 구성(2026-08-25):
    산업분석 41 · 종목분석 103 · 대상(종목·업종) 49개. 현대차·현대모비스·HL만도 3사에만
    33편이 몰려 있고, 그중 다수가 「1Q26 Preview: Rough Start」·「딱 예상한대로」처럼
    로봇 이야기가 곁다리인 실적 리뷰다.

🔴 점수만으로 자르면 안 된다 — 상위 35편은 품질은 최고지만 **49개 대상 중 10개만** 덮는다.
   나머지 39개 종목(로보티즈·에스피지·삼익THK·클로봇 …)은 요약이 하나도 없는 빈 페이지가
   된다. 그래서 「점수 높은 산업 조망」에 「대상별 최소 1편」을 **더한다**(사용자 선택: 균형 60건).
"""

from __future__ import annotations

import re
from datetime import date, timedelta

# ── 점수 규칙 ────────────────────────────────────────────────────────────────

#: 산업분석은 테마 전체를 조망해 종목 리포트보다 오래 쓸모가 있다.
SCORE_INDUSTRY = 3

#: 제목이 로봇·휴머노이드를 **주제로 내세운** 리포트. 실적 리뷰와 갈리는 가장 강한 신호다.
SCORE_ROBOT_TOPIC = 3

#: 우리가 화면에 올려 추적 중인 종목(`company_id` 가 채워진 행).
SCORE_TRACKED = 2

#: 최근 것일수록 지금 판단에 쓸모가 있다.
SCORE_RECENT = 2
RECENT_DAYS = 90

#: 시장의 관심을 받은 리포트.
SCORE_POPULAR = 1
POPULAR_VIEWS = 10_000

#: 🔴 분기 실적 리뷰인데 로봇이 주제가 아니면 **깎는다**. 이 페이지에서 읽을 것이 없다.
PENALTY_EARNINGS_ONLY = -3

#: 산업분석을 무조건 담는 문턱. 8점이면 「최근 + 로봇 주제」인 조망 리포트가 걸린다.
INDUSTRY_MIN_SCORE = 8

#: 앞으로 들어오는 리포트를 담는 문턱(사용자 선택 2026-08-25 「점수 기준만 적용」).
#: 🔴 값 근거는 실측이다 — 수집 시점 점수로 144편을 다시 매기면 4점 이하가 9편인데
#:    그 9편이 정확히 「1Q26 Preview: Rough Start」류 순수 실적 리뷰다. 5점부터는 전부
#:    로봇 이야기가 주제인 리포트라 더 올릴 이유가 없다. 유입량도 문제가 안 된다 —
#:    월 20~30편(하루 1~2편)이라 편당 3분이면 하루 5분이다. 144편은 5개월치 백로그였다.
ONGOING_MIN_SCORE = 5

_ROBOT_TOPIC_RE = re.compile(
    # 🔴 부품 이름을 빠뜨리면 안 된다 — 감속기·모터는 휴머노이드의 핵심 부품인데
    #    제목에 「로봇」이 안 들어간다(실측: 하이젠알앤엠 「산업용 모터 및 감속기 제조
    #    전문기업」 4점, 에스비비테크 「SSS급 정밀 감속기 제조사」 4점 — 둘 다 로봇
    #    부품 순수기업인데 문턱 아래로 떨어졌다).
    r"휴머노이드|로보틱스|피지컬|physical|로봇|로보|액추에이터|액츄에이터"
    r"|감속기|하모닉|구동장치|모션제어",
    re.IGNORECASE,
)

_EARNINGS_RE = re.compile(
    r"(^|[^A-Za-z])[1-4]Q ?[0-9]{2}|Review|Preview|리뷰|프리뷰",
    re.IGNORECASE,
)


def is_robot_topic(title: str) -> bool:
    """제목이 로봇·휴머노이드를 주제로 내세우는가."""
    return bool(_ROBOT_TOPIC_RE.search(title or ""))


def is_earnings_review(title: str) -> bool:
    """제목이 분기 실적 리뷰·프리뷰인가."""
    return bool(_EARNINGS_RE.search(title or ""))


def score_report(row: dict, today: date | None = None) -> int:
    """리포트 한 편의 중요도 점수. 순수 함수 — DB 도 시각도 건드리지 않는다.

    `today` 를 인자로 받는 이유: 「최근」 판정이 실행 시각에 따라 달라지면 시험이
    어느 날 갑자기 깨진다(`Date.now()` 를 코드에 박지 않는 것과 같은 이유).
    """
    today = today or date.today()
    title = row.get("title") or ""
    score = 0

    if row.get("kind") == "industry":
        score += SCORE_INDUSTRY

    robot = is_robot_topic(title)
    if robot:
        score += SCORE_ROBOT_TOPIC

    if row.get("company_id") is not None:
        score += SCORE_TRACKED

    published = row.get("published_at")
    if published and date.fromisoformat(published) >= today - timedelta(days=RECENT_DAYS):
        score += SCORE_RECENT

    if (row.get("view_count") or 0) >= POPULAR_VIEWS:
        score += SCORE_POPULAR

    if is_earnings_review(title) and not robot:
        score += PENALTY_EARNINGS_ONLY

    return score


def _sort_key(row: dict, today: date | None) -> tuple:
    """점수 높은 순 → 최신 순. 같으면 id 로 갈라 결과가 실행마다 흔들리지 않게 한다."""
    return (-score_report(row, today), _neg_date(row.get("published_at")), row.get("id") or "")


def _neg_date(published: str | None) -> str:
    """최신이 앞에 오도록 뒤집은 정렬 키. 날짜가 없으면 맨 뒤."""
    if not published:
        return "0000-00-00"
    # 문자열 비교로 내림차순을 만들기 위해 자리별 보수를 취한다.
    return "".join(str(9 - int(ch)) if ch.isdigit() else ch for ch in published)


def select_priority(rows: list[dict], today: date | None = None) -> list[dict]:
    """먼저 정리할 리포트를 고른다.

    두 갈래를 합친다.

    1. **산업 조망** — 산업분석 중 `INDUSTRY_MIN_SCORE` 이상. 테마를 이해하는 데 쓴다.
    2. **대상별 최소 1편** — 종목·업종마다 가장 점수 높은 한 편. 어느 종목을 눌러도
       제대로 된 정리본이 하나는 있어야 한다.

    돌려주는 순서는 **발행일 오름차순**이다 — 요약 파이프라인이 오래된 것부터 처리해야
    「직전 리포트 대비 변화」가 성립하기 때문이다.
    """
    picked: dict[str, dict] = {}

    for row in rows:
        if row.get("kind") == "industry" and score_report(row, today) >= INDUSTRY_MIN_SCORE:
            picked[row["id"]] = row

    covered = {r.get("target_name") for r in picked.values()}
    by_target: dict[str, list[dict]] = {}
    for row in rows:
        by_target.setdefault(row.get("target_name") or "", []).append(row)

    for target, bucket in by_target.items():
        if target in covered:
            continue
        best = sorted(bucket, key=lambda r: _sort_key(r, today))[0]
        picked[best["id"]] = best

    return sorted(picked.values(), key=lambda r: (r.get("published_at") or "", r.get("id") or ""))


def select_ongoing(rows: list[dict], today: date | None = None) -> list[dict]:
    """평소(정기 수집)에 요약할 것을 고른다 — **점수 문턱만** 본다.

    `select_priority` 와 무엇이 다른가:

    - `select_priority` 는 **초기 채우기용**이다. 「대상별 최소 1편」을 억지로 끼워 넣어
      49개 종목이 빈 페이지가 되지 않게 했다. 그 일은 2026-08-25 에 끝났다.
    - 앞으로도 그 규칙을 쓰면 점수와 무관하게 대상마다 1편씩은 통과하므로 실적 리뷰가
      계속 섞여 들어온다(사용자가 빼라고 한 바로 그것). 그래서 평소에는 문턱만 본다.

    돌려주는 순서는 `select_priority` 와 같이 **발행일 오름차순**이다.
    """
    picked = [r for r in rows if score_report(r, today) >= ONGOING_MIN_SCORE]
    return sorted(picked, key=lambda r: (r.get("published_at") or "", r.get("id") or ""))
