"""yt_report 툴킷 공용 모듈 — 경로·ffmpeg 탐지·자막정제·env.

파이프라인 전체 절차는 README.md 참고. 이 모듈은 스크립트들이 재사용하는 순수 헬퍼.
"""
from __future__ import annotations

import glob
import os
import re
import shutil
from pathlib import Path

# 프로젝트 루트 = scripts/yt_report 의 두 단계 위
ROOT = Path(__file__).resolve().parents[2]

# 일회성 산출물(자막·프레임·png·중간 json)을 두는 작업 디렉터리.
# gitignore 되는 scripts/_yt_report 를 기본값으로(원하면 YT_RUN_DIR로 변경).
RUN_DIR = Path(os.environ.get("YT_RUN_DIR", ROOT / "scripts" / "_yt_report"))


def run_path(*parts: str) -> Path:
    p = RUN_DIR.joinpath(*parts)
    return p


def ensure_dir(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


# ---- ffmpeg 탐지 (PATH → FFMPEG_PATH env → winget 설치 경로) ----
def find_ffmpeg() -> tuple[str, str]:
    """(ffmpeg 실행파일 경로, 그 bin 디렉터리)를 반환. 못 찾으면 RuntimeError."""
    cand = shutil.which("ffmpeg")
    if cand:
        return cand, str(Path(cand).parent)
    env = os.environ.get("FFMPEG_PATH")
    if env and Path(env).exists():
        return env, str(Path(env).parent)
    # Windows winget 기본 설치 위치 glob
    home = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    for pat in [
        home / "Microsoft" / "WinGet" / "Packages" / "Gyan.FFmpeg*" / "ffmpeg*" / "bin" / "ffmpeg.exe",
    ]:
        hits = glob.glob(str(pat))
        if hits:
            return hits[0], str(Path(hits[0]).parent)
    raise RuntimeError(
        "ffmpeg를 찾지 못했습니다. PATH에 넣거나 FFMPEG_PATH 환경변수로 지정하세요 "
        "(winget: `winget install Gyan.FFmpeg`)."
    )


# ---- 자막 VTT → 텍스트 ----
_TAG = re.compile(r"<[^>]+>")
_TIMING = re.compile(r"(\d\d):(\d\d):(\d\d)\.\d\d\d --> ")


def _fmt(sec: int) -> str:
    return f"{sec // 60:02d}:{sec % 60:02d}"


def clean_vtt(path: str | Path) -> tuple[str, int, int]:
    """자동생성 VTT → (본문[15초 타임코드 마커], 공백제외 글자수, 대략 길이초)."""
    with open(path, encoding="utf-8") as f:
        raw = f.read().split("\n")
    rows: list[tuple[int, str]] = []
    last, cur = None, 0
    for ln in raw:
        ln = ln.rstrip()
        m = _TIMING.match(ln)
        if m:
            cur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
            continue
        if not ln or ln.startswith(("WEBVTT", "Kind:", "Language:")):
            continue
        txt = _TAG.sub("", ln).strip()
        if not txt or txt == last:
            continue
        last = txt
        rows.append((cur, txt))
    lines, last_mark = [], -999
    for sec, txt in rows:
        if sec - last_mark >= 15:
            lines.append(f"\n[{_fmt(sec)}] {txt}")
            last_mark = sec
        else:
            lines.append(txt)
    body = " ".join(" ".join(lines).split())
    chars = len(body.replace(" ", ""))
    dur = rows[-1][0] if rows else 0
    return body, chars, dur


# ---- 타임코드 헬퍼 ----
def mmss_to_sec(s: str) -> int:
    p = [int(x) for x in s.strip().split(":")]
    return p[0] * 3600 + p[1] * 60 + p[2] if len(p) == 3 else p[0] * 60 + p[1]


def hhmmss(sec: int) -> str:
    return f"{sec // 3600:02d}:{(sec % 3600) // 60:02d}:{sec % 60:02d}"


# ---- Supabase env / 공개 URL ----
def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    envf = ROOT / ".env.local"
    if envf.exists():
        for line in envf.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
            if m:
                out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def storage_pub_base(folder: str, env: dict[str, str] | None = None) -> str:
    env = env or load_env()
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    return f"{url}/storage/v1/object/public/reports/{folder}"
