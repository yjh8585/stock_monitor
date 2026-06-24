"""조직도 엑셀 시트명 파싱 (순수 함수 — win32com 의존 없음 → 단위 테스트 가능).

시트명 규칙: '변경 (전|후) 조직도(Kor.)_YYYYMMDD'.
한국어(Kor.) 시트만 골라 (시트명, 'YYYY-MM-DD') 튜플 리스트를 날짜 오름차순으로 반환.
"""
import re

KOR_DATE_RE = re.compile(r'조직도\(Kor\.\)_(\d{8})')


def parse_kor_sheets(sheet_names: list[str]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for name in sheet_names:
        m = KOR_DATE_RE.search(name)
        if not m:
            continue
        d = m.group(1)
        iso = f'{d[0:4]}-{d[4:6]}-{d[6:8]}'
        out.append((name, iso))
    out.sort(key=lambda t: t[1])
    return out
