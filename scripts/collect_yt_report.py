"""자동 유튜브 → /reports 보고서(주요 장면·차트 포함) 오케스트레이터. GHA/로컬 겸용.

배경: Vercel 서버리스는 yt-dlp/ffmpeg를 못 돌려서, /api/posts(youtube 제출)가 이 스크립트를
GitHub Actions(collect-yt-report.yml)로 트리거한다. 흐름:
  자막 → LLM 본문+프레임계획 → 캡처(베스트에포트) → vision으로 실제 차트/장면 선별 →
  이미지 삽입 → Storage 업로드 → posts UPDATE(completed) → 캐시 무효화.

⚠️ 베스트에포트: 유튜브가 GHA 데이터센터 IP를 봇 차단(429/403)하면 캡처가 실패할 수 있다.
   그 경우 이미지 없이 텍스트만으로 graceful 완성(현재 자동 경로와 동일 품질). 성공률을 높이려면
   GitHub Secret `YOUTUBE_COOKIES`(로그인 브라우저에서 export한 cookies.txt 내용)를 넣는다.

수동 고품질 경로는 scripts/yt_report/ 툴킷(에이전트 주도) — report.md §7.

usage: python collect_yt_report.py --url <watch_url> [--post-id N] [--model claude-haiku-4-5]
"""
from __future__ import annotations

import argparse
import base64
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# scripts/yt_report 의 순수 헬퍼 재사용
sys.path.insert(0, str(Path(__file__).resolve().parent / "yt_report"))
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from _common import clean_vtt, find_ffmpeg, hhmmss, mmss_to_sec  # noqa: E402

try:
    from bootstrap import init_script  # 로컬 dotenv 로드(GHA에선 no-op)

    init_script(__file__)
except Exception:  # noqa: BLE001
    pass

import requests  # noqa: E402
from anthropic import Anthropic  # noqa: E402

CATEGORY_LIST = ["로봇", "기술", "부품사", "전기차", "자율주행", "시장", "OEM"]
DEFAULT_MODEL = os.environ.get("YT_REPORT_MODEL", "claude-haiku-4-5")
FRAME_OFFSETS = (4, 12, 20)  # slug당 후보 프레임(초)
WINDOW_BEFORE, WINDOW_LEN = 6, 30

RULES = """# 보고서 작성 규칙 (엄수)
- 첫 줄: 한 줄 핵심 요약을 인용블록(> ...). 이어서 `## 들어가며`(200~350자).
- 영상 흐름대로 `## 헤딩` 섹션들. 마지막에 `## 핵심 정리`(불릿) + `## 더 깊이 생각해볼 점`(3~5불릿).
- 중요한 수치·주장은 **굵게**. 영상에 없는 배경은 "참고로 ~"로 구분. 영어 고유명사는 한글(영문).
- 마크다운 렌더 함정: 연도/숫자 앞 백틱 금지('24년 또는 2024년). 취소선은 ~~쌍~~만. 단독 <br> 금지(빈 줄로 문단).
  CJK 인접 강조는 부호를 밖으로: '**피지컬 AI**'(권장).
- H1(#) 제목 금지 — 제목은 별도 필드. "이 글은…" 같은 메타 설명 금지.

# 프레임(스크린샷) 지점 — 중요
- 영상에서 **차트·그래프·표·도해가 나오는 지점, 그리고 핵심 장면**에 `[[FRAME:slug]]`를 그 한 줄만 있는 형태로 본문에 삽입.
- slug는 짧은 영어 스네이크케이스. 각 프레임에 timecode(MM:SS, 그 그래픽이 화면에 뜰 시점)·alt·caption(출처 포함)을 frames에 기재.
- 차트가 있으면 반드시 포함. 억지 프레임은 금지(순수 인터뷰면 핵심 장면 몇 개)."""

ARTICLE_TOOL = {
    "name": "report",
    "description": "유튜브 영상 스크립트로 작성한 한국어 해설 보고서와 프레임 계획.",
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "category": {"type": "string", "enum": CATEGORY_LIST},
            "body_markdown": {"type": "string", "description": "본문(플레이스홀더 [[FRAME:slug]] 포함)"},
            "frames": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "slug": {"type": "string"},
                        "timecode": {"type": "string"},
                        "alt": {"type": "string"},
                        "caption": {"type": "string"},
                    },
                    "required": ["slug", "timecode", "alt", "caption"],
                },
            },
        },
        "required": ["title", "category", "body_markdown", "frames"],
    },
}

SELECT_TOOL = {
    "name": "picks",
    "description": "각 몽타주에서 캡션이 말하는 차트/장면이 선명한 프레임을 고르거나 드롭.",
    "input_schema": {
        "type": "object",
        "properties": {
            "picks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "slug": {"type": "string"},
                        "keep": {"type": "boolean"},
                        "best": {"type": "integer", "description": "왼쪽부터 0-based 프레임 인덱스"},
                    },
                    "required": ["slug", "keep", "best"],
                },
            }
        },
        "required": ["picks"],
    },
}


def log(msg: str) -> None:
    print(msg, flush=True)


def video_id(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|/embed/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else url[-11:]


def oembed(url: str) -> dict:
    try:
        r = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": url, "format": "json"},
            timeout=15,
        )
        return r.json() if r.ok else {}
    except Exception:  # noqa: BLE001
        return {}


def cookies_arg() -> list[str]:
    """YOUTUBE_COOKIES(내용) 또는 YT_COOKIES_FILE(경로)가 있으면 yt-dlp --cookies 인자."""
    path = os.environ.get("YT_COOKIES_FILE")
    content = os.environ.get("YOUTUBE_COOKIES")
    if content and not path:
        f = Path(tempfile.gettempdir()) / "yt_cookies.txt"
        f.write_text(content, encoding="utf-8")
        path = str(f)
    return ["--cookies", path] if path and Path(path).exists() else []


def ytdlp(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "yt_dlp", "--no-warnings", *cookies_arg(), *args],
        check=False, capture_output=True, text=True,
    )


def fetch_transcript(url: str, run: Path) -> str:
    subs = run / "subs"
    subs.mkdir(parents=True, exist_ok=True)
    ytdlp(["--skip-download", "--write-subs", "--write-auto-subs",
           "--sub-langs", "ko-orig,ko,en", "--sub-format", "vtt",
           "-o", str(subs / "s.%(ext)s"), url])
    for name in ["s.ko-orig.vtt", "s.ko.vtt", "s.en.vtt"]:
        p = subs / name
        if p.exists():
            body, chars, _ = clean_vtt(p)
            if chars >= 80:
                return body
    return ""


def write_article(client: Anthropic, model: str, meta: dict, transcript: str) -> dict:
    prompt = (
        f"영상 제목: {meta.get('title','')}\n채널: {meta.get('author_name','')}\n\n"
        f"스크립트({len(transcript):,}자):\n\"\"\"\n{transcript}\n\"\"\"\n\n"
        f"{RULES}\n\n위 스크립트로 report 도구를 호출해 보고서를 작성하세요. "
        f"자동 자막이라 오타가 있으니 문맥으로 교정하고 인용은 다듬으세요. "
        f"소스 분량에 비례해 충분히 길게(짧은 영상 2,500자+, 긴 영상 5,000자+)."
    )
    r = client.messages.create(
        model=model, max_tokens=16000, tools=[ARTICLE_TOOL],
        tool_choice={"type": "tool", "name": "report"},
        messages=[{"role": "user", "content": prompt}],
    )
    for b in r.content:
        if b.type == "tool_use":
            return b.input
    raise RuntimeError("LLM이 본문을 생성하지 못했습니다.")


def capture_frames(vid: str, frames: list[dict], run: Path, ffbin: str, ff: str) -> dict[str, list[str]]:
    """frames의 각 slug 구간을 다운로드해 후보 프레임 추출. 실패는 조용히 스킵(베스트에포트)."""
    out = run / "frames"
    out.mkdir(parents=True, exist_ok=True)
    captured: dict[str, list[str]] = {}
    for fr in frames:
        slug = fr["slug"]
        start = max(0, mmss_to_sec(fr.get("timecode", "0:00")) - WINDOW_BEFORE)
        sect = f"{hhmmss(start)}-{hhmmss(start + WINDOW_LEN)}"
        clip = out / f"{slug}.mp4"
        ytdlp(["--quiet", "--ffmpeg-location", ffbin, "-f", "18/best[height<=480]/best",
               "--download-sections", f"*{sect}", "--force-keyframes-at-cuts",
               "-o", str(clip), f"https://www.youtube.com/watch?v={vid}"])
        time.sleep(1.0)
        if not clip.exists():
            continue
        got = []
        for t in FRAME_OFFSETS:
            dst = out / f"{slug}_{t:02d}.jpg"
            subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-ss", str(t),
                            "-i", str(clip), "-vframes", "1", "-q:v", "2", str(dst)], check=False)
            if dst.exists():
                got.append(str(dst))
        if got:
            captured[slug] = got
    return captured


def montage(slug: str, jpgs: list[str], run: Path, ff: str) -> str | None:
    mdir = run / "montages"
    mdir.mkdir(parents=True, exist_ok=True)
    dst = mdir / f"{slug}.jpg"
    cmd = [ff, "-hide_banner", "-loglevel", "error"]
    for p in jpgs:
        cmd += ["-i", p]
    filt = [f"[{i}:v]scale=420:-2[v{i}]" for i in range(len(jpgs))]
    filt.append("".join(f"[v{i}]" for i in range(len(jpgs))) + f"hstack=inputs={len(jpgs)}[o]")
    cmd += ["-filter_complex", ";".join(filt), "-map", "[o]", str(dst)]
    r = subprocess.run(cmd, check=False, capture_output=True)
    return str(dst) if r.returncode == 0 else None


def select_frames(client: Anthropic, model: str, captured: dict, meta_by_slug: dict, run: Path, ff: str) -> dict[str, int]:
    """몽타주를 vision으로 판독해 slug→best offset(초). 드롭은 미포함."""
    content: list = []
    order: list[tuple[str, list[str]]] = []
    for slug, jpgs in captured.items():
        m = montage(slug, jpgs, run, ff)
        if not m:
            continue
        order.append((slug, jpgs))
        cap = meta_by_slug.get(slug, {}).get("caption", "")
        content.append({"type": "text", "text": f"[{slug}] 기대 장면: {cap}. 아래 몽타주는 왼쪽부터 후보 {len(jpgs)}장:"})
        content.append({"type": "image", "source": {
            "type": "base64", "media_type": "image/jpeg",
            "data": base64.b64encode(Path(m).read_bytes()).decode(),
        }})
    if not order:
        return {}
    content.append({"type": "text", "text": (
        "각 slug에 대해, 캡션이 말하는 **차트·그래프·표·도해 또는 핵심 장면이 선명하게 보이는** 프레임을 "
        "왼쪽부터 0-based 인덱스로 고르세요(best). 6장 모두 말하는 사람만(토킹헤드)·전환컷·무의미하면 keep=false. "
        "차트라고 캡션에 썼는데 실제로 차트가 안 보이면 keep=false. picks 도구로 반환."
    )})
    r = client.messages.create(
        model=model, max_tokens=1500, tools=[SELECT_TOOL],
        tool_choice={"type": "tool", "name": "picks"},
        messages=[{"role": "user", "content": content}],
    )
    picks = {}
    for b in r.content:
        if b.type == "tool_use":
            for p in b.input.get("picks", []):
                if p.get("keep") and p["slug"] in captured:
                    idx = max(0, min(int(p.get("best", 0)), len(FRAME_OFFSETS) - 1))
                    picks[p["slug"]] = FRAME_OFFSETS[idx]
    return picks


def assemble(body: str, frames: list[dict], selected: dict[str, int], run: Path, ff: str, pub_base: str) -> tuple[str, list[str]]:
    """png 변환 + [[FRAME:slug]] 토큰 치환(드롭 토큰 제거). (최종본문, png경로들) 반환."""
    png = run / "png"
    png.mkdir(parents=True, exist_ok=True)
    meta = {f["slug"]: f for f in frames}
    png_ok, png_paths = set(), []
    for slug, off in selected.items():
        src = run / "frames" / f"{slug}_{off:02d}.jpg"
        dst = png / f"{slug}.png"
        if src.exists():
            r = subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), str(dst)],
                               check=False, capture_output=True)
            if r.returncode == 0 and dst.exists():
                png_ok.add(slug)
                png_paths.append(str(dst))

    sentinel = "\x01DROP\x01"

    def repl(m: re.Match) -> str:
        slug = m.group(1)
        if slug in png_ok and slug in meta:
            fr = meta[slug]
            return f"![{fr['alt']}]({pub_base}/{slug}.png)\n*{fr['caption'].strip().strip('*')}*"
        return sentinel

    body = re.sub(r"^[ \t]*\[\[FRAME:([a-z0-9_]+)\]\][ \t]*$", repl, body, flags=re.M)
    body = re.sub(rf"[ \t]*{re.escape(sentinel)}[ \t]*", "", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip() + "\n"
    return body, png_paths


def upload_pngs(png_paths: list[str], folder: str) -> None:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    for p in png_paths:
        name = Path(p).name
        requests.post(
            f"{base}/storage/v1/object/reports/{folder}/{name}",
            data=Path(p).read_bytes(),
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Content-Type": "image/png", "x-upsert": "true"},
            timeout=60,
        )


def revalidate(post_id: int) -> None:
    url = os.environ.get("NEXT_REVALIDATE_PROD_URL") or os.environ.get("NEXT_REVALIDATE_URL")
    secret = os.environ.get("NEXT_REVALIDATE_SECRET")
    if not url or not secret:
        return
    try:
        requests.post(url, headers={"x-revalidate-secret": secret},
                      json={"tags": ["posts", f"post:{post_id}"]}, timeout=20)
    except Exception:  # noqa: BLE001
        pass


def write_post(fields: dict, post_id: int | None) -> int:
    """postgrest로 posts UPDATE(post_id) 또는 INSERT. id 반환."""
    from db import get_client

    client = get_client()
    if post_id:
        client.from_("posts").update(fields).eq("id", str(post_id)).execute()
        return post_id
    res = client.from_("posts").insert({**fields, "source_type": "report"}).execute()
    return res.data[0]["id"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--post-id", type=int, default=None)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument(
        "--enrich",
        action="store_true",
        help="보강 모드: 이미 완성된 글에 이미지만 덧입힌다. 실패(봇차단 등)해도 failed로 "
        "만들지 않고 기존 글 유지, 이미지를 실제로 만들었을 때만 덮어쓴다.",
    )
    args = ap.parse_args()

    vid = video_id(args.url)
    folder = f"yt-auto/{args.post_id or vid}"
    run = Path(tempfile.mkdtemp(prefix=f"ytr_{vid}_"))
    log(f"[start] vid={vid} run={run} folder={folder}")
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    pub_base = os.environ["SUPABASE_URL"].rstrip("/") + f"/storage/v1/object/public/reports/{folder}"

    try:
        meta = oembed(args.url)
        pub = ytdlp(["--skip-download", "--print", "%(upload_date)s", args.url]).stdout.strip()[:8]
        published_at = f"{pub[:4]}-{pub[4:6]}-{pub[6:8]}" if len(pub) == 8 and pub.isdigit() else None

        transcript = fetch_transcript(args.url, run)
        if len(transcript) < 80:
            msg = "자막을 가져오지 못했습니다(유튜브 봇 차단 가능)."
            if args.enrich:
                log(f"[skip] {msg} 기존 글 유지(덮어쓰지 않음).")
                return 0
            raise RuntimeError(msg + " 수동 툴킷으로 시도하세요.")
        log(f"[transcript] {len(transcript):,}자")

        art = write_article(client, args.model, meta, transcript)
        frames = art.get("frames", [])
        log(f"[article] {len(art['body_markdown']):,}자, 프레임계획 {len(frames)}개")

        ffbin, ff = None, None
        selected: dict[str, int] = {}
        png_paths: list[str] = []
        body = art["body_markdown"]
        try:
            ff, ffbin = find_ffmpeg()
            captured = capture_frames(vid, frames, run, ffbin, ff) if frames else {}
            log(f"[capture] {len(captured)}/{len(frames)} slug 캡처")
            if captured:
                meta_by_slug = {f["slug"]: f for f in frames}
                selected = select_frames(client, args.model, captured, meta_by_slug, run, ff)
                log(f"[select] {len(selected)}개 채택")
            body, png_paths = assemble(body, frames, selected, run, ff, pub_base)
        except Exception as e:  # noqa: BLE001
            # 캡처/선별 실패 → 텍스트만으로 진행(베스트에포트)
            log(f"[capture] 실패 → 텍스트만: {e}")
            body = re.sub(r"^[ \t]*\[\[FRAME:[a-z0-9_]+\]\][ \t]*$\n?", "", body, flags=re.M)

        # 보강 모드에서 이미지를 하나도 못 만들었으면 기존(텍스트) 글을 건드리지 않는다.
        if args.enrich and not png_paths:
            log("[skip] 이미지 0 → 기존 글 유지(덮어쓰지 않음).")
            return 0

        if png_paths:
            upload_pngs(png_paths, folder)
            log(f"[upload] png {len(png_paths)}장")

        thumb = None
        if selected:
            first = next(iter(selected))
            thumb = f"{pub_base}/{first}.png"
        else:
            thumb = meta.get("thumbnail_url") or f"https://img.youtube.com/vi/{vid}/hqdefault.jpg"

        fields = {
            "title": art["title"], "content": body, "category": art.get("category"),
            "source_name": meta.get("author_name"), "source_url": args.url,
            "source_published_at": published_at, "thumbnail_url": thumb,
            "status": "completed", "error_message": None,
        }
        pid = write_post(fields, args.post_id)
        revalidate(pid)
        log(f"[done] post id={pid} images={len(png_paths)}")
        return 0
    except Exception as e:  # noqa: BLE001
        log(f"[FAIL] {e}")
        # 보강 모드: 실패해도 기존 글을 failed로 downgrade하지 않는다(텍스트 글 유지). GHA도 성공 처리.
        if args.enrich:
            log("[skip] 보강 실패 → 기존 글 유지.")
            return 0
        if args.post_id:
            try:
                write_post({"status": "failed", "error_message": str(e)[:500]}, args.post_id)
                revalidate(args.post_id)
            except Exception:  # noqa: BLE001
                pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
