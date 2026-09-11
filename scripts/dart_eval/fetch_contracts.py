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
    <볼트>/지식/_추출/dart-contract/<회사>_<rcp>/page_01.jpg …  (235장이면 page_001 — 자릿수는 장수에서)
    <볼트>/지식/_추출/dart-contract/<회사>_<rcp>/_meta.json
        {rcp, corp, deal, att_name, n_expected, missing, pages: [{file, src_url, bytes}]}

실행:
    ./scripts/venv/Scripts/python.exe -X utf8 -u scripts/dart_eval/fetch_contracts.py --limit 5
    ... --renumber    이미 받은 폴더의 파일명·순서만 다시 매긴다(네트워크 0회)
"""

import argparse
import datetime as _dt
import json
import os
import re
import sys
import time
from html import unescape
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
# 🔴 「계약서 첨부가 없는 공시」를 적어 둔다 — 안 적으면 매 회차 다시 물어본다.
#    실측 2026-09-11: 후보 880건 중 첨부 보유는 302건(34.4%)뿐이고, 나머지 577건에
#    매주 네트워크 요청을 되풀이해 약 19분을 쓰고 산출은 0건이었다.
NO_ATT = OUT_DIR / "_no-attachment.json"

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
        v = unescape(v)
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
        src = unescape(src)
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


def page_name(i: int, total: int, url: str) -> str:
    """`page_007.jpg` — 🔴 0채움 자릿수를 **전체 장수에서 뽑는다**.

    2자리 고정이면 100장 넘는 폴더에서 파일명 사전순이 `page_09 → page_10 → page_100 → …
    → page_11` 로 깨진다(KT지니뮤직 235장에서 실제로 깨졌다). `_meta.json` 의 배열 순서는
    맞더라도 Task 2 가 `glob("page_*")` + `sorted()` 로 읽는 순간 계약서 4종이 뒤섞인다 —
    `sort_pages` 로 고친 것과 **같은 종류의 사고가 파일명 층에서 되살아난 것**이다.
    """
    return f"page_{i:0{max(2, len(str(total)))}d}{ext_of(url)}"


NEVER_FETCHED = -1
UNKNOWN = -2  # `_meta.json` 은 있는데 `missing` 키가 없다 — 완전한지 «판정할 수 없다»


def n_missing(folder: Path) -> int:
    """빠진 장 수. `NEVER_FETCHED`(-1) = 받은 적 없음 · `UNKNOWN`(-2) = 판정 불가.

    🔴 `_meta.json` 이 있다는 것만으로 건너뛰면, 페이지 일부가 실패한 폴더가 영원히
       「받음」으로 굳는다. 계약서는 한 장이 빠지면 그 조항이 통째로 사라지는데,
       콘솔 로그가 사라지면 빠졌다는 사실 자체가 남지 않는다.
    🔴 그리고 **키가 없는 것을 「빈 배열」로 읽지 않는다.** `.get("missing", [])` 로
       읽으면 옛 폴더가 기본값 덕에 «우연히» 완전해 보인다 — 못 잰 것은 0 이 아니다.
    """
    p = folder / "_meta.json"
    if not p.exists():
        return NEVER_FETCHED
    meta = json.loads(p.read_text(encoding="utf-8"))
    if "missing" not in meta:
        return UNKNOWN
    return len(meta["missing"])


def load_no_attachment() -> dict:
    """계약서 첨부가 없다고 이미 확인된 공시들. 실패해도 비어 있는 것으로 본다."""
    if not NO_ATT.exists():
        return {}
    try:
        return json.loads(NO_ATT.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        print(f"  ⚠️ {NO_ATT.name} 를 못 읽었다 — 없는 것으로 보고 진행한다")
        return {}


def remember_no_attachment(rcp: str, corp: str, why: str) -> None:
    """🔴 「없다」를 기록한다. 안 적으면 다음 회차가 같은 요청을 다시 보낸다."""
    d = load_no_attachment()
    d[rcp] = {"corp": corp, "why": why, "checked": _dt.date.today().isoformat()}
    NO_ATT.parent.mkdir(parents=True, exist_ok=True)
    NO_ATT.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def fetch_one(row: dict) -> dict | None:
    """공시 1건의 계약서 첨부를 폴더 하나로 내려받는다. 대상 없거나 건너뛰면 None."""
    rcp, corp = row["rcp"], row.get("corp")
    folder = OUT_DIR / f"{safe(corp)}_{rcp}"
    n_lost = n_missing(folder)
    if n_lost == UNKNOWN:
        # 🔴 조용히 통과시키지 않는다. 다시 받지도 않는다(네트워크를 아끼려고) —
        #    `--renumber` 가 파일에서 세워 백필한다.
        print(f"  🔴 건너뜀(완전한지 판정 불가 — `--renumber` 로 키를 백필할 것) {corp} {rcp}")
        return None
    if n_lost == 0:
        # 🔴 None 을 돌려준다 — 건너뛴 것을 「받았다」로 세면 `--limit` 이 소진돼
        #    「이어서 더 받기」가 안 된다.
        print(f"  건너뜀(이미 받음) {corp} {rcp}")
        return None
    if n_lost > 0:
        print(f"  다시 시도(빠진 {n_lost}장) {corp} {rcp}")

    pairs = att_pairs(rcp)
    if not pairs:
        remember_no_attachment(rcp, corp, "첨부 목록이 비었다")
        return None
    targets = [p for p in pairs if CONTRACT_RE.search(p[0])]
    if not targets:
        remember_no_attachment(rcp, corp, "첨부는 있으나 「계약서(계획서)」가 없다")
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
    pages, sizes, missing = [], [], []
    for i, u in enumerate(urls, 1):
        fn = page_name(i, len(urls), u)
        p = folder / fn
        if p.exists() and p.stat().st_size > 0:
            # 앞선 실행이 이미 받아 둔 장 — 다시 받지 않는다(빠진 장만 메우려는 것이다).
            size = p.stat().st_size
        else:
            blob = get_bytes(u)
            if blob is None:
                print(f"    !! page {i} 실패 — 미완으로 남긴다")
                missing.append({"page": i, "src_url": u})
                continue
            p.write_bytes(blob)
            size = len(blob)
        pages.append({"file": fn, "src_url": u, "bytes": size})
        sizes.append(size)

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
        "n_expected": len(urls),
        # 🔴 빠진 장을 여기 남긴다. 비어 있지 않으면 다음 실행이 **건너뛰지 않고 다시 시도**한다.
        #    계약서는 한 장이 빠지면 그 조항이 통째로 사라진다 — 「받음」으로 굳히면 안 된다.
        "missing": missing,
        "pages": pages,
    }
    (folder / "_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    total = sum(sizes)
    uniq = len(set(sizes))
    warn = "  🔴 크기가 모두 같다 — 아이콘 의심" if len(sizes) > 1 and uniq == 1 else ""
    if missing:
        warn += f"  🔴 {len(missing)}장 빠짐(미완 — 다음 실행이 다시 시도한다)"
    print(f"  ok {corp} {rcp} · {len(pages)}/{len(urls)}장 · {total:,}바이트 · 크기종류 {uniq}{warn}")
    print(f"     {folder}")
    return meta


def renumber(folder: Path) -> str:
    """이미 받아 둔 폴더의 페이지 순서를 `sort_pages` 규칙으로 **다시 매긴다**(네트워크 0회).

    정렬 규칙이 나아졌을 때 21MB 를 다시 받지 않으려고 둔다 — DART 를 다시 두들기는 것이
    가장 비싼 실패다. 판단 근거는 `_meta.json` 의 `src_url` 이라 원본 이름이 그대로 남아 있다.
    """
    # 🔴 앞선 실행이 2단 개명 도중 끊겼으면 `.tmp` 가 남는다. 되돌려 놓고 시작한다
    #    (안 되돌리면 `_meta.json` 은 옛 이름을 가리키는데 파일이 없어 재실행이 죽는다).
    for t in folder.glob("*.tmp"):
        orig = t.with_suffix("")
        if not orig.exists():
            t.rename(orig)

    meta = json.loads((folder / "_meta.json").read_text(encoding="utf-8"))
    by_url = {p["src_url"]: p for p in meta["pages"]}
    ordered = sort_pages(list(by_url))
    total = len(ordered)
    want = [{"file": page_name(i, total, u), "src_url": u, "bytes": by_url[u]["bytes"]}
            for i, u in enumerate(ordered, 1)]

    # 메타엔 있는데 파일이 없는 장. 🔴 순서가 이미 맞는 폴더에서도 확인해야 한다 —
    #    「그대로」로 일찍 빠져나가면 빠진 장이 영영 안 보인다.
    lost = [{"page": i, "src_url": u} for i, u in enumerate(ordered, 1)
            if not (folder / by_url[u]["file"]).exists()]
    same = want == meta["pages"]

    # 🔴 옛 폴더(1차 수집분)엔 `n_expected`·`missing` 키가 **아예 없다.**
    #    그러면 skip 판정이 `.get("missing", [])` 의 기본값 덕에 «우연히» 0 으로 읽힐 뿐,
    #    「이 폴더는 완전하다」가 파일에 **기록돼 있지는 않다** — Important 2 를 고친 목적이
    #    「빠진 장이 있다는 사실이 남게 한다」였으니 키 부재를 조용히 통과시키면 안 된다.
    #    수집 당시에 «잰» 값이 아니라 사후에 파일에서 «세운» 값이므로 출처를 함께 남긴다.
    backfilled = False
    if "n_expected" not in meta:
        meta["n_expected"] = len(ordered)
        meta["n_expected_source"] = "backfill"
        backfilled = True
    if "missing" not in meta:
        meta["missing"] = []
        backfilled = True

    if same and not lost and not backfilled:
        return "그대로"

    if not same:
        # 2단 개명 — `page_02 -> page_01` 같은 자리바꿈이 서로를 덮어쓰지 않게 한다.
        tmp = {}
        for u in ordered:
            src = folder / by_url[u]["file"]
            if src.exists():
                dst = folder / (by_url[u]["file"] + ".tmp")
                src.rename(dst)
                tmp[u] = dst
        for i, u in enumerate(ordered, 1):
            if u in tmp:
                tmp[u].rename(folder / want[i - 1]["file"])
        meta["pages"] = want

    if lost:
        # 「받음」으로 굳지 않게 미완으로 표시한다 — 다음 실행이 다시 받는다.
        seen = {m["src_url"] for m in meta["missing"]}
        meta["missing"] = meta["missing"] + [m for m in lost if m["src_url"] not in seen]
    (folder / "_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    head = "다시 매김" if not same else ("키 백필" if backfilled else "그대로")
    return f"{head}{f' 🔴 파일 없는 장 {len(lost)}' if lost else ''}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=5, help="내려받을 공시 수(기본 5 — 시험용)")
    ap.add_argument("--offset", type=int, default=0, help="대장 최신본 목록에서 건너뛸 수")
    ap.add_argument("--recheck", action="store_true",
                    help="🔴 「첨부 없음」 기록을 무시하고 다시 물어본다"
                         "(역추적으로 채운 기록에는 뷰어 실패가 섞여 있을 수 있다)")
    ap.add_argument("--rcp", default=None, help="쉼표로 구분한 rcpNo — 지정하면 그것만")
    ap.add_argument("--renumber", action="store_true",
                    help="이미 받은 폴더의 페이지 순서만 다시 매긴다(네트워크 0회)")
    ap.add_argument("--ledger", default=None,
                    help="다른 대장을 쓴다(기본은 지분 인수 대장). 합병 = ma-merger-dart.json")
    args = ap.parse_args()

    if args.renumber:
        n = 0
        for f in sorted(OUT_DIR.glob("*/")):
            if (f / "_meta.json").exists():
                print(f"  {renumber(f)}  {f.name}")
                n += 1
        print(f"\n대상 {n}폴더")
        return 0

    # 🔴 `--ledger` 로 다른 대장을 열 수 있다(2026-09-11 신설).
    #    기본 LEDGER 는 지분 인수 대장이라 합병 건은 `--rcp` 를 줘도 **0건**이 된다
    #    (`--rcp` 는 대장 안에서 걷러내는 장치지 대장 밖을 보는 장치가 아니다).
    # ⚠️ 대장마다 «최신본 표식»이 다르다 — 지분 인수는 `is_latest`, 합병은 `is_correction` 이다.
    #    한쪽만 보면 다른 대장에서 후보가 통째로 0건이 된다.
    ledger_path = Path(args.ledger) if args.ledger else LEDGER
    d = json.loads(ledger_path.read_text(encoding="utf-8"))
    rows = d["rows"] if isinstance(d, dict) else d
    if any("is_latest" in r for r in rows[:50]):
        pool = [r for r in rows if r.get("is_latest")]
    else:
        pool = [r for r in rows if not r.get("is_correction")]
    if args.rcp:
        want = {x.strip() for x in args.rcp.split(",") if x.strip()}
        pool = [r for r in pool if r["rcp"] in want]
    else:
        pool = pool[args.offset:]

    skip = {} if args.recheck else load_no_attachment()
    if skip and not args.rcp:
        before = len(pool)
        pool = [r for r in pool if r["rcp"] not in skip]
        if before != len(pool):
            print(f"「계약서 첨부 없음」으로 이미 확인된 {before - len(pool)}건은 건너뛴다 "
                  f"(기록 = {NO_ATT.name})")
    print(f"대장 {ledger_path.name} {len(rows)}행 · 최신본 후보 {len(pool)}건 · 간격 {GAP}초")
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
