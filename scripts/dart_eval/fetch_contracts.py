"""공시 첨부 「계약서(계획서)」의 페이지 이미지를 내려받는다 (Task 1 · 5건 시험용).

왜 필요한가:
    `fetch_opinion.py` 는 첨부 목록을 보면서 이름에 「평가의견서/외부평가」가 든 것만 고르고
    나머지를 통째로 버렸다. 버려진 것 중에 **날인본 계약서**가 있었다(첨부 보유율 28/60 실측).
    계약서에는 의견서에 없는 것 — 진술보장·손해배상 한도·선행조건·매매대금 조정조항 — 이 있다.

Step 1 실측 (2026-08-28 · 산돌→윤디자인 20240531002991 dcmNo=9974759):
    🔴 계약서 첨부의 뷰어 본문은 **텍스트가 아니라 페이지 이미지 목록**이다(텍스트 971자뿐).
    실제 `<img src>` 모양 —
        /report/download.do?dcmNo=9974759&amp;flNm=%EC%9C%A4...%EB%B3%B8_240531_1.jpg
    ① 확장자는 `.png` 가 아니라 **`.jpg`** 다 → 받은 확장자를 그대로 쓴다(멋대로 .png 로
       바꿔 저장하면 Task 2 의 판독기가 헤더 불일치로 넘어진다).
    ② `&` 가 **`&amp;`** 로 이스케이프돼 있다 → 되돌리지 않으면 404.
    ③ HTML 안의 순서는 사전순(1, 10, 11, … 2, 20)이다 → **파일명 끝 숫자로 자연순 정렬**해야
       계약서 페이지 순서가 맞는다.
    ④ 이 문서엔 뷰어 껍데기 아이콘이 0개였지만, 다른 문서엔 있을 수 있어 `SKIP` 을 남긴다.

🔴 이 레포 규칙 준수 (`scripts/dart_eval/README.md` 「반드시 지킬 것」):
  - DART 웹은 IP를 차단한다. **간격 2초**를 줄이지 말 것(0.15초에서 걸려 26분 막혔다).
  - 첨부는 좌측 문서 트리가 아니라 **`<select id="att">`** 에 있고 `rcpNo`+`dcmNo` 쌍으로 연다.
  - env 는 `lib.bootstrap.init_script(__file__)` 로 로드한다.

산출 (Task 2 가 읽는다):
    <볼트>/지식/_추출/dart-contract/<회사>_<rcp>/page_01.jpg …
    <볼트>/지식/_추출/dart-contract/<회사>_<rcp>/_meta.json
        {rcp, corp, deal, att_name, pages: [{file, src_url}]}

실행:
    ./scripts/venv/Scripts/python.exe -X utf8 -u scripts/dart_eval/fetch_contracts.py --limit 5
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote

# 🔴 `lib` 는 레포 루트가 아니라 `scripts/` 아래에 있다(= parents[1]).
#    parents[2](레포 루트)로 잡으면 `No module named 'lib.bootstrap'` 로 죽는다.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

import requests  # noqa: E402

# 콘솔이 CP949 라 기호 출력에서 죽는다. 진단 print 가 파일 저장보다 앞이면 결과까지 날아간다.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GAP = 2.0          # 🔴 요청 간격(초) — 줄이지 말 것
BLOCK_WAIT = 1800  # 차단 감지 시 대기(초) — 실측 해제 26분
BASE = "https://dart.fss.or.kr"

LEDGER = Path(r"C:\Users\junghwan.yoon\workspace\1.테스트\agents\docs\data\ma-valuation-params.json")
VAULT = os.environ.get(
    "MANAGEMENT_VAULT_DIR",
    r"C:\Users\junghwan.yoon\workspace\3.옵시디언\20_경영")
OUT_DIR = Path(VAULT) / "지식" / "_추출" / "dart-contract"

S = requests.Session()
S.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://dart.fss.or.kr/",
})

# 첨부 이름이 계약서인지 판정한다. `probe_attachments.KINDS` 의 「계약서」 갈래와 같은 어휘.
CONTRACT_RE = re.compile(r"계약서|양수도계약|합병계약|주주간|출자계약|약정서")

IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.I)
SKIP = re.compile(r"/images/|logo|icon|btn|blank", re.I)

TREE_RE = re.compile(
    r"node\d+\['text'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['rcpNo'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['dcmNo'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['eleId'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['offset'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['length'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['dtd'\]\s*=\s*\"([^\"]*)\";",
    re.S,
)


# ─────────────────────────────── 요청 ───────────────────────────────

def get(url: str) -> str | None:
    """본문(텍스트). `probe_attachments.get` 과 같은 재시도·차단대기 규칙."""
    for i in range(4):
        try:
            r = S.get(url, timeout=40)
            time.sleep(GAP)
            return r.text
        except Exception:
            if i == 2:
                print(f"      !! 연속 실패 — 차단 추정. {BLOCK_WAIT // 60}분 대기", flush=True)
                time.sleep(BLOCK_WAIT)
            else:
                time.sleep(5 * (i + 1))
    return None


def get_bytes(url: str) -> bytes | None:
    """이미지(바이트). 텍스트와 같은 간격을 지킨다 — 페이지 수십 장도 예외가 아니다."""
    for i in range(4):
        try:
            r = S.get(url, timeout=60)
            time.sleep(GAP)
            if r.status_code != 200 or not r.content:
                return None
            return r.content
        except Exception:
            if i == 2:
                print(f"      !! 연속 실패 — 차단 추정. {BLOCK_WAIT // 60}분 대기", flush=True)
                time.sleep(BLOCK_WAIT)
            else:
                time.sleep(5 * (i + 1))
    return None


# ─────────────────────────────── 파싱 ───────────────────────────────

def att_pairs(rcp: str):
    """(문서명, 첨부rcpNo, dcmNo) — 🔴 첨부는 **원공시 rcpNo** 에 매달려 있다."""
    h = get(f"{BASE}/dsaf001/main.do?rcpNo={rcp}")
    if h is None:
        return None
    m = re.search(r'<select[^>]*id="att".*?</select>', h, re.S)
    if not m:
        return []
    out = []
    for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(0), re.S):
        v = v.replace("&amp;", "&")
        mr, md = re.search(r"rcpNo=(\d+)", v), re.search(r"dcmNo=(\d+)", v)
        if mr and md:
            nm = re.sub(r"\s+", " ", re.sub("<[^>]+>", "", t)).replace("\xa0", " ").strip()
            out.append((nm, mr.group(1), md.group(1)))
    return out


def page_urls(html: str, base: str = BASE) -> list[str]:
    """계약서 페이지 이미지 URL만 고른다. 뷰어 껍데기의 아이콘은 뺀다.

    🔴 `&amp;` 를 되돌린다(실측 — 그대로 요청하면 404).
    중복 src 는 한 번만 센다. 순서는 HTML 그대로다(자연순 정렬은 `sort_pages` 가 한다).
    """
    out: list[str] = []
    seen: set[str] = set()
    for src in IMG_RE.findall(html):
        if SKIP.search(src):
            continue
        src = src.replace("&amp;", "&")
        url = src if src.startswith("http") else base + src
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
    return out


DIGITS_RE = re.compile(r"(\d+)")


def _page_key(url: str) -> tuple[str, int, str]:
    """(문서 접두, 페이지 번호, 원본이름) — 파일명 **끝쪽 숫자 뭉치**를 페이지 번호로 읽는다.

    🔴 실측(2026-08-28)에서 파일명 서식이 **네 갈래**로 갈렸다. 하나만 보고 짜면 순서가 깨진다:
      ① `..._240531_1.jpg`      끝에 `_N`            (산돌·이원컴포텍)
      ② `...(양사날인)01.jpg`    밑줄 없이 붙은 `NN`   (F&F)
      ③ `1.jpg` `10.jpg`        번호만 · 0채움 없음   (아미코젠) — 이름순이면 1,10,11,…,2 가 된다
      ④ 한 첨부에 **문서가 여럿**  `신주인수계약서…_001.jpg` + `주주간계약서…_002.jpg`
         (KT지니뮤직 235장 = 계약서 4종 · 덱스터 58장 = 매도인별 계약서 다발)
         → 번호만 보고 정렬하면 **서로 다른 계약서의 페이지가 뒤섞인다.**
    그래서 「끝 숫자 앞까지」를 문서 접두로 삼아 **문서별로 묶은 뒤** 번호순으로 놓는다.
    """
    name = unquote(url.rsplit("=", 1)[-1])
    stem = re.sub(r"\.[A-Za-z0-9]+$", "", name)
    runs = list(DIGITS_RE.finditer(stem))
    if not runs:
        return (stem, -1, name)
    last = runs[-1]
    return (stem[:last.start()], int(last.group(1)), name)


def sort_pages(urls: list[str]) -> list[str]:
    """🔴 HTML 순서는 사전순(1, 10, 11, … 2)이다 — 계약서는 페이지 순서가 알맹이다."""
    return sorted(urls, key=_page_key)


def viewer_html(att_rcp: str, dcm: str) -> str | None:
    """첨부 main.do → 문서 트리 → viewer.do 2단 경유(`fetch_opinion.body` 와 같은 길)."""
    h = get(f"{BASE}/dsaf001/main.do?rcpNo={att_rcp}&dcmNo={dcm}")
    if h is None:
        return None
    nodes = TREE_RE.findall(h)
    if not nodes:
        return None
    n = max(nodes, key=lambda x: int(x[5]) if str(x[5]).isdigit() else 0)
    return get(f"{BASE}/report/viewer.do?rcpNo={n[1]}&dcmNo={n[2]}"
               f"&eleId={n[3]}&offset={n[4]}&length={n[5]}&dtd={n[6]}")


# ─────────────────────────────── 수집 ───────────────────────────────

SAFE_RE = re.compile(r'[\\/:*?"<>|]+')


def safe(name: str) -> str:
    return SAFE_RE.sub("_", (name or "unknown")).strip() or "unknown"


def ext_of(url: str) -> str:
    """받은 확장자를 그대로 쓴다(실측 `.jpg`). 모르면 `.jpg`."""
    name = unquote(url.rsplit("=", 1)[-1])
    m = re.search(r"\.(jpe?g|png|gif|tiff?)$", name, re.I)
    return f".{m.group(1).lower()}" if m else ".jpg"


def fetch_one(row: dict) -> dict | None:
    """공시 1건의 계약서 첨부를 폴더 하나로 내려받는다. 대상 없으면 None."""
    rcp, corp = row["rcp"], row.get("corp")
    folder = OUT_DIR / f"{safe(corp)}_{rcp}"
    if (folder / "_meta.json").exists():
        print(f"  건너뜀(이미 받음) {corp} {rcp}")
        return {"skipped": True, "dir": str(folder)}

    pairs = att_pairs(rcp)
    if not pairs:
        return None
    targets = [p for p in pairs if CONTRACT_RE.search(p[0])]
    if not targets:
        return None
    att_name, att_rcp, dcm = targets[0]

    hv = viewer_html(att_rcp, dcm)
    if hv is None:
        print(f"  !! 뷰어 실패 {corp} {rcp} — {att_name}")
        return None
    urls = sort_pages(page_urls(hv))
    if not urls:
        print(f"  !! 페이지 이미지 0장 {corp} {rcp} — {att_name} (SKIP 정규식 재점검)")
        return None

    folder.mkdir(parents=True, exist_ok=True)
    pages, sizes = [], []
    for i, u in enumerate(urls, 1):
        blob = get_bytes(u)
        if blob is None:
            print(f"    !! page {i} 실패")
            continue
        fn = f"page_{i:02d}{ext_of(u)}"
        (folder / fn).write_bytes(blob)
        pages.append({"file": fn, "src_url": u, "bytes": len(blob)})
        sizes.append(len(blob))

    meta = {
        "rcp": rcp,
        "corp": corp,
        "deal": {
            "report_nm": row.get("report_nm"),
            "dt": row.get("dt"),
            "deal_price_mn": row.get("deal_price_mn"),
            "agency": row.get("agency"),
        },
        "att_name": att_name,
        "att_rcp": att_rcp,
        "dcm_no": dcm,
        "pages": pages,
    }
    (folder / "_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    total = sum(sizes)
    uniq = len(set(sizes))
    warn = "  🔴 크기가 모두 같다 — 아이콘 의심" if len(sizes) > 1 and uniq == 1 else ""
    print(f"  ok {corp} {rcp} · {len(pages)}장 · {total:,}바이트 · 크기종류 {uniq}{warn}")
    print(f"     {folder}")
    return meta


def renumber(folder: Path) -> str:
    """이미 받아 둔 폴더의 페이지 순서를 `sort_pages` 규칙으로 **다시 매긴다**(네트워크 0회).

    정렬 규칙이 나아졌을 때 21MB 를 다시 받지 않으려고 둔다 — DART 를 다시 두들기는 것이
    가장 비싼 실패다. 판단 근거는 `_meta.json` 의 `src_url` 이라 원본 이름이 그대로 남아 있다.
    """
    meta = json.loads((folder / "_meta.json").read_text(encoding="utf-8"))
    by_url = {p["src_url"]: p for p in meta["pages"]}
    ordered = sort_pages(list(by_url))
    if [by_url[u]["file"] for u in ordered] == [p["file"] for p in meta["pages"]]:
        return "그대로"

    # 2단 개명 — `page_02 -> page_01` 같은 자리바꿈이 서로를 덮어쓰지 않게 한다.
    tmp = {}
    for u in ordered:
        src = folder / by_url[u]["file"]
        dst = folder / (by_url[u]["file"] + ".tmp")
        src.rename(dst)
        tmp[u] = dst
    pages = []
    for i, u in enumerate(ordered, 1):
        fn = f"page_{i:02d}{ext_of(u)}"
        tmp[u].rename(folder / fn)
        pages.append({"file": fn, "src_url": u, "bytes": by_url[u]["bytes"]})
    meta["pages"] = pages
    (folder / "_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return "다시 매김"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=5, help="내려받을 공시 수(기본 5 — 시험용)")
    ap.add_argument("--offset", type=int, default=0, help="대장 최신본 목록에서 건너뛸 수")
    ap.add_argument("--rcp", default=None, help="쉼표로 구분한 rcpNo — 지정하면 그것만")
    ap.add_argument("--renumber", action="store_true",
                    help="이미 받은 폴더의 페이지 순서만 다시 매긴다(네트워크 0회)")
    args = ap.parse_args()

    if args.renumber:
        n = 0
        for f in sorted(OUT_DIR.glob("*/")):
            if (f / "_meta.json").exists():
                print(f"  {renumber(f)}  {f.name}")
                n += 1
        print(f"\n대상 {n}폴더")
        return 0

    d = json.loads(LEDGER.read_text(encoding="utf-8"))
    rows = d["rows"] if isinstance(d, dict) else d
    pool = [r for r in rows if r.get("is_latest")]
    if args.rcp:
        want = {x.strip() for x in args.rcp.split(",") if x.strip()}
        pool = [r for r in pool if r["rcp"] in want]
    else:
        pool = pool[args.offset:]

    print(f"대장 {len(rows)}행 · 최신본 후보 {len(pool)}건 · 간격 {GAP}초")
    print(f"출력: {OUT_DIR}\n")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    done, tried = 0, 0
    for r in pool:
        if done >= args.limit:
            break
        tried += 1
        meta = fetch_one(r)
        if meta:
            done += 1

    print(f"\n완료 {done}건 / 시도 {tried}건")
    return 0 if done else 1


if __name__ == "__main__":
    raise SystemExit(main())
