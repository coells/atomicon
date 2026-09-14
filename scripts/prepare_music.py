# /// script
# requires-python = ">=3.11"
# dependencies = ["imageio-ffmpeg==0.6.0"]
# ///
"""Run with uv run scripts/prepare_music.py to regenerate mobile AAC copies.

The supplied .m4a originals contain Opus. Preserve them under art/music/source;
encode AAC for Safari compatibility and remove leading near-silence only.
Playback crossfades live, so there is no hard edit between the two recordings.
"""

import subprocess
from pathlib import Path

from imageio_ffmpeg import get_ffmpeg_exe

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    output = ROOT / "public/music"
    output.mkdir(parents=True, exist_ok=True)
    for name in ("track1", "track2"):
        source = ROOT / "art/music/source" / f"{name}.m4a"
        if not source.is_file():
            raise FileNotFoundError(source)
        destination = output / f"{name}.m4a"
        subprocess.run(
            [
                get_ffmpeg_exe(),
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source),
                "-map",
                "0:a:0",
                "-map_metadata",
                "-1",
                "-af",
                "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-55dB",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-ar",
                "48000",
                "-movflags",
                "+faststart",
                str(destination),
            ],
            check=True,
            timeout=180,
        )
        print(f"{name}: {destination.stat().st_size // 1024} KiB AAC")


if __name__ == "__main__":
    main()
