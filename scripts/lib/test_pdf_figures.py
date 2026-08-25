"""pdf_figures 의 순수 함수 회귀 시험 (fitz 없이 돈다)."""

from lib.pdf_figures import (
    BACKGROUND_AREA_RATIO,
    clean_caption,
    clip_to_page,
    cluster_rects,
    drop_non_figure_shapes,
    expand_to_text_blocks,
    is_image_body,
    is_skippable_page,
    pick_caption_line,
    rects_near,
    select_figure_rects,
    union_rect,
)

A4_W, A4_H = 595.0, 842.0


class TestSkippablePage:
    def test_재무제표_부록은_건너뛴다(self):
        text = "요약 재무상태표\n유동자산 ...\n요약 포괄손익계산서\n매출액 ..."
        assert is_skippable_page(text) is True

    def test_표제어가_하나뿐이면_건너뛰지_않는다(self):
        """본문에서 한 번 언급했다고 그 페이지 차트를 버리면 손해다."""
        text = "동사의 현금흐름표상 영업활동 현금흐름은 개선 추세다. <그림 3> 분기 실적 추이"
        assert is_skippable_page(text) is False

    def test_컴플라이언스_페이지는_표현_하나로_건너뛴다(self):
        assert is_skippable_page("Compliance Notice\n당사는 ...") is True
        assert is_skippable_page("본 조사분석자료는 고객의 투자에 ...") is True

    def test_평범한_본문_페이지는_남는다(self):
        assert is_skippable_page("휴머노이드 시장은 2030년까지 연평균 30% 성장") is False

    def test_빈_텍스트는_남긴다(self):
        assert is_skippable_page("") is False


class TestRectUtil:
    def test_가까운_사각형_판정(self):
        a = (0.0, 0.0, 10.0, 10.0)
        b = (15.0, 0.0, 25.0, 10.0)
        assert rects_near(a, b, gap=10.0) is True
        assert rects_near(a, b, gap=2.0) is False

    def test_합집합(self):
        assert union_rect((0.0, 0.0, 10.0, 10.0), (5.0, 20.0, 30.0, 25.0)) == (
            0.0,
            0.0,
            30.0,
            25.0,
        )


class TestDropNonFigureShapes:
    def test_페이지_전폭_얇은_선은_버린다(self):
        """이걸 안 버리면 머리글 밑줄이 페이지 위아래 도형을 전부 이어 붙인다."""
        rule = (30.0, 100.0, 565.0, 101.0)
        assert drop_non_figure_shapes([rule], A4_W, A4_H) == []

    def test_세로_전장_얇은_선도_버린다(self):
        rule = (300.0, 40.0, 301.5, 800.0)
        assert drop_non_figure_shapes([rule], A4_W, A4_H) == []

    def test_페이지_배경_사각형은_버린다(self):
        bg = (0.0, 0.0, A4_W, A4_H)
        assert rect_area_ratio(bg) >= BACKGROUND_AREA_RATIO
        assert drop_non_figure_shapes([bg], A4_W, A4_H) == []

    def test_전폭이어도_두꺼우면_남긴다(self):
        """전폭 차트는 실제로 있다 — 얇을 때만 구분선으로 본다."""
        wide_chart = (30.0, 100.0, 565.0, 300.0)
        assert drop_non_figure_shapes([wide_chart], A4_W, A4_H) == [wide_chart]

    def test_넓이_0_도형은_버린다(self):
        assert drop_non_figure_shapes([(10.0, 10.0, 10.0, 50.0)], A4_W, A4_H) == []


def rect_area_ratio(r):
    return ((r[2] - r[0]) * (r[3] - r[1])) / (A4_W * A4_H)


class TestClusterRects:
    def test_한_차트의_조각들이_하나로_뭉친다(self):
        pieces = [
            (100.0, 100.0, 200.0, 180.0),  # 막대
            (202.0, 120.0, 300.0, 180.0),  # 옆 막대
            (100.0, 182.0, 300.0, 184.0),  # x축
        ]
        out = cluster_rects(pieces, gap=10.0)
        assert out == [(100.0, 100.0, 300.0, 184.0)]

    def test_멀리_떨어진_두_차트는_갈린다(self):
        out = cluster_rects(
            [(100.0, 100.0, 250.0, 200.0), (100.0, 500.0, 250.0, 600.0)], gap=10.0
        )
        assert len(out) == 2

    def test_연쇄_병합이_끝까지_돈다(self):
        """A-B 가 붙고 B-C 가 붙으면 A-C 가 멀어도 한 덩어리여야 한다."""
        chain = [
            (0.0, 0.0, 50.0, 50.0),
            (55.0, 0.0, 105.0, 50.0),
            (110.0, 0.0, 160.0, 50.0),
        ]
        assert cluster_rects(chain, gap=10.0) == [(0.0, 0.0, 160.0, 50.0)]

    def test_빈_입력(self):
        assert cluster_rects([], gap=10.0) == []


class TestSelectFigureRects:
    def test_너무_작은_것은_버린다(self):
        tiny = (100.0, 100.0, 150.0, 130.0)  # 50 x 30 pt
        assert select_figure_rects([tiny], A4_W, A4_H) == []

    def test_페이지_대부분을_덮는_것은_버린다(self):
        huge = (10.0, 10.0, 585.0, 800.0)
        assert select_figure_rects([huge], A4_W, A4_H) == []

    def test_정상_차트는_통과한다(self):
        chart = (60.0, 120.0, 300.0, 300.0)
        assert select_figure_rects([chart], A4_W, A4_H) == [chart]

    def test_상한을_넘으면_큰_것부터_고르고_페이지_순서로_돌린다(self):
        small = (60.0, 600.0, 200.0, 700.0)
        big = (60.0, 100.0, 400.0, 350.0)
        mid = (60.0, 380.0, 350.0, 560.0)
        out = select_figure_rects([small, big, mid], A4_W, A4_H, limit=2)
        assert out == [big, mid]  # 큰 둘을 고르되 위→아래 순서로


class TestClipToPage:
    def test_페이지_밖_좌표를_잘라낸다(self):
        """실측 2026-08-25: 폭 1134pt(A4 는 595pt)짜리 «그림»이 나왔다."""
        assert clip_to_page((-20.0, 50.0, 1134.0, 300.0), A4_W, A4_H) == (
            0.0,
            50.0,
            A4_W,
            300.0,
        )

    def test_안에_있으면_그대로(self):
        r = (30.0, 40.0, 300.0, 200.0)
        assert clip_to_page(r, A4_W, A4_H) == r

    def test_전폭_도형은_자른_뒤_구분선_판정을_받는다(self):
        """자르기 전엔 «전폭»이 아니어서 살아남던 얇은 선이 잘린 뒤 걸러져야 한다."""
        out = drop_non_figure_shapes([(-50.0, 100.0, 900.0, 101.0)], A4_W, A4_H)
        assert out == []


class TestExpandToTextBlocks:
    CHART = (100.0, 100.0, 300.0, 250.0)

    def test_겹치는_라벨을_품는다(self):
        """파이 조각 라벨이 도형 밖으로 삐져나가면 잘려 나갔다(실측 2026-08-25)."""
        label = (290.0, 240.0, 330.0, 262.0)
        out = expand_to_text_blocks(self.CHART, [label], A4_W, A4_H)
        assert out[2] >= 330.0 and out[3] >= 262.0

    def test_안_겹치는_본문_문단은_품지_않는다(self):
        paragraph = (100.0, 400.0, 500.0, 560.0)
        out = expand_to_text_blocks(self.CHART, [paragraph], A4_W, A4_H)
        assert out[3] < 300.0

    def test_한_변당_최대치_이상은_안_넓힌다(self):
        """겹치기만 하면 아무리 큰 덩어리라도 삼키지 않는다."""
        giant = (0.0, 0.0, A4_W, A4_H)
        out = expand_to_text_blocks(self.CHART, [giant], A4_W, A4_H, max_grow=26.0)
        assert out[0] >= self.CHART[0] - 26.0 - 4.0
        assert out[3] <= self.CHART[3] + 26.0 + 4.0

    def test_라벨이_없어도_여백은_붙는다(self):
        out = expand_to_text_blocks(self.CHART, [], A4_W, A4_H)
        assert out[0] < self.CHART[0] and out[2] > self.CHART[2]

    def test_페이지_밖으로는_안_나간다(self):
        edge = (0.0, 0.0, 120.0, 90.0)
        out = expand_to_text_blocks(edge, [], A4_W, A4_H)
        assert out[0] == 0.0 and out[1] == 0.0


class TestPickCaptionLine:
    def test_그림에_가까운_제목을_고른다(self):
        above = "자료: 에프앤가이드, 미래에셋증권 리서치센터\n그림 7. 로보티즈 QDD 액추에이터"
        assert pick_caption_line(above, "") == "그림 7. 로보티즈 QDD 액추에이터"

    def test_출처_줄만_있으면_아래쪽을_본다(self):
        assert pick_caption_line("자료: iM증권 리서치본부", "분기별 매출액 추이") == "분기별 매출액 추이"

    def test_둘_다_출처뿐이면_위쪽_마지막_줄이라도_쓴다(self):
        assert pick_caption_line("자료: DART", "자료: DART") == "자료: DART"

    def test_아무것도_없으면_빈_문자열(self):
        assert pick_caption_line("", "") == ""

    def test_너무_짧은_줄은_무시한다(self):
        assert pick_caption_line("%\n실적 추이 및 전망", "") == "실적 추이 및 전망"


class TestCleanCaption:
    def test_여러_줄을_한_줄로(self):
        assert clean_caption("그림 3.\n분기\t실적  추이") == "그림 3. 분기 실적 추이"

    def test_긴_것은_자르고_말줄임(self):
        out = clean_caption("가" * 300)
        assert len(out) <= 121 and out.endswith("…")

    def test_빈_입력(self):
        assert clean_caption("") == ""
        assert clean_caption(None) == ""


class TestIsImageBody:
    def test_실측_미래에셋_5쪽_576자는_이미지_본문(self):
        # 🔴 이 건이 「총 길이 300자」 기준을 통과해 버려 3편이 계속 실패했다.
        assert is_image_body(576, 5) is True

    def test_정상_리포트는_아니다(self):
        assert is_image_body(40_000, 8) is False

    def test_쪽수를_모르면_판정하지_않는다(self):
        assert is_image_body(576, 0) is False
        assert is_image_body(576, -1) is False

    def test_경계값(self):
        assert is_image_body(400, 1) is False  # 정확히 400자/쪽은 정상으로 본다
        assert is_image_body(399, 1) is True
