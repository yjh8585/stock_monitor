"""현대차 IR 페이지 구조 진단 — selector 파악용 1회성 (headless).

용도: 그래프/dropdown/tooltip selector 추출 위해 DOM 구조 출력.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.bootstrap import init_script  # type: ignore  # noqa: E402

init_script(__file__)

import json  # noqa: E402
from pathlib import Path  # noqa: E402

from loguru import logger  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

URL = 'https://www.hyundai.com/worldwide/ko/company/ir/ir-resources/sales-results'
OUT_DIR = Path(__file__).parent.parent / 'data'
OUT_DIR.mkdir(parents=True, exist_ok=True)


def main() -> None:
  with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, locale='ko-KR')
    page = ctx.new_page()

    logger.info(f'navigating: {URL}')
    page.goto(URL, wait_until='domcontentloaded', timeout=60_000)
    page.wait_for_timeout(4000)

    # 페이지 스크롤로 그래프 lazy-load 유도
    for y in (300, 600, 900, 1500, 2200, 3000, 4000, 5000):
      page.evaluate(f'window.scrollTo(0, {y})')
      page.wait_for_timeout(700)

    # 최상단 복귀 후 천천히 다시 (chart visibility 재확인)
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(1500)
    for y in (1500, 2500, 3500):
      page.evaluate(f'window.scrollTo(0, {y})')
      page.wait_for_timeout(1200)

    page.wait_for_timeout(3000)

    # HTML 저장
    html_path = OUT_DIR / '_hyundai_ir_dump.html'
    html_path.write_text(page.content(), encoding='utf-8')
    logger.info(f'html dumped: {html_path}')

    # 스크린샷
    shot_path = OUT_DIR / '_hyundai_ir_full.png'
    page.screenshot(path=str(shot_path), full_page=True)
    logger.info(f'screenshot: {shot_path}')

    candidates_js = """
    () => {
      const out = [];

      // 1) 연도 dropdown 후보
      const selects = document.querySelectorAll('select, [role="combobox"], [class*="select"], [class*="dropdown"], [class*="Select"]');
      selects.forEach((el, i) => {
        if (i > 50) return;
        const txt = (el.innerText || el.value || '').slice(0, 200);
        if (txt.match(/202[0-9]/)) {
          out.push({ kind: 'year_dropdown', tag: el.tagName, cls: el.className?.toString()?.slice(0,150), id: el.id, txt });
        }
      });

      // 2) "지역별 판매실적" 근처
      const xp1 = document.evaluate("//*[contains(text(),'지역별 판매실적')]", document, null, XPathResult.ANY_TYPE, null);
      let n = xp1.iterateNext();
      let cnt = 0;
      while (n && cnt < 5) {
        out.push({ kind: 'region_label', tag: n.tagName, cls: n.className?.toString()?.slice(0,100), txt: (n.textContent || '').slice(0, 200) });
        n = xp1.iterateNext();
        cnt++;
      }

      // 3) 4,138,389 같은 총계 텍스트
      const xp2 = document.evaluate("//*[contains(text(),'4,138,389')]", document, null, XPathResult.ANY_TYPE, null);
      let m = xp2.iterateNext();
      cnt = 0;
      while (m && cnt < 10) {
        out.push({ kind: 'total_4138389', tag: m.tagName, cls: m.className?.toString()?.slice(0,100), txt: (m.textContent || '').slice(0, 250) });
        m = xp2.iterateNext();
        cnt++;
      }

      // 4) svg + rect (D3/recharts) 또는 div bar
      const svgs = document.querySelectorAll('svg');
      svgs.forEach((svg, i) => {
        if (i > 20) return;
        const rect = svg.getBoundingClientRect();
        if (rect.width > 200) {
          out.push({ kind: 'svg', idx: i, w: rect.width.toFixed(0), h: rect.height.toFixed(0), cls: (svg.className?.baseVal || svg.className?.toString() || '').slice(0,100), rects: svg.querySelectorAll('rect').length, paths: svg.querySelectorAll('path').length, g: svg.querySelectorAll('g').length });
        }
      });

      // 5) 북미/국내/유럽 같은 region label
      ['북미','국내','유럽','인도','중남미','중동/아프리카','아태','중국','기타','도매 판매 기준'].forEach(name => {
        const xp = document.evaluate(`//*[contains(text(),'${name}')]`, document, null, XPathResult.ANY_TYPE, null);
        let el = xp.iterateNext();
        let c2 = 0;
        while (el && c2 < 2) {
          const r = el.getBoundingClientRect();
          out.push({ kind: 'region', name, tag: el.tagName, cls: el.className?.toString()?.slice(0,100), x: r.x.toFixed(0), y: r.y.toFixed(0), txt: (el.textContent || '').slice(0,120) });
          el = xp.iterateNext();
          c2++;
        }
      });

      // 6) tooltip 후보
      ['[role="tooltip"]', '.tooltip', '[class*="tooltip"]', '[class*="Tooltip"]'].forEach(sel => {
        document.querySelectorAll(sel).forEach((el, i) => {
          if (i > 5) return;
          out.push({ kind: 'tooltip_candidate', sel, tag: el.tagName, cls: el.className?.toString()?.slice(0,100), txt: (el.textContent || '').slice(0, 100) });
        });
      });

      // 7) iframe
      document.querySelectorAll('iframe').forEach((f, i) => {
        out.push({ kind: 'iframe', idx: i, src: f.src, w: f.getBoundingClientRect().width.toFixed(0) });
      });

      // 8) "도매 판매 기준" 주석 근처 부모 트리
      const xp3 = document.evaluate("//*[contains(text(),'도매 판매 기준')]", document, null, XPathResult.ANY_TYPE, null);
      let z = xp3.iterateNext();
      while (z) {
        let p = z;
        const path = [];
        for (let i = 0; i < 6 && p; i++) {
          path.push(`${p.tagName}.${(p.className?.toString() || '').slice(0,40)}`);
          p = p.parentElement;
        }
        out.push({ kind: 'wholesale_note', path: path.join(' > ') });
        z = xp3.iterateNext();
      }

      return out;
    }
    """
    candidates = page.evaluate(candidates_js)

    out_path = OUT_DIR / '_hyundai_ir_inspect.json'
    out_path.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding='utf-8')
    logger.info(f'candidates saved: {out_path} ({len(candidates)} items)')

    browser.close()


if __name__ == '__main__':
  main()
