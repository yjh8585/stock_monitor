"""finalize.py 의 파일 약속 시험(2026-11-24 정본화 D5·D6 + 최종 검토) — 임시 폴더만 쓴다(네트워크·Supabase 없음).

고정하는 것(정상 회차 — 종료 0):
  ① 크롭본 png/<slug>_<오프셋>.png 가 원본보다 새것이면 게시용 그림(png_final/<slug>.png)이 크롭본이다
  ② 크롭본이 없으면 원본 프레임이다 · 11-24 전 옛 크롭본 png/<slug>.png 가 원본보다 새것이면 그것을 쓴다(알림)
  ③ exact_times.json(capture.py --exact)의 초가 frame_times.json 으로 옮겨지고, 좁은·넓은 창은 각자 값으로 역산된다
  ④ 본문 주소는 pub_base/<slug>.png 이고(batch public_url 이 달라도), png_final/ 에는 본문에 실린 것만 남는다(옛 파일 정리)
  ⑤ frame_times.json 은 이번에 게시하는 slug 로만 다시 만든다(본문에서 뺀 slug 의 옛 기록 제거)
실패해야 하는 회차(종료 1) — 한 결함씩:
  옛 크롭(원본보다 오래됨) · 정각 기록 누락(exact_times.json 은 있음) · 옛 값에 seconds 없음 · shots 에 없는 게시 그림 ·
  게시 그림 0장 · NaN·음수 초 · pub_base 가 storage_folder 로 안 끝남
살아야 하는 회차(종료 0): 깨진 크롭본 → 원본으로 재시도 · exact_times.json 없는 옛 회차의 frame_times 값 보존

usage: PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/yt_report/finalize.test.py
ffmpeg 가 필요하다(finalize.py 가 jpg→png 변환에 쓴다 · `_common.find_ffmpeg`).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
PUB = "https://example.test/storage/v1/object/public/reports/yt-test"
VID = "AAAAAAAAAAA"
FRAME_W, CROP_W, H = 100, 72, 40
OLD, MID, NEW = 1_000_000, 2_000_000, 3_000_000  # 파일 수정 시각(os.utime) — sleep 없이 앞뒤를 고정한다


def jdump(p: Path, data) -> None:
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def img(p: Path, w: int, mtime: int) -> None:
    Image.new("RGB", (w, H), "white").save(p)
    os.utime(p, (mtime, mtime))


def make_run(run: Path, slugs: dict[str, int], *, timecodes: dict[str, str] | None = None,
             exact: dict | None = None, frame_times: dict | None = None,
             body_extra: tuple[str, ...] = ()) -> None:
    """slugs = {slug: 오프셋}. 원본 프레임은 MID 시각. exact=None 이면 exact_times.json 을 안 만든다."""
    for d in ("frames", "png", "reports"):
        (run / d).mkdir()
    for slug, off in slugs.items():
        img(run / "frames" / f"{slug}_{off:02d}.jpg", FRAME_W, MID)
    jdump(run / "selected.json", slugs)
    tcs = timecodes or {}
    jdump(run / "shots.json", [{"slug": s, "id": VID, "timecode": tcs.get(s, "01:00")} for s in slugs])
    if exact is not None:
        jdump(run / "exact_times.json", exact)
    if frame_times is not None:
        jdump(run / "frame_times.json", frame_times)
    names = [*slugs, *body_extra]
    frames = [{"slug": s, "alt": s, "caption": f"{s} (출처: 테스트)", "public_url": f"{PUB}/{s}.png"} for s in names]
    jdump(run / "batch.json", {"storage_folder": "yt-test", "pub_base": PUB,
                               "reports": [{"key": "v1", "thumb_slug": names[0], "frames": frames}]})
    body = "\n\n".join(["머리말", *(f"[[FRAME:{s}]]" for s in names), "끝"])
    (run / "reports" / "v1.md").write_text(body + "\n", encoding="utf-8")


def run_finalize(run: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "YT_RUN_DIR": str(run), "PYTHONIOENCODING": "utf-8"}
    return subprocess.run([sys.executable, str(HERE / "finalize.py")], env=env, capture_output=True,
                          text=True, encoding="utf-8", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def width(run: Path, slug: str) -> int:
    with Image.open(run / "png_final" / f"{slug}.png") as im:
        return im.width


def times_of(run: Path) -> dict:
    return json.loads((run / "frame_times.json").read_text(encoding="utf-8"))


class FinalizeContract(unittest.TestCase):
    """정상 회차 하나 — 종료 0 이어야 한다."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        run = cls.run_dir = Path(cls._tmp.name)
        slugs = {"v1_crop": 0, "v1_plain": 0, "v1_legacy": 4, "v1_narrow": 12, "v1_wide": 14}
        make_run(run, slugs, timecodes={"v1_crop": "02:00", "v1_plain": "03:00"},
                 # 정각 기록 초를 timecode 와 일부러 다르게 둔다 — timecode 로 계산하면 걸린다
                 exact={"v1_crop": {"video_id": VID, "seconds": 123}, "v1_plain": {"video_id": VID, "seconds": 181}},
                 # 옛 기록: v1_crop 의 낡은 초 · 본문에서 빠진 v1_gone
                 frame_times={"v1_crop": {"video_id": VID, "seconds": 999}, "v1_gone": {"video_id": VID, "seconds": 5}},
                 body_extra=("v1_dropped",))
        img(run / "png" / "v1_crop_00.png", CROP_W, NEW)   # 새 크롭
        img(run / "png" / "v1_legacy.png", CROP_W, NEW)    # 11-24 전 옛 방식 크롭(원본보다 새것)
        # batch 의 손 기입 주소가 pub_base 와 다른 그림 — 본문은 pub_base 로 써야 한다
        b = json.loads((run / "batch.json").read_text(encoding="utf-8"))
        for fr in b["reports"][0]["frames"]:
            if fr["slug"] == "v1_plain":
                fr["public_url"] = "https://example.test/storage/v1/object/public/reports/yt-old/v1_plain.png"
        jdump(run / "batch.json", b)
        (run / "png_final").mkdir()
        img(run / "png_final" / "v1_gone.png", FRAME_W, OLD)  # 지난 조립의 고아
        cls.proc = run_finalize(run)
        cls.out = cls.proc.stdout + cls.proc.stderr
        cls.body = (run / "reports_final" / "v1.md").read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def test_0_exit_ok(self) -> None:
        self.assertEqual(self.proc.returncode, 0, self.out)

    def test_1_fresh_crop_is_used(self) -> None:
        self.assertEqual(width(self.run_dir, "v1_crop"), CROP_W)

    def test_2_no_crop_uses_frame_and_legacy_crop_is_used(self) -> None:
        self.assertEqual(width(self.run_dir, "v1_plain"), FRAME_W)
        self.assertEqual(width(self.run_dir, "v1_legacy"), CROP_W)
        self.assertIn("옛 방식 크롭본 png/v1_legacy.png", self.out)

    def test_3_exact_times_moved_to_frame_times(self) -> None:
        times = times_of(self.run_dir)
        self.assertEqual(times["v1_crop"], {"video_id": VID, "seconds": 123})  # 옛 999 가 아니다
        self.assertEqual(times["v1_plain"]["seconds"], 181)
        self.assertEqual(times["v1_narrow"]["seconds"], 60 - 6 + 12)  # 좁은 창 역산(before 6)
        self.assertEqual(times["v1_wide"]["seconds"], 60 - 12 + 14)  # 넓은 창 역산(before 12)

    def test_4_body_urls_and_upload_set(self) -> None:
        for s in ("v1_crop", "v1_plain", "v1_legacy", "v1_narrow", "v1_wide"):
            self.assertIn(f"]({PUB}/{s}.png)", self.body)
        self.assertNotIn("yt-old", self.body)
        self.assertIn("⚠️ URL v1_plain", self.out)
        self.assertNotIn("v1_dropped", self.body)
        self.assertNotIn("[[FRAME:", self.body)
        got = sorted(p.name for p in (self.run_dir / "png_final").glob("*.png"))
        self.assertEqual(got, ["v1_crop.png", "v1_legacy.png", "v1_narrow.png", "v1_plain.png", "v1_wide.png"])

    def test_5_frame_times_only_published(self) -> None:
        self.assertEqual(sorted(times_of(self.run_dir)),
                         ["v1_crop", "v1_legacy", "v1_narrow", "v1_plain", "v1_wide"])


class FinalizeCases(unittest.TestCase):
    """한 결함씩 심은 작은 회차 — 각 시험이 임시 폴더 하나."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.run_dir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def finalize(self, code: int) -> str:
        p = run_finalize(self.run_dir)
        out = p.stdout + p.stderr
        self.assertEqual(p.returncode, code, out)
        return out

    def test_f4_stale_crop_fails(self) -> None:
        make_run(self.run_dir, {"v1_a": 12})
        img(self.run_dir / "png" / "v1_a_12.png", CROP_W, OLD)  # 원본(MID)보다 오래된 크롭
        out = self.finalize(1)
        self.assertEqual(width(self.run_dir, "v1_a"), FRAME_W)
        self.assertIn("crop.py", out)

    def test_f5_exact_file_without_record_is_missing(self) -> None:
        make_run(self.run_dir, {"v1_a": 0, "v1_b": 12}, exact={"v1_b": {"video_id": VID, "seconds": 1}},
                 frame_times={"v1_a": {"video_id": VID, "seconds": 66}})
        self.finalize(1)
        self.assertNotIn("v1_a", times_of(self.run_dir))  # 옛 66 을 살리지 않는다

    def test_f5_legacy_run_keeps_old_value(self) -> None:
        make_run(self.run_dir, {"v1_a": 0}, frame_times={"v1_a": {"video_id": VID, "seconds": 66}})
        self.finalize(0)
        self.assertEqual(times_of(self.run_dir)["v1_a"], {"video_id": VID, "seconds": 66})

    def test_f5_legacy_value_without_seconds_is_missing(self) -> None:
        make_run(self.run_dir, {"v1_a": 0}, frame_times={"v1_a": {"video_id": VID}})
        self.finalize(1)

    def test_f6_published_slug_not_in_shots_is_missing(self) -> None:
        make_run(self.run_dir, {"v1_a": 12, "v1_b": 12})
        jdump(self.run_dir / "shots.json", [{"slug": "v1_a", "id": VID, "timecode": "01:00"}])
        out = self.finalize(1)
        self.assertIn("v1_b", out)
        self.assertEqual(sorted(times_of(self.run_dir)), ["v1_a"])

    def test_f7_broken_crop_retries_frame(self) -> None:
        make_run(self.run_dir, {"v1_a": 12})
        bad = self.run_dir / "png" / "v1_a_12.png"
        bad.write_bytes(b"not a png")
        os.utime(bad, (NEW, NEW))
        out = self.finalize(0)
        self.assertEqual(width(self.run_dir, "v1_a"), FRAME_W)
        self.assertIn("원본 프레임으로 다시", out)

    def test_f7_zero_images_fails(self) -> None:
        make_run(self.run_dir, {"v1_a": 12})
        (self.run_dir / "frames" / "v1_a_12.jpg").unlink()
        self.finalize(1)

    def test_f8_nan_and_negative_seconds_are_missing(self) -> None:
        make_run(self.run_dir, {"v1_a": 0, "v1_b": 0})
        # json.dumps 는 NaN 을 그대로 쓰고 json.loads 는 실수로 읽는다 — 실제로 들어올 수 있는 입력
        (self.run_dir / "exact_times.json").write_text(
            json.dumps({"v1_a": {"video_id": VID, "seconds": float("nan")},
                        "v1_b": {"video_id": VID, "seconds": -3}}), encoding="utf-8")
        out = self.finalize(1)
        self.assertEqual(times_of(self.run_dir), {})
        self.assertIn("시각 누락 2장", out)

    def test_f10_pub_base_must_end_with_storage_folder(self) -> None:
        make_run(self.run_dir, {"v1_a": 12})
        b = json.loads((self.run_dir / "batch.json").read_text(encoding="utf-8"))
        b["storage_folder"] = "yt-new"  # pub_base 는 …/reports/yt-test
        jdump(self.run_dir / "batch.json", b)
        self.finalize(1)
        self.assertFalse((self.run_dir / "png_final").exists())  # 아무것도 만들기 전에 멈춘다


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    unittest.main(verbosity=2)
