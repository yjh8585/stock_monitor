"""제품군 카테고리 도메인 분리 회귀 검증 (`split_domains` · `category_guide`).

배경(2026-09-11 실측): 기존 `products[].category` 를 LLM 으로 재분류할 때 자동차 12칸과
로봇 11종을 **한 목록으로 주면** 자동차 부품이 로봇 칸으로 샜다 — 보그워너의
「통합 드라이브 모듈(iDM)」·「전자식 크로스 디퍼렌셜」이 `제어AI칩` 으로 갔고,
뒤엣것은 원래 `구동계` 로 **맞던 값**이었다. raw 키 예시를 붙여도 안 고쳐졌다(후보에
있으면 고른다). 후보 자체를 갈라야 막힌다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_product_categories.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.product_categories import (  # noqa: E402
    ROBOT_ONLY_CATEGORIES,
    category_guide,
    split_domains,
    violates_boundary,
)

# 2026-09-11 DB 실측값(`select distinct normalized from product_category_map`) — 22종.
ALL = [
    '감속기', '공조', '구동계', '구조기구', '그리퍼핸드', '기타', '내장', '모터',
    '배터리', '볼스크류/리니어', '비전카메라', '안전', '액추에이터', '엔진',
    '위치센서', '전장', '제동', '제어AI칩', '조향', '차체', '타이어', '힘토크센서',
]


class SplitDomainsTest(unittest.TestCase):
    def test_자동차_목록에는_로봇_전용이_하나도_없다(self):
        auto, _ = split_domains(ALL)
        self.assertEqual(set(auto) & ROBOT_ONLY_CATEGORIES, set())

    def test_자동차_12칸이_그대로_남는다(self):
        auto, _ = split_domains(ALL)
        self.assertEqual(
            set(auto),
            {'엔진', '구동계', '제동', '조향', '차체', '내장',
             '전장', '배터리', '타이어', '공조', '안전', '기타'},
        )

    def test_로봇_목록에는_기타와_배터리가_함께_있다(self):
        """로봇사도 「자동차·로봇 어느 쪽도 아닌 제품」을 만들고, 배터리는 양쪽이 공유한다."""
        _, robot = split_domains(ALL)
        self.assertIn('기타', robot)
        self.assertIn('배터리', robot)
        self.assertIn('그리퍼핸드', robot)
        self.assertNotIn('타이어', robot)

    def test_두_목록_합이_전체를_덮는다(self):
        auto, robot = split_domains(ALL)
        self.assertEqual(set(auto) | set(robot), set(ALL))

    def test_DB에_없는_로봇_카테고리가_있으면_예외(self):
        """🔴 이 표는 사본이다 — DB 와 갈리면 조용히 넘어가지 말고 즉시 터져야 한다."""
        with self.assertRaises(RuntimeError):
            split_domains([c for c in ALL if c != '그리퍼핸드'])


class CategoryGuideTest(unittest.TestCase):
    def test_예시가_없으면_한_줄로_나열한다(self):
        text = category_guide(['엔진', '기타'])
        self.assertIn('엔진', text)
        self.assertIn('기타', text)

    def test_예시를_주면_카테고리마다_범위를_보여_준다(self):
        text = category_guide(['엔진', '기타'], {'엔진': ['배기', 'EGR', '밸브']})
        self.assertIn('- 엔진 (예: 배기, EGR, 밸브)', text)

    def test_비자동차는_기타로_가라는_지시가_항상_들어간다(self):
        """이 문장이 빠지면 가전이 다시 자동차 칸을 받는다(LG전자 TV → 구동계)."""
        for text in (category_guide(ALL), category_guide(ALL, {'엔진': ['배기']})):
            self.assertIn('기타', text)
            self.assertIn('가전', text)


class BoundaryGuardTest(unittest.TestCase):
    """사용자가 정한 경계 규칙(2026-09-11)을 LLM 이 어겼을 때 기계가 잡는가."""

    def test_조명과_와이퍼는_전장이_아니면_막는다(self):
        self.assertIsNotNone(violates_boundary('헤드램프', '안전'))
        self.assertIsNotNone(violates_boundary('와이퍼 블레이드', '기타'))
        self.assertIsNotNone(violates_boundary('실내외 조명', '내장'))

    def test_조명과_와이퍼가_전장이면_통과(self):
        self.assertIsNone(violates_boundary('헤드램프', '전장'))
        self.assertIsNone(violates_boundary('와이퍼 모터', '전장'))

    def test_클램프는_램프가_아니다(self):
        """🔴 실측 오탐 — 정규식 `램프` 가 「호스 «클»램프」에 부분일치했다.
        한국어에는 단어 경계가 없어 `\\b` 로는 못 막는다."""
        self.assertIsNone(violates_boundary('호스 클램프', '기타'))
        self.assertIsNone(violates_boundary('클램프', '차체'))

    def test_차량용_반도체를_기타로_내리면_막는다(self):
        self.assertIsNotNone(violates_boundary('전력 반도체', '기타'))
        self.assertIsNotNone(violates_boundary('애플리케이션 프로세서', '기타'))

    def test_반도체가_용도별_칸으로_가는_것은_통과(self):
        """기본은 전장이되 용도가 분명하면 그 칸으로 — 사용자 결정."""
        self.assertIsNone(violates_boundary('각도 자기 인코더 IC', '위치센서'))
        self.assertIsNone(violates_boundary('RA Arm Cortex-M MCU', '제어AI칩'))
        self.assertIsNone(violates_boundary('전력 반도체', '전장'))

    def test_규칙과_무관한_제품은_건드리지_않는다(self):
        self.assertIsNone(violates_boundary('브레이크 디스크', '제동'))
        self.assertIsNone(violates_boundary('냉장고', '기타'))


if __name__ == '__main__':
    unittest.main()
