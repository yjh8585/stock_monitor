"""DART 본문 문서 선택(_pick_statement_node) 회귀 검증.

배경(2026-07-18): OpenDartReader.sub_docs가 DART main.do 형식 변경으로 정규식 미스매치 시
라이브러리 내부에서 NameError(dart_utils.py:141 'url' 미정의)를 던진다. 우리 코드는
main.do 트리를 직접 파싱해 본문 문서를 고른다. '가장 긴 문서'만 고르면 주석(주석 노드가
재무제표보다 길 때)을 잘못 집을 수 있어, 재무제표 본문을 제목으로 우선 선택한다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_dart_docsel.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'collect_dart_audit', SCRIPTS_DIR / 'collect_dart_audit.py'
)
aud = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(aud)

pick = aud._pick_statement_node

# 노드 튜플 = (text, rcpNo, dcmNo, eleId, offset, length, dtd)
def node(title, ele, length):
    return (title, '20240430000403', '1', str(ele), '0', str(length), 'dart3.dtd')


class TestPickStatementNode(unittest.TestCase):
    def test_prefers_fs_wrapper_over_shorter_notes(self):
        nodes = [
            node('감   사   보   고   서', 1, 1906),
            node('(첨부)연 결 재 무 제 표', 3, 354601),
            node('연 결 손 익 계 산 서', 5, 31877),
            node('주석', 8, 209831),
            node('외부감사 실시내용', 9, 21885),
        ]
        self.assertEqual(pick(nodes)[3], '3')  # (첨부)재무제표 wrapper

    def test_excludes_notes_even_when_longest(self):
        """주석이 재무제표보다 길어도 재무제표 본문을 골라야 한다."""
        nodes = [
            node('(첨부)재 무 제 표', 3, 100000),
            node('주석', 4, 900000),  # 훨씬 김
            node('외부감사 실시내용', 5, 20000),
        ]
        self.assertEqual(pick(nodes)[3], '3')

    def test_falls_back_to_max_length_when_no_statement(self):
        nodes = [
            node('감사보고서', 1, 2000),
            node('첨부서류', 2, 50000),
        ]
        self.assertEqual(pick(nodes)[3], '2')  # 재무제표 노드 없음 → 최대 길이

    def test_empty(self):
        self.assertIsNone(pick([]))


if __name__ == '__main__':
    unittest.main()
