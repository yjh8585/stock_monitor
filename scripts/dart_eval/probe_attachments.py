"""외부평가의견서 공시의 «다른 첨부문서»가 무엇인지 센다 (착수 전 실측 · 노트화 아님).

왜 필요한가 (2026-08-28 · 사용자 지적):
    `fetch_opinion.py` 는 첨부 목록을 **이미 보고 있었는데** 이름에 「평가의견서/외부평가」가
    든 것만 고르고 **나머지는 통째로 버렸다**(그 파일 283행).
    사용자 지적 — *"다른 첨부파일 보면 계약서가 있었을 거야. 계약서 자체도 아주 중요한 정보다."*
    → 버려진 것이 무엇인지 **먼저 세고** 나서 수집 계획을 세운다.
    설계 정본 = agents 레포 `docs/superpowers/plans/2026-08-28-ma-knowledge-audit.md`

🔴 이 스크립트는 «세기»만 한다. 본문을 받지도 저장하지도 않는다(공시당 요청 1회).

🔴 이 레포 규칙 준수 (`scripts/dart_eval/README.md` 「반드시 지킬 것」):
  - DART 웹은 IP를 차단한다. **간격 2초**를 줄이지 말 것(0.15초에서 걸려 26분 막혔다).
  - 첨부는 좌측 문서 트리가 아니라 **`<select id="att">`** 에 있다.
  - env 는 `lib.bootstrap.init_script(__file__)` 로 로드한다(`load_dotenv` 직접 호출은 구식).
    ※ 이 스크립트는 웹 스크래핑만 해서 키가 필요 없지만, 레포 관례를 따른다.

실행:
    ./scripts/venv/Scripts/python.exe -X utf8 -u scripts/dart_eval/probe_attachments.py --n 80
    ... --report-kw 합병        report_nm 에 그 말이 든 공시만 (회사합병결정 조사용)
"""

import argparse
import json
import random
import re
import sys
import time
from collections import Counter
from pathlib import Path

# 🔴 `lib` 는 레포 루트가 아니라 `scripts/` 아래에 있다(= parents[1]).
#    parents[2](레포 루트)로 잡으면 `No module named 'lib.bootstrap'` 로 죽는다.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

import requests  # noqa: E402

# 콘솔이 CP949 라 기호 출력에서 죽는다. 진단 print 가 파일 저장보다 앞이면 결과까지 날아간다.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GAP = 2.0  # 🔴 줄이지 말 것 — README 「반드시 지킬 것」 2
BLOCK_WAIT = 1800

S = requests.Session()
S.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://dart.fss.or.kr/",
})

LEDGER = Path(r"C:\Users\junghwan.yoon\workspace\1.테스트\agents\docs\data\ma-valuation-params.json")

# 첨부문서 이름을 갈래로 나눈다. 🔴 「계약서」가 이번 관심사다.
KINDS = [
    ("계약서", re.compile(r"계약서|양수도계약|합병계약|주주간|출자계약|약정서|MOU|양해각서|계약")),
    ("평가의견서", re.compile(r"평가의견서|외부평가")),
    ("감사·검토보고서", re.compile(r"감사보고서|검토보고서|재무제표")),
    ("증권신고서·투자설명서", re.compile(r"증권신고서|투자설명서|일괄신고")),
    ("이사회·주총", re.compile(r"이사회|의사록|주주총회|소집")),
    ("정관·등기", re.compile(r"정관|등기")),
    ("공정위·인허가", re.compile(r"기업결합|공정거래|인허가|승인")),
]


def classify(name: str) -> str:
    for label, rx in KINDS:
        if rx.search(name):
            return label
    return "기타"


def get(url: str) -> str | None:
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


def att_names(rcp: str):
    """첨부문서 이름 목록. 파싱은 `fetch_opinion.att_pairs` 와 같은 자리를 본다."""
    h = get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp}")
    if h is None:
        return None
    m = re.search(r'<select[^>]*id="att".*?</select>', h, re.S)
    if not m:
        return []
    out = []
    for _v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(0), re.S):
        nm = re.sub(r"\s+", " ", re.sub("<[^>]+>", "", t)).replace("\xa0", " ").strip()
        if nm:
            out.append(nm)
    return out


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


def att_pairs(rcp: str):
    """(문서명, 첨부rcpNo, dcmNo) — 🔴 첨부는 **원공시 rcpNo** 에 매달려 있다(README 「반드시 지킬 것」 1)."""
    h = get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp}")
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


def body_len(rcp_att: str, dcm: str):
    """(글자수, 판정). 🔴 알맹이가 있는지 보려는 것이지 본문을 «저장»하려는 게 아니다."""
    h = get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp_att}&dcmNo={dcm}")
    if h is None:
        return 0, "요청실패"
    nodes = TREE_RE.findall(h)
    if not nodes:
        return 0, "PDF첨부형(트리없음)"
    _t, rn, dn, ele, off, ln, dtd = nodes[0]
    url = (f"https://dart.fss.or.kr/report/viewer.do?rcpNo={rn}&dcmNo={dn}"
           f"&eleId={ele}&offset={off}&length={ln}&dtd={dtd}")
    hh = get(url)
    if hh is None:
        return 0, "본문실패"
    # 🔴 PDF 링크만 있고 본문이 없는 경우를 가른다 — 트리가 있어도 알맹이는 없을 수 있다.
    pdf = "있음" if re.search(r"\.pdf|download\.do|PDF", hh, re.I) else "없음"
    txt = re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", hh)).strip()
    return len(txt), f"ok/PDF링크{pdf}|{txt[:220]}"


def probe_bodies(rows, kw: str, limit: int) -> int:
    """첨부 이름에 `kw` 가 든 문서의 «본문 길이»만 재서 알맹이가 있는지 판정한다."""
    print(f"## 본문 알맹이 확인 — 이름에 '{kw}' 가 든 첨부 {limit}건\n")
    done = 0
    for r in rows:
        if done >= limit:
            break
        pairs = att_pairs(r["rcp"])
        if not pairs:
            continue
        for nm, arcp, dcm in pairs:
            if kw not in nm or done >= limit:
                continue
            n, status = body_len(arcp, dcm)
            print(f"  {n:8,}자 [{status}]  {r.get('corp')} — {nm[:50]}")
            done += 1
    print(f"\n확인 {done}건")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--body-kw", default=None, help="이 말이 든 첨부의 본문 «길이»만 재 본다")
    ap.add_argument("--body-limit", type=int, default=5)
    ap.add_argument("--n", type=int, default=80, help="표본 공시 수")
    ap.add_argument("--report-kw", default=None, help="report_nm 에 이 말이 든 공시만")
    ap.add_argument("--seed", type=int, default=20260828)
    ap.add_argument("--out", default=None)
    ap.add_argument("--rcps-file", default=None,
                    help="이 JSON 의 rcp 목록만 «전량» 훑는다(표본 추출을 건너뛴다)")
    args = ap.parse_args()

    # 🔴 `--rcps-file` 은 **다른 대장**의 건을 훑기 위한 길이다(2026-09-11 신설).
    #    이 스크립트의 LEDGER 는 지분 인수 대장(`ma-valuation-params.json`) 으로 박혔 있는데,
    #    합병 대장(`ma-merger-dart.json`) 의 「거래소 서식」 행에는 **외부평가 칸이 아예 없어**
    #    첨부 목록을 봐야만 평가의견서 유무를 안다. 대장을 바꾸는 대신 목록을 밖에서 받는다.
    #    ⚠️ 표본이 아니라 **전량**이다 — `--n` 은 무시된다.
    if args.rcps_file:
        rows = json.loads(Path(args.rcps_file).read_text(encoding="utf-8"))
        pool = rows
    else:
        rows = json.loads(LEDGER.read_text(encoding="utf-8"))
        if isinstance(rows, dict):
            rows = rows.get("rows") or next(iter(rows.values()))
        pool = [r for r in rows if r.get("is_latest")]
    if args.report_kw:
        pool = [r for r in pool if args.report_kw in (r.get("report_nm") or "")]
    tag = args.report_kw or "all"
    src = args.rcps_file or "대장"
    print(f"{src} {len(rows)}행 · 대상 {len(pool)}건" + (f" · '{args.report_kw}' 필터" if args.report_kw else ""))
    if not pool:
        print("대상 0건 — report_nm 값을 확인할 것")
        return 1

    if args.rcps_file:
        sample = pool          # 🔴 표본이 아니라 전량이다
    else:
        random.seed(args.seed)
        sample = random.sample(pool, min(args.n, len(pool)))

    if args.body_kw:
        return probe_bodies(sample, args.body_kw, args.body_limit)

    print(f"표본 {len(sample)}건 · 간격 {GAP}초 → 예상 {len(sample) * GAP / 60:.1f}분\n")

    kind_docs = Counter()
    kind_disclosures = Counter()
    name_counter = Counter()
    per_disclosure = []
    fails = 0

    for i, r in enumerate(sample, 1):
        names = att_names(r["rcp"])
        if names is None:
            fails += 1
            continue
        kinds = {classify(n) for n in names}
        for n in names:
            kind_docs[classify(n)] += 1
            name_counter[n[:60]] += 1
        for k in kinds:
            kind_disclosures[k] += 1
        per_disclosure.append({
            "rcp": r["rcp"], "corp": r.get("corp"), "report_nm": r.get("report_nm"),
            "n_att": len(names), "kinds": sorted(kinds), "names": names,
        })
        if i % 10 == 0:
            print(f"  {i}/{len(sample)} …", flush=True)

    ok = len(per_disclosure)
    print(f"\n조회 성공 {ok} · 실패 {fails}")
    if ok:
        print(f"공시당 첨부 평균 {sum(d['n_att'] for d in per_disclosure) / ok:.1f}개\n")

    print("## 갈래별 (그 갈래를 하나라도 가진 공시 수)")
    for k, _ in KINDS:
        n = kind_disclosures.get(k, 0)
        print(f"  {n:4d}공시 ({n / max(ok, 1) * 100:5.1f}%) · 문서 {kind_docs.get(k, 0):4d}  {k}")
    n = kind_disclosures.get("기타", 0)
    print(f"  {n:4d}공시 ({n / max(ok, 1) * 100:5.1f}%) · 문서 {kind_docs.get('기타', 0):4d}  기타")

    print("\n## 가장 흔한 첨부문서 이름 25")
    for nm, c in name_counter.most_common(25):
        print(f"  {c:4d}  {nm}")

    out = Path(args.out) if args.out else Path(f"scripts/dart_eval/probe_attachments_{tag}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "sampled": ok, "failed": fails, "report_kw": args.report_kw,
        "kind_disclosures": dict(kind_disclosures), "kind_docs": dict(kind_docs),
        "per_disclosure": per_disclosure,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n저장: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
