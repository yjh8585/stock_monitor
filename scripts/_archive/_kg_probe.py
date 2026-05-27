"""KG 모빌리티 페이지 정찰용 1회성 스크립트. 작업 후 삭제."""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
  browser = p.chromium.launch()
  ctx = browser.new_context()
  page = ctx.new_page()
  page.goto('https://www.kg-mobility.com/cm/ir-data/sales-performance', wait_until='networkidle', timeout=60000)

  # 각 버튼별 가장 가까운 li/div/article 부모의 텍스트
  btns = page.locator('button.btn.file-down').all()
  print(f'btn count: {len(btns)}')
  for i, b in enumerate(btns):
    closest = b.evaluate('''el => {
      let cur = el.parentElement;
      let chain = [];
      for (let k = 0; k < 6 && cur; k++) {
        chain.push({tag: cur.tagName, cls: cur.className, text: (cur.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80)});
        cur = cur.parentElement;
      }
      return chain;
    }''')
    print(f'btn #{i}:')
    for j, c in enumerate(closest):
      print(f'  parent[{j}] tag={c["tag"]} cls={c["cls"]!r} text={c["text"]!r}')
  ctx.close()
  browser.close()
