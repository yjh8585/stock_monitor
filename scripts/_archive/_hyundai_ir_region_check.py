"""현대차 IR 페이지 지역별 판매실적 audit (1회용).

전략 (페이지 JS 분석 결과 — sales-performance-summary-list.min.js):
  - .stack 요소의 mouseenter 이벤트 핸들러가 chartDataObj[index] 데이터를 tooltip에 채움
  - 데이터 소스: API /wsvc/ww/salesPerformanceSummary.item.do (POST) → chartDataObj 전역변수
  - 따라서 hover 일일이 안 해도 chartDataObj를 직접 읽으면 9개 region을 한 번에 수집 가능
  - 보조 검증: 일부 region에 hover해서 tooltip 일치 여부 확인

연도 dropdown(2021~2025)을 fn_summary_move_year(YYYY)로 순회하며 수집.
결과: data/_hyundai_ir_region_audit.json

도넛 차트(주요 차종 비중)는 PNG 이미지로 제공 → 이미지 URL만 별도 수집.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.bootstrap import init_script  # type: ignore  # noqa: E402

init_script(__file__)

import json  # noqa: E402

from loguru import logger  # noqa: E402
from playwright.sync_api import Page, sync_playwright  # noqa: E402

URL = 'https://www.hyundai.com/worldwide/ko/company/ir/ir-resources/sales-results'
OUT_DIR = Path(__file__).parent.parent / 'data'
OUT_DIR.mkdir(parents=True, exist_ok=True)

YEARS = [2025, 2024, 2023, 2022, 2021]
PAGE_TIMEOUT_MS = 90_000


def scroll_into_view(page: Page) -> None:
  page.evaluate('window.scrollTo(0, 0)')
  page.wait_for_timeout(800)
  for y in (800, 1500, 2200, 3000, 4000):
    page.evaluate(f'window.scrollTo(0, {y})')
    page.wait_for_timeout(500)
  page.evaluate("""
    () => {
      const el = document.querySelector('.region-performance-box .stack-chart-box');
      if (el) el.scrollIntoView({block: 'center'});
    }
  """)
  page.wait_for_timeout(1500)


def select_year(page: Page, year: int) -> None:
  """연도 dropdown 선택 — JS 함수 직접 호출."""
  page.evaluate(f"fn_summary_move_year('{year}')")
  page.wait_for_timeout(2500)
  for _ in range(20):
    title = page.locator('.region-performance-box h3.title').first.text_content() or ''
    if f'{year}년' in title:
      return
    page.wait_for_timeout(500)
  logger.warning(f'  title not updated to {year}: "{title}"')


def read_chart_data(page: Page) -> list[dict]:
  """전역변수 chartDataObj 읽기 (페이지 JS 분석에 따라 9개 region이 들어있음)."""
  data = page.evaluate("""
    () => {
      try {
        if (typeof chartDataObj !== 'undefined' && Array.isArray(chartDataObj)) {
          return chartDataObj.map(d => ({
            region: d.region ?? d.name ?? d.label ?? null,
            value: d.value ?? d.count ?? d.units ?? null,
            color: d.color ?? null,
            pct: d.pct ?? d.percent ?? d.percentage ?? null,
            raw: d,
          }));
        }
        return [];
      } catch (e) { return [{ error: String(e) }]; }
    }
  """)
  return data or []


def read_stack_widths(page: Page) -> dict[str, float]:
  """stack-1 ~ stack-others의 width% (백업 — chartDataObj가 없을 때)."""
  return page.evaluate("""
    () => {
      const out = {};
      document.querySelectorAll('.region-performance-box .stack-chart-box .stack').forEach(el => {
        const cls = Array.from(el.classList).find(c => c.startsWith('stack-'));
        if (cls) out[cls] = parseFloat(el.style.width.replace('%',''));
      });
      return out;
    }
  """)


def hover_probe(page: Page, stack_key: str) -> dict | None:
  """일부 region 검증용 hover. mouseenter 이벤트 직접 dispatch."""
  result = page.evaluate(f"""
    () => {{
      const el = document.querySelector('.region-performance-box .stack-chart-box .stack.{stack_key}');
      if (!el) return null;
      const evt = new MouseEvent('mouseenter', {{ bubbles: true, cancelable: true, view: window }});
      el.dispatchEvent(evt);
      // tooltip 채워질 시간
      return new Promise(resolve => {{
        setTimeout(() => {{
          const t = document.querySelector('.region-performance-box .tooltip');
          if (!t) return resolve(null);
          const year = t.querySelector('.year')?.textContent?.trim() || '';
          const region = t.querySelector('.tooltip-bottom .legend .region')?.textContent?.trim() || '';
          const count = t.querySelector('.tooltip-bottom .count')?.textContent?.trim() || '';
          const full = (t.textContent || '').replace(/\\s+/g, ' ').trim();
          resolve({{ year, region, count, full }});
        }}, 300);
      }});
    }}
  """)
  return result


def collect_year(page: Page, year: int) -> dict:
  select_year(page, year)
  scroll_into_view(page)

  title_text = page.locator('.region-performance-box h3.title').first.text_content() or ''
  import re
  total_m = re.search(r'총\s*([\d,]+)\s*대', title_text)
  total_units = int(total_m.group(1).replace(',', '')) if total_m else None

  chart_data = read_chart_data(page)
  widths = read_stack_widths(page)

  # 검증용: 첫 번째와 마지막 region을 hover로 한 번 더 확인
  probe1 = hover_probe(page, 'stack-1')
  probe_last = hover_probe(page, 'stack-others')

  return {
    'title': title_text.strip(),
    'total_units': total_units,
    'chart_data': chart_data,
    'stack_widths': widths,
    'hover_probe_stack1': probe1,
    'hover_probe_others': probe_last,
  }


def collect_donut_images(page: Page) -> dict:
  """주요 차종 비중은 PNG 이미지."""
  return page.evaluate("""
    () => {
      const box = document.querySelector('.vehicle-rate-box');
      if (!box) return null;
      const title = box.querySelector('h3.title')?.textContent?.trim() || '';
      const images = Array.from(box.querySelectorAll('img')).map(img => ({
        src: img.getAttribute('src') || '',
        dataSrc: img.getAttribute('data-src') || '',
        alt: img.alt || '',
      }));
      return { title, images };
    }
  """) or {}


def fetch_api_directly(page: Page, year: int) -> dict | None:
  """API 직접 호출 — chartDataObj가 비어있을 때 fallback."""
  result = page.evaluate(f"""
    async () => {{
      try {{
        const res = await fetch('/wsvc/ww/salesPerformanceSummary.item.do', {{
          method: 'POST',
          headers: {{'Content-Type': 'application/x-www-form-urlencoded'}},
          body: 'year={year}&lang=ko',
        }});
        const txt = await res.text();
        try {{ return {{ json: JSON.parse(txt), status: res.status }}; }}
        catch (e) {{ return {{ text: txt.slice(0, 3000), status: res.status }}; }}
      }} catch (e) {{ return {{ error: String(e) }}; }}
    }}
  """)
  return result


def main() -> None:
  with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, locale='ko-KR')
    page = ctx.new_page()

    logger.info(f'navigating: {URL}')
    page.goto(URL, wait_until='domcontentloaded', timeout=PAGE_TIMEOUT_MS)
    page.wait_for_timeout(4000)
    scroll_into_view(page)
    page.wait_for_selector(
      '.region-performance-box .stack-chart-box .stack.stack-1',
      state='attached', timeout=30_000,
    )
    page.wait_for_timeout(2000)

    result: dict = {'years': {}, 'donut_images': {}, 'api_probe': {}}

    # 첫 연도(2025)에서 API 한 번 시도
    api_2025 = fetch_api_directly(page, 2025)
    result['api_probe']['2025'] = api_2025

    for year in YEARS:
      logger.info(f'==== {year} ====')
      try:
        y_data = collect_year(page, year)
        result['years'][str(year)] = y_data
        # 도넛 이미지는 연도별로 src가 바뀌므로 매번 수집
        result['donut_images'][str(year)] = collect_donut_images(page)
        # 요약 로그
        cd = y_data.get('chart_data') or []
        if cd:
          summary = ', '.join(f"{d.get('region')}={d.get('value')}" for d in cd[:3])
          logger.info(f'  chartDataObj sample: {summary} ... ({len(cd)} items)')
        else:
          logger.info(f'  chartDataObj empty — stack_widths: {y_data.get("stack_widths")}')
        probe = y_data.get('hover_probe_stack1') or {}
        if probe.get('count'):
          logger.info(f'  hover[stack-1] tooltip: {probe.get("region")} | {probe.get("count")}')
      except Exception as e:
        logger.error(f'{year} fail: {e}')
        result['years'][str(year)] = {'error': str(e)}

    out_path = OUT_DIR / '_hyundai_ir_region_audit.json'
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    logger.info(f'saved: {out_path}')

    browser.close()


if __name__ == '__main__':
  main()
