# Demo video build record

Published video: <https://youtu.be/0uxTKx0Jf0Q>

Published length: 4 minutes 48 seconds

Local master SHA-256: `87bf652b3feb3a7d26283fd280bfcc82a71c499e57b61a037f5d7c959ee28561`

## Source of truth

- [`DEMO_TRANSCRIPT.md`](./DEMO_TRANSCRIPT.md) contains the exact narration.
- [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) contains the judge-facing timeline and shot list.
- `work/demo-video/slideshow.txt` contains the local image sequence and durations.
- `work/demo-video/proofswitch-demo-v3.mp4` is the uploaded 1920×1080 master.

The `work/` directory is intentionally excluded from Git because it contains large generated media. No credential or sponsor data is required to rebuild the video. The current public narration uses a local macOS speech voice; no third-party voice credential is stored in the repository.

## Rebuild

From the repository root, with FFmpeg installed:

```bash
ffmpeg -y \
  -f concat -safe 0 -i work/demo-video/slideshow.txt \
  -i work/demo-video/narration.aiff \
  -filter_complex "[0:v]fps=30,format=yuv420p[v];[1:a]loudnorm=I=-16:LRA=11:TP=-1.5[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -preset medium -crf 18 \
  -c:a aac -b:a 192k -ar 44100 -ac 1 \
  -shortest -movflags +faststart \
  work/demo-video/proofswitch-demo-v3.mp4
```

## Verified output

- Video: H.264, 1920×1080, 30 fps.
- Audio: AAC, mono, 44.1 kHz, normalised towards −16 LUFS.
- Container duration: 287.700 seconds.
- YouTube copyright check: complete, no issues found.
- Visibility: unlisted, accessible to anyone with the link.
- Custom thumbnail: unavailable until the channel completes YouTube phone verification.

The endpoint frame was recaptured from the current judge pack so it describes `/auth/guest/start` as anonymous guest-session creation and keeps the synthetic Demo Lab separate from the live reducer path.
