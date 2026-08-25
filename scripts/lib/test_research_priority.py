"""research_priority 순수 함수 회귀 시험."""

from datetime import date

from lib.research_priority import (
    INDUSTRY_MIN_SCORE,
    is_earnings_review,
    is_robot_topic,
    ONGOING_MIN_SCORE,
    score_report,
    select_ongoing,
    select_priority,
)

TODAY = date(2026, 8, 25)


def row(**kw) -> dict:
    base = {
        "id": kw.get("id", "x"),
        "kind": "company",
        "title": "제목",
        "company_id": None,
        "published_at": "2026-08-01",
        "view_count": 0,
        "target_name": "대상",
    }
    base.update(kw)
    return base


class TestTitleFlags:
    def test_로봇_주제_인식(self):
        for t in ["짙어지는 로보틱스 사업자의 면모", "휴머노이드: Ph.2 진입", "여전히 Physical AI 대장주"]:
            assert is_robot_topic(t) is True

    def test_로봇과_무관한_제목(self):
        for t in ["딱 예상한대로", "Trade-off 국면", "위기 속 확인된 이익체력"]:
            assert is_robot_topic(t) is False

    def test_분기_리뷰_인식(self):
        for t in ["1Q26 Review: 관세 영향", "2Q26 프리뷰: 부합 전망", "2분기 리뷰"]:
            assert is_earnings_review(t) is True

    def test_분기_리뷰가_아닌_제목(self):
        assert is_earnings_review("주목받을 로봇 핸드") is False


class TestScore:
    def test_실적_리뷰인데_로봇_무관하면_깎인다(self):
        """이 페이지에서 읽을 것이 없는 리포트다 — 실측에서 가장 흔한 저가치 유형."""
        s = score_report(row(title="1Q26 Preview: Rough Start"), TODAY)
        assert s < score_report(row(title="평범한 제목"), TODAY)

    def test_로봇_주제면_분기_리뷰여도_안_깎인다(self):
        """「2Q26 리뷰: 로봇 액추에이터 수주 기대」는 실적 리뷰지만 읽을 값이 있다."""
        s = score_report(row(title="2Q26 리뷰: 로봇 액추에이터 수주 기대"), TODAY)
        assert s >= score_report(row(title="평범한 제목"), TODAY)

    def test_산업분석이_종목분석보다_높다(self):
        ind = score_report(row(kind="industry", title="휴머노이드: Ph.2 진입"), TODAY)
        com = score_report(row(kind="company", title="휴머노이드: Ph.2 진입"), TODAY)
        assert ind > com

    def test_추적종목_가산(self):
        assert score_report(row(company_id="c1"), TODAY) > score_report(row(), TODAY)

    def test_최근이면_가산_오래되면_없다(self):
        recent = score_report(row(published_at="2026-08-01"), TODAY)
        old = score_report(row(published_at="2026-01-01"), TODAY)
        assert recent > old

    def test_조회수_가산(self):
        assert score_report(row(view_count=50_000), TODAY) > score_report(row(view_count=10), TODAY)

    def test_날짜가_없어도_죽지_않는다(self):
        assert isinstance(score_report(row(published_at=None), TODAY), int)

    def test_today_를_안_주면_오늘로_계산한다(self):
        assert isinstance(score_report(row()), int)


class TestSelectPriority:
    def test_점수_높은_산업분석은_전부_담는다(self):
        rows = [
            row(id="i1", kind="industry", title="휴머노이드 시장 조망", target_name="기타",
                view_count=50_000),
            row(id="i2", kind="industry", title="로봇 핸드 주목", target_name="기타",
                view_count=50_000),
        ]
        assert score_report(rows[0], TODAY) >= INDUSTRY_MIN_SCORE
        out = select_priority(rows, TODAY)
        assert {r["id"] for r in out} == {"i1", "i2"}

    def test_모든_대상이_최소_한_편씩_덮인다(self):
        """🔴 점수만으로 자르면 대상 49개 중 10개만 덮여 나머지가 빈 페이지가 된다."""
        rows = [
            row(id="a1", target_name="로보티즈", title="딱 예상한대로"),
            row(id="b1", target_name="클로봇", title="Trade-off 국면"),
            row(id="c1", target_name="큐렉소", title="1Q26 Review"),
        ]
        out = select_priority(rows, TODAY)
        assert {r["target_name"] for r in out} == {"로보티즈", "클로봇", "큐렉소"}

    def test_한_대상에_여러_편이면_가장_점수_높은_것을_고른다(self):
        rows = [
            row(id="lo", target_name="HL만도", title="1Q26 Preview: Rough Start"),
            row(id="hi", target_name="HL만도", title="자동차 섀시에서 로봇 관절로 이어질 시간"),
        ]
        out = select_priority(rows, TODAY)
        assert [r["id"] for r in out] == ["hi"]

    def test_점수가_같으면_최신을_고른다(self):
        rows = [
            row(id="old", target_name="에스피지", title="로봇 감속기", published_at="2026-08-01"),
            row(id="new", target_name="에스피지", title="로봇 감속기", published_at="2026-08-20"),
        ]
        out = select_priority(rows, TODAY)
        assert [r["id"] for r in out] == ["new"]

    def test_발행일_오름차순으로_돌려준다(self):
        """요약은 오래된 것부터 처리해야 「직전 대비 변화」가 성립한다."""
        rows = [
            row(id="n", target_name="A", published_at="2026-08-20"),
            row(id="o", target_name="B", published_at="2026-03-02"),
            row(id="m", target_name="C", published_at="2026-06-11"),
        ]
        assert [r["id"] for r in select_priority(rows, TODAY)] == ["o", "m", "n"]

    def test_빈_입력(self):
        assert select_priority([], TODAY) == []

    def test_같은_행이_두_갈래에_걸려도_한_번만_담긴다(self):
        rows = [
            row(id="i1", kind="industry", title="휴머노이드 조망", target_name="기타",
                view_count=50_000),
        ]
        out = select_priority(rows, TODAY)
        assert len(out) == 1


class TestRobotPartKeywords:
    """🔴 부품 이름이 빠져 로봇 순수기업이 문턱 아래로 떨어졌다(실측 2026-08-25)."""

    def test_감속기_제조사는_로봇_주제다(self):
        assert is_robot_topic("SSS급 정밀 감속기 제조사") is True
        assert is_robot_topic("[AI] 산업용 모터 및 감속기 제조 전문기업") is True

    def test_무관한_제목은_그대로_아니다(self):
        assert is_robot_topic("1Q26 Preview: Rough Start") is False


class TestSelectOngoing:
    """평소 선별 — 점수 문턱만 본다(사용자 선택 2026-08-25 「점수 기준만 적용」)."""

    def test_순수_실적_리뷰는_걸러진다(self):
        r = row(id="a", title="1Q26 Review: 선방한 실적, 원가 보전이 관건", company_id=1)
        assert score_report(r, TODAY) < ONGOING_MIN_SCORE
        assert select_ongoing([r], TODAY) == []

    def test_로봇_주제면_추적_안_하는_종목도_통과한다(self):
        """작은 로봇 순수기업이 「추적 종목」 가산점이 없다고 빠지면 안 된다."""
        r = row(id="b", title="환자 맞춤형 재활훈련 로봇시스템 전문기업", company_id=None)
        assert select_ongoing([r], TODAY) == [r]

    def test_로봇을_다루는_실적_리뷰는_남는다(self):
        r = row(id="c", title="2Q26 리뷰: 로봇 액추에이터 수주 기대", company_id=1)
        assert select_ongoing([r], TODAY) == [r]

    def test_대상별_최소_1편_규칙을_쓰지_않는다(self):
        """select_priority 와 갈리는 지점 — 점수 미달이면 그 대상이 비어도 안 담는다."""
        low = row(id="d", title="Trade-off 국면", target_name="현대모비스", company_id=1)
        assert select_ongoing([low], TODAY) == []
        assert len(select_priority([low], TODAY)) == 1

    def test_발행일_오름차순으로_돌려준다(self):
        늦은것 = row(id="e", title="로봇 모멘텀 점검", published_at="2026-08-20")
        이른것 = row(id="f", title="휴머노이드 시대 개화", published_at="2026-08-01")
        assert [r["id"] for r in select_ongoing([늦은것, 이른것], TODAY)] == ["f", "e"]
