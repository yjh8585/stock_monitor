"""표 화면의 «조작» 검증 — 필터·정렬·팝업이 실제로 동작하는가.

사용: scripts/venv/Scripts/python.exe scripts/e2e_interact.py
      scripts/venv/Scripts/python.exe scripts/e2e_interact.py --self-test
      scripts/venv/Scripts/python.exe scripts/e2e_interact.py --route /oem
      exit 0 = 정상 · exit 1 = 실패

🔴 **`e2e_smoke.py` 와 재는 것이 다르다.** 그쪽은 「화면이 열리고 그려지는가」까지다.
여기는 **누르면 무엇이 달라지는가** 를 잰다 — 열리기만 하고 필터가 죽어 있어도
smoke 는 전부 초록이다(실제로 그 구멍이 있었다).

🔴 **모든 시험을 양방향으로 쓴다.** 「필터를 끄니 줄었다」만 재면, 아무 때나 0행을 내는
고장도 통과한다. 그래서 ①끄면 줄고 ②켜면 돌아오고 ③남은 것이 실제로 조건에 맞는지
셋을 함께 본다. 정렬도 마찬가지 — 「순서가 바뀌었다」가 아니라 «값이 실제로 정렬돼
있는가» 를 잰다.

🔴 **화면마다 사양(`SCREENS`)을 «따로» 둔다.** 2026-09-09 에 네 화면을 실물로 재 보니
서로 딴판이었다 — `/oem` 은 **정렬 머리글이 0개이고 팝업도 없다**, `/parts-top100` 은
구분 필터가 「국가」이고 `/domestic` 은 「그룹」이다. 한 화면 스크립트를 그대로 돌렸으면
버튼을 못 찾아 **조용히 0건**이 됐을 것이다. 새 화면을 더할 때도 실물을 먼저 재고 적는다.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(Path(__file__).parent / '.env')
load_dotenv(ROOT / '.env.local')

from playwright.sync_api import sync_playwright  # noqa: E402

BASE = os.environ.get('E2E_BASE_URL', 'http://localhost:3001')
USER = os.environ.get('ADMIN_ID')
PASS = os.environ.get('ADMIN_PW')

# 화면별 사양 — 전부 2026-09-09 에 실물로 재서 적었다(위 docstring 참조).
#   filters   : 껐다 켰다 하며 행 수 변화를 볼 버튼 이름
#   sort      : 누르면 정렬되는 머리글(없으면 None)
#   popup     : 뉴스 팝업 단추가 있는가
#   typeCol   : 「구분」 열 번호와 끄면 사라져야 할 값(있는 화면만)
SCREENS: list[dict] = [
    {'route': '/related-stocks', 'filters': ['OEM', '비상장'], 'sort': "'25 매출",
     'popup': True, 'typeCol': 0, 'typeOff': 'OEM'},
    {'route': '/domestic', 'filters': ['비상장'], 'sort': "'25 매출",
     'popup': True, 'typeCol': None, 'typeOff': None},
    {'route': '/parts-top100', 'filters': ['비상장'], 'sort': "'25 매출",
     'popup': True, 'typeCol': None, 'typeOff': None},
    # ⚠️ `/oem` 은 «정렬 머리글 0개 · 팝업 0개» 다. 게다가 「연간·월간」은 필터가 아니라
    #    차트의 «기간 전환 탭»(`role="tab"`)이라 **행 수가 안 변한다**(80 → 80).
    #    필터로 알고 걸었다가 2건이 빨개졌다 — 바뀌는 것은 «막대 개수»(951 ↔ 944)와
    #    선택된 탭이다. 그래서 이 화면만 다른 방식(`tabs`)으로 잰다.
    {'route': '/oem', 'filters': [], 'sort': None, 'popup': False,
     'typeCol': None, 'typeOff': None, 'tabs': ['월간', '연간']},

    # ── 표가 «없는» 화면들 (2026-09-09 2차 확장) ──────────────────────────────
    # 🔴 여기부터는 행 수로 못 잰다. 화면마다 «무엇이 달라지는지» 가 다르다:
    #    표가 바뀌는 곳 · 그림이 바뀌는 곳 · 버튼 선택 표시만 옮겨 가는 곳.
    #
    # `/management/pnl` — 버튼이 표를 바꾼다(상세 78→98행 · 별도 78→71행).
    #    ⚠️ 그림(svg) 지문으로 재면 «안 바뀐다» 고 나온다. 표로 재야 한다.
    {'route': '/management/pnl', 'filters': [], 'sort': None, 'popup': False,
     'typeCol': None, 'typeOff': None,
     'tablePairs': [('상세', '기본'), ('별도', '연결')]},

    # `/management/inventory` · `/management/personnel` — 버튼이 그림을 바꾼다.
    # 🔴 **이 화면의 버튼은 「하나만 고르기」가 아니라 «켜고 끄기» 다**(2026-09-09 실측).
    #    미국 → 우즈벡 → 미국 → 우즈벡 → 미국 을 눌러 봤더니 **다섯 번 다 새 상태**였다.
    #    라디오라면 두 상태를 오갔어야 한다. 그래서 서로 «다른» 두 버튼으로 짝을 지으면
    #    영영 처음으로 안 돌아온다 — 되돌리려면 **같은 버튼을 한 번 더** 눌러야 한다.
    {'route': '/management/inventory', 'filters': [], 'sort': None, 'popup': False,
     'typeCol': None, 'typeOff': None, 'chartPairs': [('미국', '미국')]},
    {'route': '/management/personnel', 'filters': [], 'sort': None, 'popup': False,
     'typeCol': None, 'typeOff': None, 'chartPairs': [('사무', '전체')]},

    # `/compare` — ⚠️ 회사 이름이 «단추처럼 보이지만» 토글이 아니라 **선택상자**다
    #    (`CompareCompanySelector` 의 `Select`). 토글로 알고 두 번 누르면 두 번째 클릭이
    #    **열려 있는 목록에 가로막혀** 30초 타임아웃이 난다(2026-09-09 실측).
    #    열고 → 다른 항목을 고르고 → 되돌리는 방식으로 잰다.
    {'route': '/compare', 'filters': [], 'sort': None, 'popup': False,
     'typeCol': None, 'typeOff': None, 'selects': [0]},

    # `/hansae` — 기간 버튼. 🔴 **그림 지문으로 재면 안 된다** — 1Y 와 5Y 는 자료가
    #    그만큼 없어 «같은 그림» 이 나온다(고장이 아니다). 선택 표시가 옮겨 가는지로 잰다.
    {'route': '/hansae', 'filters': [], 'sort': None, 'popup': False,
     'typeCol': None, 'typeOff': None, 'ranges': ['1D', '3M', '1Y']},

    # `/management/org-chart` — 🔴 **조직도는 그림 «파일» 이다**(2026-09-10 실측).
    #    ⚠️ 여기 선택상자는 `/compare` 와 «다른 물건» 이다 — 저쪽은 만든 부품
    #    (`[data-slot="select-trigger"]`)이지만 여기는 **브라우저 기본 `<select>`** 라
    #    `_openSelect` 가 0개를 만나 멈춘다. 그래서 `nativeSelect` 로 따로 잰다.
    #    🔴 **svg 지문으로 재면 안 된다** — 이 화면의 svg 14개는 조직도가 아니라 **메뉴
    #    아이콘**이라, 날짜를 바꿔도 지문이 «세 번 다 똑같았다»(실측 `2067657579`).
    #    바뀌는 것은 **그림 주소**뿐이다(`org-chart/image/4` → `image/3`).
    {'route': '/management/org-chart', 'filters': [], 'sort': None, 'popup': False,
     'typeCol': None, 'typeOff': None,
     'nativeSelect': 'org-chart/image/', 'dialogButton': '전체화면으로 보기'},

    # ⚠️ `/management/production` 은 **조작 요소가 하나도 없다**(버튼=로그아웃뿐).
    #    그래서 «일부러» 넣지 않았다 — 넣으면 「행이 있다」 한 줄만 재고 초록이 된다.
]


def _assertScreensMeasureSomething() -> None:
    """사양마다 «잴 것이 하나라도» 있는지 — 실행 «전에» 못 박는다.

    🔴 필터·탭·정렬·팝업이 전부 비어 있으면 그 화면은 「표에 행이 있다」 한 줄만 재고
    초록으로 끝난다. 화면을 추가하다 사양을 덜 적으면 **검사한 척** 이 되는 자리다.
    """
    keys = ('filters', 'tabs', 'sort', 'popup', 'ranges', 'tablePairs', 'chartPairs',
            'selects', 'nativeSelect', 'dialogButton')
    for spec in SCREENS:
        if not any(spec.get(k) for k in keys):
            raise SystemExit(f"{spec['route']}: 잴 조작이 하나도 없다 — 사양을 채울 것")


def parseNum(text: str) -> float | None:
    """표 칸의 글자에서 숫자를 뽑는다 — 쉼표·단위·부호를 견딘다.

    ⚠️ 숫자가 없으면 `0` 이 아니라 `None` 이다. 빈 칸을 0으로 읽으면 정렬 시험이
    「맨 아래가 0이니 내림차순 맞다」로 **틀린 채 통과**한다.
    """
    t = (text or '').replace(',', '').strip()
    m = re.search(r'-?\d+(?:\.\d+)?', t)
    return float(m.group()) if m else None


def isDescending(vals: list[float]) -> bool:
    return all(a >= b for a, b in zip(vals, vals[1:]))


def isAscending(vals: list[float]) -> bool:
    return all(a <= b for a, b in zip(vals, vals[1:]))


def colTexts(page, idx: int) -> list[str]:
    """한 열의 글자들 — 열 번호가 행 칸 수를 넘으면 빈 문자열."""
    out = []
    for tr in page.query_selector_all('tbody tr'):
        tds = tr.query_selector_all('td')
        out.append((tds[idx].inner_text() or '').strip() if idx < len(tds) else '')
    return out


def rowCount(page) -> int:
    return len(page.query_selector_all('tbody tr'))


def colValues(page, idx: int) -> list[float]:
    """한 열의 숫자들 — 빈 칸은 «버린다»(0으로 바꾸지 않는다. 위 parseNum 참조)."""
    vals: list[float] = []
    for tr in page.query_selector_all('tbody tr'):
        tds = tr.query_selector_all('td')
        if idx < len(tds):
            v = parseNum(tds[idx].inner_text())
            if v is not None:
                vals.append(v)
    return vals


def headerIndex(page, label: str) -> int:
    for i, th in enumerate(page.query_selector_all('th')):
        if label in (th.inner_text() or ''):
            return i
    raise RuntimeError(f'머리글 「{label}」 을 못 찾았다 — 열 구성이 바뀌었는지 볼 것')


def login(page) -> None:
    page.goto(f'{BASE}/login', wait_until='networkidle', timeout=60000)
    page.fill('input[name="id"]', USER)
    page.fill('input[name="password"]', PASS)
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle', timeout=60000)
    # 로그인 리다이렉트 체인은 networkidle 뒤에도 진행 중이다(gotchas-playwright-ui.md).
    page.wait_for_timeout(2500)


def clickButton(page, label: str) -> None:
    """본문 글자가 정확히 `label` 인 버튼을 누른다.

    🔴 «정확히» 같아야 한다. 부분일치로 하면 `/domestic` 의 「상장」이
    「비상장」에도 걸려 엉뚱한 버튼을 누른다(그러고도 행 수는 변해서 통과한다).
    """
    for btn in page.query_selector_all('button'):
        if (btn.inner_text() or '').strip() == label:
            btn.click()
            page.wait_for_timeout(500)
            return
    raise RuntimeError(f'버튼 「{label}」 을 못 찾았다')


def checkFilters(page, spec: dict, nAll: int) -> list[tuple[str, bool, str]]:
    """필터를 껐다 켜며 «양방향» 으로 본다.

    🔴 「끄면 줄어든다」만 재면 아무 때나 0행을 내는 고장도 통과한다.
    반드시 «켜면 돌아오는지» 를 함께 잰다.
    """
    cases: list[tuple[str, bool, str]] = []
    for label in spec['filters']:
        clickButton(page, label)
        off = rowCount(page)
        cases.append((f'「{label}」 을 끄면 행 수가 달라진다',
                      off != nAll, f'{nAll} → {off}행'))

        # 「구분」 열이 있는 화면은 «남은 행이 실제로 조건에 맞는지» 까지 본다.
        if spec['typeOff'] and label == spec['typeOff'] and spec['typeCol'] is not None:
            left = colTexts(page, spec['typeCol'])
            n = sum(1 for t in left if t == spec['typeOff'])
            cases.append((f'끈 뒤 남은 행에 「{spec["typeOff"]}」 이 없다',
                          n == 0, f'남은 {n}건'))

        clickButton(page, label)
        back = rowCount(page)
        cases.append((f'「{label}」 을 다시 켜면 원래대로 돌아온다',
                      back == nAll, f'{back} vs 처음 {nAll}'))
    return cases


def svgSignature(page) -> str:
    """그려진 그림 전체의 지문 — 자료가 달라지면 이 값이 달라진다.

    ⚠️ 쓰기 전에 «가만히 둬도 그대로인지» 를 확인했다(2026-09-09 다섯 화면 실측 — 안정).
    애니메이션 때문에 저절로 바뀌면 이 지문으로는 아무것도 판정할 수 없다.
    🔴 **`outerHTML` 을 그대로 해시하면 안 된다**(2026-09-09 실측). recharts 는 다시 그릴
    때마다 `clipPath` 등에 **무작위 id** 를 새로 붙여서, 자료가 똑같아도 겉모양 문자열이
    매번 달라진다 — 「되돌렸는데 안 돌아왔다」의 진짜 원인이 이것이었다.
    그래서 **자료가 결정하는 것**(도형 좌표 · 글자)만 모아 잰다.
    """
    html = page.evaluate("""() => {
      const grab = (root) => {
        const shapes = Array.from(root.querySelectorAll('path, rect, circle'))
          .map(e => [e.getAttribute('d'), e.getAttribute('x'), e.getAttribute('y'),
                     e.getAttribute('width'), e.getAttribute('height'),
                     e.getAttribute('cx'), e.getAttribute('cy')].join(','));
        const texts = Array.from(root.querySelectorAll('text')).map(e => e.textContent);
        return shapes.concat(texts).join('|');
      };
      return Array.from(document.querySelectorAll('svg')).map(grab).join('#');
    }""")
    return hashlib.sha1((html or '').encode('utf-8', 'replace')).hexdigest()[:12]


def tableSignature(page) -> str:
    """표 내용 전체의 지문."""
    txt = page.evaluate("""() => Array.from(document.querySelectorAll('tbody tr'))
        .map(r => r.innerText).join('|')""")
    return hashlib.sha1((txt or '').encode('utf-8', 'replace')).hexdigest()[:12]


def stableSig(page, sigFn, tries: int = 8) -> str:
    """지문이 «멈출 때까지» 기다렸다가 읽는다.

    🔴 누른 «직후» 에 읽으면 안 된다(2026-09-09 실측 · 오탐 2건). recharts 는 다시 그릴 때
    막대를 애니메이션으로 늘리므로, 1.8초 뒤에 읽으면 **누를 때마다 다른 지문**이 나온다.
    「같은 버튼을 두 번 눌렀는데 지문이 매번 달랐다」가 그 증상이었다 — 화면 고장이 아니라
    **재는 시점이 틀린 것**이다. 연속 두 번이 같아질 때까지 기다린다.
    """
    prev = sigFn(page)
    for _ in range(tries):
        page.wait_for_timeout(700)
        now = sigFn(page)
        if now == prev:
            return now
        prev = now
    return prev


def sectionSigFor(label: str):
    """그 «버튼이 속한 차트» 만의 지문을 뜨는 함수를 만든다.

    🔴 화면 전체(svg 전부)를 재면 안 된다(2026-09-09 실측 · 오탐 3건).
    `/management/inventory` 는 차트 묶음이 넷이라, 한 묶음을 눌러도 «다른 묶음» 의
    그림까지 함께 지문에 들어가 **누를 때마다 새 지문**이 나온다. 되돌려도 안 돌아온 것은
    화면 고장이 아니라 **재는 범위가 넓었던 것**이다. 버튼에서 위로 올라가 그 버튼과
    같은 구역에 있는 svg 만 잰다.
    """
    js = """(label) => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText.trim() === label);
      if (!btn) return '';
      const grab = (root) => {
        const shapes = Array.from(root.querySelectorAll('path, rect, circle'))
          .map(e => [e.getAttribute('d'), e.getAttribute('x'), e.getAttribute('y'),
                     e.getAttribute('width'), e.getAttribute('height'),
                     e.getAttribute('cx'), e.getAttribute('cy')].join(','));
        const texts = Array.from(root.querySelectorAll('text')).map(e => e.textContent);
        return shapes.concat(texts).join('|');
      };
      let el = btn;
      for (let i = 0; i < 8 && el; i++) {
        el = el.parentElement;
        if (el && el.querySelector('svg')) {
          return Array.from(el.querySelectorAll('svg')).map(grab).join('#');
        }
      }
      return '';
    }"""

    def sig(page) -> str:
        html = page.evaluate(js, label)
        return hashlib.sha1((html or '').encode('utf-8', 'replace')).hexdigest()[:12]

    return sig


def activeRange(page) -> str:
    """기간 버튼 중 «선택된» 것의 이름.

    선택은 `bg-foreground` 클래스로 표시된다(`components/charts/RangeToggle.tsx`).
    """
    return page.evaluate("""() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find(x => x.className.includes('bg-foreground'));
      return b ? b.innerText.trim() : '';
    }""")


def checkRanges(page, spec: dict) -> list[tuple[str, bool, str]]:
    """기간 버튼 — «선택 표시가 옮겨 가는가» 로 잰다.

    🔴 그림 지문으로 재면 안 된다. `/hansae` 는 1Y 와 5Y 의 자료 범위가 같아
    **정상인데도** 그림이 똑같이 나온다 — 그것을 고장으로 읽으면 오진이다.
    """
    cases: list[tuple[str, bool, str]] = []
    for label in spec['ranges']:
        clickButton(page, label)
        page.wait_for_timeout(1500)
        now = activeRange(page)
        cases.append((f'「{label}」 을 누르면 그 기간이 선택된다',
                      now == label, f'선택={now or "없음"}'))
    return cases


def checkPairs(page, spec: dict, key: str, sigFn, what: str) -> list[tuple[str, bool, str]]:
    """두 단추를 번갈아 눌러 «바뀌고 되돌아오는지» 를 함께 잰다.

    🔴 「누르면 바뀐다」만 재면 아무 때나 아무거나 그리는 고장도 통과한다.
    짝의 두 번째를 눌렀을 때 **처음 지문으로 정확히 복귀** 해야 한다.

    ⚠️ **기준점을 「화면을 연 직후」로 잡으면 안 된다**(2026-09-09 실측 · 오탐 2건).
    `/management/inventory` 의 기본 선택은 「국내」가 아니어서, 미국 → 국내 로 눌러도
    처음 지문으로 안 돌아온다 — 고장이 아니라 **기준점이 틀린 것**이다.
    그래서 짝의 «두 번째를 먼저 눌러» 상태를 정해 두고, 그 자리를 기준으로 왕복을 잰다.
    """
    cases: list[tuple[str, bool, str]] = []
    for first, second in spec[key]:
        clickButton(page, second)          # 기준 상태를 «만들어» 둔다
        base = stableSig(page, sigFn)      # 🔴 멈춘 뒤에 읽는다(위 stableSig 참조)
        clickButton(page, first)
        mid = stableSig(page, sigFn)
        cases.append((f'「{first}」 을 누르면 {what}이 달라진다',
                      mid != base, f'{base} → {mid}'))
        clickButton(page, second)
        back = stableSig(page, sigFn)
        cases.append((f'「{second}」 을 누르면 처음 {what}으로 돌아온다',
                      back == base, f'{mid} → {back} (처음 {base})'))
    return cases


def _openSelect(page, idx: int):
    """idx 번째 선택상자를 열고 (현재값, 항목 목록) 을 돌려준다."""
    triggers = page.query_selector_all('[data-slot="select-trigger"]')
    if idx >= len(triggers):
        raise RuntimeError(f'{idx}번째 선택상자가 없다 — {len(triggers)}개뿐')
    trigger = triggers[idx]
    current = (trigger.inner_text() or '').strip()
    trigger.click()
    page.wait_for_timeout(900)
    opts = [(o, (o.inner_text() or '').strip())
            for o in page.query_selector_all('[role="option"]')]
    return current, opts


def checkSelects(page, spec: dict) -> list[tuple[str, bool, str]]:
    """선택상자 — 열고 · 다른 항목을 고르고 · 되돌린다.

    🔴 이 화면의 회사 이름은 **단추처럼 보이지만 선택상자**다. 토글로 알고 두 번 누르면
    두 번째 클릭이 «열려 있는 목록» 에 가로막혀 타임아웃이 난다(실측).
    ⚠️ 고르고 나면 방아쇠의 «글자가 바뀌므로» 이름으로 다시 찾을 수 없다 — 번호로 잡는다.
    """
    cases: list[tuple[str, bool, str]] = []
    for idx in spec['selects']:
        base = svgSignature(page)
        current, opts = _openSelect(page, idx)
        cases.append((f'{idx}번째 선택상자를 열면 항목이 나온다',
                      len(opts) >= 2, f'현재={current} · 항목 {len(opts)}개'))
        other = next((o for o, t in opts if t and t != current), None)
        if other is None:
            page.keyboard.press('Escape')
            cases.append(('고를 다른 항목이 있다', False, '없다'))
            continue

        other.click()
        mid = stableSig(page, svgSignature)
        cases.append(('다른 항목을 고르면 그림이 달라진다', mid != base, f'{base} → {mid}'))

        # 🔴 되돌리기 — 「바뀐다」만 재면 아무거나 그리는 고장도 통과한다.
        # ⚠️ 다만 **그림이 처음으로 돌아오기를 요구하면 안 된다**(2026-09-09 실측).
        #    두 칸에 같은 회사를 못 담는 설계라, 첫 칸을 B 로 바꾸면 B 가 들어 있던
        #    둘째 칸이 「(선택 안 함)」으로 비워지고 되돌려도 그 칸은 안 채워진다.
        #    그래서 «선택값이 원래대로 돌아오는지» 로 잰다.
        _, opts2 = _openSelect(page, idx)
        back = next((o for o, t in opts2 if t == current), None)
        if back is None:
            page.keyboard.press('Escape')
            cases.append(('원래 항목으로 되돌릴 수 있다', False, f'{current} 없음'))
            continue
        back.click()
        page.wait_for_timeout(1500)
        now = page.evaluate('''() => Array.from(
            document.querySelectorAll('[data-slot="select-trigger"]'))
            .map(x => x.innerText.trim())''')
        cases.append(('원래 항목으로 되돌리면 선택값이 원래대로 돌아온다',
                      bool(now) and now[idx] == current, f'{now} · 기대 {current}'))
    return cases


def imgSrcFor(page, marker: str) -> str | None:
    """`marker` 가 든 `<img>` 의 주소. 없으면 None — «없다» 를 통과로 만들지 않는다."""
    return page.evaluate(
        '''(m) => { const i = Array.from(document.querySelectorAll('img'))
                        .find(x => (x.src || '').includes(m));
                    return i ? i.src : null; }''', marker)


def checkNativeSelect(page, spec: dict) -> list[tuple[str, bool, str]]:
    """브라우저 «기본» 선택상자 — 고르면 그림이 바뀌고 되돌리면 돌아오는가.

    🔴 `checkSelects` 를 쓰면 안 된다. 저쪽은 만든 부품(`[data-slot="select-trigger"]`)을
    찾는데 이 화면은 기본 `<select>` 라 **0개를 만나 멈춘다**(2026-09-10 실측).
    🔴 판정을 **svg 지문으로 하면 안 된다** — 이 화면의 svg 는 조직도가 아니라 메뉴
    아이콘이라 날짜를 바꿔도 «똑같다». 자료가 결정하는 것은 **그림 주소**뿐이다.
    """
    marker = spec['nativeSelect']
    cases: list[tuple[str, bool, str]] = []

    sel = page.query_selector('select')
    if sel is None:
        return [('기본 선택상자가 있다', False, '못 찾았다')]

    vals = page.evaluate(
        "() => Array.from(document.querySelector('select').options).map(o => o.value)")
    cases.append(('선택상자에 고를 것이 둘 이상 있다', len(vals) >= 2, f'{len(vals)}개'))
    if len(vals) < 2:
        return cases

    first = page.evaluate("() => document.querySelector('select').value")
    base = imgSrcFor(page, marker)
    cases.append((f'그림({marker})이 있다', base is not None, base or '없다'))
    if base is None:
        return cases

    other = next(v for v in vals if v != first)
    page.select_option('select', other)
    page.wait_for_timeout(3000)
    mid = imgSrcFor(page, marker)
    cases.append(('다른 시점을 고르면 그림이 바뀐다',
                  mid is not None and mid != base, f'{base} → {mid}'))

    # 🔴 되돌리기 — 「바뀐다」만 재면 «아무 그림이나 내는 고장» 도 통과한다.
    page.select_option('select', first)
    page.wait_for_timeout(3000)
    back = imgSrcFor(page, marker)
    cases.append(('원래 시점으로 되돌리면 그림도 돌아온다', back == base, f'{back}'))
    return cases


def checkDialogButton(page, spec: dict) -> list[tuple[str, bool, str]]:
    """이름으로 지정한 단추 — 창이 뜨고 «Esc 로 닫히는지» 까지.

    ⚠️ `checkPopup` 은 뉴스 단추(`[title="뉴스 보기"]`)에 박혀 있어 재사용할 수 없다.
    🔴 닫히는 것도 함께 재야 한다 — 안 닫히면 다음 조작이 전부 가로막힌다.
    """
    label = spec['dialogButton']
    cases: list[tuple[str, bool, str]] = []
    cases.append(('열기 전에는 창이 없다',
                  page.query_selector('[role="dialog"]') is None, ''))

    btn = page.query_selector(f'button:has-text("{label}")')
    if btn is None:
        return cases + [(f'「{label}」 단추가 있다', False, '못 찾았다')]

    btn.click()
    page.wait_for_timeout(2500)
    dlg = page.query_selector('[role="dialog"]')
    cases.append((f'「{label}」 를 누르면 창이 뜬다', dlg is not None, ''))
    if dlg is None:
        return cases

    cases.append(('창에 내용이 있다(빈 껍데기가 아니다)',
                  len((dlg.inner_text() or '').strip()) > 5, ''))
    page.keyboard.press('Escape')
    page.wait_for_timeout(1500)
    cases.append(('Esc 를 누르면 창이 닫힌다',
                  page.query_selector('[role="dialog"]') is None, ''))
    return cases


def checkTabs(page, spec: dict) -> list[tuple[str, bool, str]]:
    """차트의 기간 전환 탭 — 표가 아니라 «그림» 이 달라지는 자리다.

    🔴 행 수로 재면 안 된다. 이 탭은 행을 거르지 않고 차트가 그리는 «기간» 을 바꾼다
    (`/oem` 에서 80행 그대로였다). 바뀌는 것은 **선택된 탭**과 **막대 개수**다.
    """
    cases: list[tuple[str, bool, str]] = []

    def selected() -> list[str]:
        return [(b.inner_text() or '').strip()
                for b in page.query_selector_all('[role="tab"][aria-selected="true"]')]

    def bars() -> int:
        return len(page.query_selector_all('.recharts-bar-rectangle'))

    before = bars()
    cases.append(('차트에 막대가 있다(없으면 아래 시험이 무의미하다)',
                  before > 0, f'{before}개'))
    if before == 0:
        return cases

    for label in spec['tabs']:
        clickButton(page, label)
        page.wait_for_timeout(1200)
        cases.append((f'「{label}」 을 누르면 그 탭이 선택된다',
                      label in selected(), f'선택 {selected()}'))
        after = bars()
        cases.append((f'「{label}」 로 바꾸면 차트가 다시 그려진다',
                      after > 0 and after != before, f'막대 {before} → {after}개'))
        before = after
    return cases


def checkSort(page, spec: dict, nAll: int) -> list[tuple[str, bool, str]]:
    """정렬 — 「순서가 바뀌었다」가 아니라 «값이 실제로 정렬돼 있는가» 를 잰다."""
    cases: list[tuple[str, bool, str]] = []
    header = spec['sort']
    idx = headerIndex(page, header)

    clickButton(page, header)
    desc = colValues(page, idx)
    cases.append((f'「{header}」 을 누르면 내림차순이 된다',
                  len(desc) >= 2 and isDescending(desc),
                  f'{len(desc)}개 · {desc[:2]} … {desc[-2:]}' if desc else '값 없음'))
    cases.append(('정렬해도 행 수는 그대로다(정렬이 자료를 잃지 않는다)',
                  rowCount(page) == nAll, f'{rowCount(page)} vs {nAll}'))

    clickButton(page, header)
    asc = colValues(page, idx)
    cases.append(('한 번 더 누르면 오름차순으로 뒤집힌다',
                  len(asc) >= 2 and isAscending(asc),
                  f'{asc[:2]} … {asc[-2:]}' if asc else '값 없음'))
    cases.append(('두 방향이 실제로 다르다(누르기만 하고 안 바뀌면 안 된다)',
                  desc != asc, ''))
    return cases


def checkPopup(page, route: str) -> list[tuple[str, bool, str]]:
    """팝업 — 뜨는 것과 «닫히는 것» 을 함께 잰다."""
    cases: list[tuple[str, bool, str]] = []
    page.goto(f'{BASE}{route}', wait_until='networkidle', timeout=60000)
    page.wait_for_timeout(2000)
    cases.append(('열기 전에는 팝업이 없다',
                  page.query_selector('[role="dialog"]') is None, ''))
    trigger = page.query_selector('[title="뉴스 보기"]')
    if trigger is None:
        cases.append(('뉴스 팝업 단추가 있다', False, '못 찾았다'))
        return cases
    trigger.click()
    page.wait_for_timeout(2500)
    dlg = page.query_selector('[role="dialog"]')
    cases.append(('단추를 누르면 팝업이 뜬다', dlg is not None, ''))
    if dlg is not None:
        body = (dlg.inner_text() or '').strip()
        cases.append(('팝업에 내용이 있다(빈 껍데기가 아니다)',
                      len(body) > 5, f'{len(body)}자'))
        page.keyboard.press('Escape')
        page.wait_for_timeout(1200)
        # 🔴 반대 방향 — 닫히는지도 잰다. 안 닫히면 다음 조작이 전부 막힌다.
        cases.append(('Esc 를 누르면 팝업이 닫힌다',
                      page.query_selector('[role="dialog"]') is None, ''))
    return cases


def runScreen(page, spec: dict) -> list[tuple[str, bool, str]]:
    """한 화면의 조작을 전부 본다 — 사양에 «있다고 적힌 것만»."""
    route = spec['route']
    cases: list[tuple[str, bool, str]] = []

    page.goto(f'{BASE}{route}', wait_until='networkidle', timeout=60000)
    page.wait_for_timeout(2500)

    nAll = rowCount(page)
    # 표가 «있어야 하는» 화면에서만 행을 따진다. 차트 화면은 행이 0이 정상이다.
    needsRows = bool(spec['filters'] or spec['sort'] or spec.get('tablePairs'))
    if needsRows:
        cases.append(('표에 행이 있다(없으면 아래 시험이 전부 무의미하다)',
                      nAll > 0, f'{nAll}행'))
        if nAll == 0:
            return cases

    if spec.get('ranges'):
        cases += checkRanges(page, spec)
    if spec.get('tablePairs'):
        cases += checkPairs(page, spec, 'tablePairs', tableSignature, '표')
    if spec.get('selects'):
        cases += checkSelects(page, spec)
    if spec.get('nativeSelect'):
        cases += checkNativeSelect(page, spec)
    if spec.get('dialogButton'):
        cases += checkDialogButton(page, spec)
    if spec.get('chartPairs'):
        # 🔴 지문 범위를 «그 버튼의 구역» 으로 좁힌다(위 sectionSigFor 참조).
        for pair in spec['chartPairs']:
            cases += checkPairs(page, {**spec, 'chartPairs': [pair]},
                                'chartPairs', sectionSigFor(pair[0]), '그림')
    if spec['filters']:
        cases += checkFilters(page, spec, nAll)
    if spec.get('tabs'):
        cases += checkTabs(page, spec)
    if spec['sort']:
        cases += checkSort(page, spec, nAll)
    if spec['popup']:
        cases += checkPopup(page, route)
    return cases


def runChecks(page, screens: list[dict] | None = None) -> list[tuple[str, bool, str]]:
    """모든 화면 — (시험 이름, 통과, 메모) 목록. 이름 앞에 화면 경로를 붙인다."""
    out: list[tuple[str, bool, str]] = []
    for spec in (screens if screens is not None else SCREENS):
        for name, ok, note in runScreen(page, spec):
            out.append((f"{spec['route']} · {name}", ok, note))
    return out


def selfTest() -> int:
    """판정 함수들이 «틀린 입력을 실제로 거르는가» — 브라우저 없이 잰다."""
    cases = [
        ('내림차순을 내림차순이라 한다', isDescending([3.0, 2.0, 2.0, 1.0])),
        ('오름차순을 내림차순이라 하지 않는다', not isDescending([1.0, 2.0])),
        ('오름차순을 오름차순이라 한다', isAscending([1.0, 2.0, 2.0])),
        ('내림차순을 오름차순이라 하지 않는다', not isAscending([2.0, 1.0])),
        ('쉼표가 든 숫자를 읽는다', parseNum('12,345') == 12345.0),
        ('음수를 읽는다', parseNum('-3.5%') == -3.5),
        ('숫자가 없으면 None 이다(0 이 아니다)', parseNum('—') is None),
    ]
    bad = [n for n, ok in cases if not ok]
    for n, ok in cases:
        print(f"  [{'OK  ' if ok else 'FAIL'}] {n}")
    print(f'자기시험 {len(cases) - len(bad)}/{len(cases)}')
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true')
    ap.add_argument('--headed', action='store_true', help='브라우저를 보이게(진단용)')
    ap.add_argument('--route', help='이 화면만 검사(예: /oem)')
    args = ap.parse_args()
    _assertScreensMeasureSomething()
    if args.self_test:
        return selfTest()

    if not USER or not PASS:
        print('[FAIL] ADMIN_ID / ADMIN_PW 가 없다 — .env.local 을 확인할 것')
        return 1

    screens = SCREENS
    if args.route:
        screens = [s for s in SCREENS if s['route'] == args.route]
        if not screens:
            # 🔴 조용히 0건으로 끝내지 않는다 — 「통과」로 보이면 안 된다.
            print(f'[FAIL] 「{args.route}」 사양이 없다. 있는 것: '
                  f'{[s["route"] for s in SCREENS]}')
            return 1

    print(f"[정보] 대상 {BASE} · 화면 {[s['route'] for s in screens]}")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={'width': 1600, 'height': 1000})
        page = ctx.new_page()
        try:
            login(page)
            cases = runChecks(page, screens)
        finally:
            ctx.close()
            browser.close()

    for name, ok, note in cases:
        tail = f' — {note}' if note else ''
        print(f"  [{'OK  ' if ok else 'FAIL'}] {name}{tail}")
    bad = [c for c in cases if not c[1]]
    print(f'\n{len(cases)}건 중 실패 {len(bad)}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
