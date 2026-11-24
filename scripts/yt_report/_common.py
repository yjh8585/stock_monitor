"""yt_report 툴킷 공용 모듈 — 경로·ffmpeg 탐지·자막정제·env.

파이프라인 전체 절차는 README.md 참고. 이 모듈은 스크립트들이 재사용하는 순수 헬퍼.

🔴 두 레포(agents·stock_monitor) 공통 파일 — **바이트 단위로 같게** 유지한다(2026-11-24 정본화 D2).
   고칠 때는 두 레포에 같은 바이트로 쓴다. 레포마다 다른 값·함수는 같은 폴더의 `_repo.py`
   (레포별 한 파일)에 두고, 여기서 `from _repo import *` 로 다시 내보낸다 — 그래서 소비처의
   `from _common import REPORT_VAULT`(agents)·`from _common import load_env`(stock_monitor) 가 그대로 돈다.
   공통 코드가 쓰는 레포 고유 이름은 `find_existing`·`EXISTING_LABEL`·`YTDLP_PYTHON_CANDIDATES` 셋이다.
"""
from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from _repo import *  # noqa: F401,F403 — 레포 고유 이름 재수출(각 `_repo.py` 의 `__all__`)
from _repo import EXISTING_LABEL, YTDLP_PYTHON_CANDIDATES, find_existing  # noqa: F401 — 공통 코드가 쓰는 셋

# 🔴 창 숨김 플래그의 **정본**. 형제 모듈은 `from _common import NO_WINDOW` 로 가져다 쓴다.
#    Windows 는 콘솔 프로그램마다 검은 창을 새로 만든다 — ffmpeg·yt-dlp 를 반복 호출하는
#    이 파이프라인은 한 번 실행에 창이 수십 개 뜬다(2026-09-16 사용자 지적).
#    `getattr` 로 감싸는 이유는 이 상수가 Windows 에만 있어서다(다른 OS 에서는 0 = 무효과).
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# 프로젝트 루트 = scripts/yt_report 의 두 단계 위
ROOT = Path(__file__).resolve().parents[2]

# 일회성 산출물(자막·프레임·png·중간 json)을 두는 작업 디렉터리.
# gitignore 되는 scripts/_yt_report 를 기본값으로(원하면 YT_RUN_DIR로 변경).
RUN_DIR = Path(os.environ.get("YT_RUN_DIR", ROOT / "scripts" / "_yt_report"))

# 🔴 본문 그림 토큰의 **정본**(2026-09-22 통합). 쓰는 쪽(조립 finalize)과 보는 쪽(검사기)이
#    각자 적어 두고 있었다. 둘이 갈리면 검사기가 **조용히 0건**을 내고 통과한다 —
#    안 맞는 토큰을 세도 화면에는 「깨끗」으로 보인다.
FRAME_TOKEN = re.compile(r"^[ \t]*\[\[FRAME:([a-z0-9_]+)\]\][ \t]*$", re.M)


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


_MARK = re.compile(r"\s*(\[\d{2,3}:\d{2}\])")


def split_by_marker(body: str) -> str:
    """한 줄 자막 본문을 [MM:SS] 표지마다 줄을 나눈다 → text/<key>.lines.txt.

    clean_vtt 본문은 줄바꿈이 없는 한 줄이라 조수가 Read(offset/limit)로 나눠 읽거나
    Grep 으로 타임코드 앞뒤만 볼 수 없었다(2026-11-18 회차 — 손으로 만들어 넘겼다).
    """
    return _MARK.sub(r"\n\1", body).lstrip("\n") + "\n"


# ---- 타임코드 헬퍼 ----
def mmss_to_sec(s: str) -> int:
    p = [int(x) for x in s.strip().split(":")]
    return p[0] * 3600 + p[1] * 60 + p[2] if len(p) == 3 else p[0] * 60 + p[1]


def hhmmss(sec: int) -> str:
    return f"{sec // 3600:02d}:{(sec % 3600) // 60:02d}:{sec % 60:02d}"


# ---- yt-dlp 를 가진 파이썬 탐지 (PATH → YT_DLP_PYTHON → 알려진 venv) ----
#
# 🔴 시스템 파이썬(3.14)에는 yt-dlp 가 없고 numpy·PIL 만 있다(2026-09-11 실측).
#    ffmpeg 탐지와 같은 방식으로 «가진 인터프리터»를 찾는다 — 그래야 나중에
#    이 레포에 직접 설치했을 때 자동으로 자기 것을 쓴다. 후보 venv 목록은 레포마다 달라
#    `_repo.YTDLP_PYTHON_CANDIDATES` 에 둔다.


def _has_ytdlp(exe: str) -> bool:
    try:
        # 🔴 후보 인터프리터마다 불린다 — 창 숨김을 빼면 탐지만으로 창이 여러 개 뜬다.
        r = subprocess.run(
            [exe, "-c", "import yt_dlp"], capture_output=True, timeout=30, check=False,
            creationflags=NO_WINDOW,
        )
        return r.returncode == 0
    except Exception:
        return False


def find_ytdlp_python() -> str:
    """yt-dlp 를 import 할 수 있는 파이썬 실행파일 경로. 못 찾으면 RuntimeError."""
    if _has_ytdlp(sys.executable):
        return sys.executable
    env = os.environ.get("YT_DLP_PYTHON")
    if env and Path(env).exists() and _has_ytdlp(env):
        return env
    for cand in YTDLP_PYTHON_CANDIDATES:
        if Path(cand).exists() and _has_ytdlp(cand):
            return cand
    raise RuntimeError(
        "yt-dlp 를 가진 파이썬을 찾지 못했습니다. "
        "`pip install yt-dlp` 하거나 YT_DLP_PYTHON 환경변수로 지정하세요."
    )


# ---- yt-dlp 실행 명령 — 인증서 경로 우회 (stock_monitor 2026-11-17 실측 · 2026-11-18 두 레포 공통) ----
#
# 🔴 후보 venv 는 한글 경로(`1.테스트`) 아래라 certifi 인증서 파일 경로가 한글이 되고,
#    yt-dlp 의 curl 이 그 경로를 못 열어 `(77)` 로 실패한다 — 자막이 전부 NO_KO_SUB 로 «조용히» 빠졌다.
#    인증서를 임시 폴더(ASCII 경로)로 복사해 certifi 가 그쪽을 가리키게 한 뒤 yt-dlp 를 띄운다.
_YTDLP_SHIM = (
    "import os,shutil,sys,tempfile,certifi;"
    "d=os.path.join(tempfile.gettempdir(),'yt_report_cacert.pem');"
    "shutil.copyfile(certifi.where(),d);certifi.where=lambda:d;"
    "import yt_dlp;sys.exit(yt_dlp.main())"
)


def ytdlp_cmd() -> list[str]:
    """`[python, -c, shim]` — 뒤에 yt-dlp 인자를 그대로 붙여 쓴다(`python -m yt_dlp` 대신)."""
    return [find_ytdlp_python(), "-c", _YTDLP_SHIM]


# ---- 중복 영상 가드 ----
# 「무엇을 이미 만들었나」의 저장소가 레포마다 다르다(agents = 볼트 `_보고서` 노트 · stock_monitor =
# Supabase `posts`). 그래서 판정은 `_repo.find_existing(videos) -> {key: 표시 문자열}` 이 하고,
# 착수 첫 단계(fetch_subs)가 `EXISTING_LABEL` 과 함께 찍고 멈춘다(2026-10-27 리포트 132 덮어쓰기 사고).
