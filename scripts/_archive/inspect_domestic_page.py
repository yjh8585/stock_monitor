"""Playwright로 /domestic 페이지를 직접 열어 DOM 상태 + 스크린샷.

확인 항목:
  - 행 개수 / 그룹 / 제품 / 고객사 / 매출 / OP / 주가 / 시총 등 셀이 비어있는 회사 식별
  - 빈 셀 카운트 + 샘플 5개 회사
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent

OUT_PNG = ROOT.parent / 'tmp' / 'domestic_top30.png'
OUT_PNG.parent.mkdir(parents=True, exist_ok=True)


def main() -> None:
  from playwright.sync_api import sync_playwright

  with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1920, 'height': 1200})
    page.goto('http://localhost:3000/domestic', wait_until='networkidle', timeout=30_000)
    page.wait_for_selector('table', timeout=10_000)

    # 스크린샷
    page.screenshot(path=str(OUT_PNG), full_page=False)
    print(f'스크린샷: {OUT_PNG}')

    # JS로 행 데이터 추출
    rows_data = page.evaluate("""
      () => {
        const rows = document.querySelectorAll('tbody tr');
        const result = [];
        for (const tr of rows) {
          const cells = tr.querySelectorAll('td');
          if (cells.length < 10) continue; // 펼침 행 스킵
          const get = (i) => cells[i]?.innerText?.trim() ?? '';
          result.push({
            group: get(0),
            name: get(1),
            product: get(2),
            customers: get(3),
            rev: get(4) + '|' + get(5) + '|' + get(6),
            cagr: get(7),
            op: get(8) + '|' + get(9) + '|' + get(10),
            debt: get(11),
            inv: get(12),
            price: get(13),
            mcap: get(14),
            per: get(15),
            pbr: get(16),
            ev: get(17),
          });
        }
        return result;
      }
    """)

    print(f'\n총 행 수: {len(rows_data)}')

    # 빈 셀 통계
    keys = ['group','product','customers','rev','cagr','op','debt','inv','price','mcap','per','pbr','ev']
    empty_count = {k: 0 for k in keys}
    for r in rows_data:
      for k in keys:
        v = r[k]
        if not v or v in ('—', '-', '|—|—', '—|—|—'):
          empty_count[k] += 1

    print('\n=== 빈/—  셀 수 (전체 행 기준) ===')
    for k in keys:
      print(f'  {k}: {empty_count[k]}/{len(rows_data)}')

    print('\n=== 처음 5개 행 ===')
    for r in rows_data[:5]:
      print(f"  {r['name']:30s} grp={r['group']:8s} prod={r['product'][:30]:30s} mcap={r['mcap']:8s} price={r['price']:10s}")

    print('\n=== 비상장사 5개 (price 비어있음 추정) ===')
    for r in rows_data:
      if not r['price'] or r['price'] in ('—','-'):
        print(f"  {r['name']:30s} grp={r['group']:8s} mcap={r['mcap']:8s} rev={r['rev']:30s}")

    browser.close()


if __name__ == '__main__':
  main()
