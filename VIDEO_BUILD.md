# Demo video build record

Published video: <https://youtu.be/5bsx35tDo-g>

Published length: 4 minutes 48 seconds

Local master SHA-256: `c4300ccea39cf67f7bd3a20f7ddbd3a3b432170f9a19dfa37e2dad32a380ced6`

## Source of truth

- [`DEMO_TRANSCRIPT.md`](./DEMO_TRANSCRIPT.md) contains the exact narration.
- [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) contains the judge-facing timeline and shot list.
- `work/demo-video/proofswitch-screen-v4.mp4` is the uploaded 1280×720 continuous screen-capture master.

The `work/` directory is intentionally excluded from Git because it contains large generated media. No credential or sponsor data is required to rebuild the video. The current public narration uses a local macOS speech voice; no third-party voice credential is stored in the repository.

## Version 4 capture

Version 4 replaces the earlier slideshow-style render with a continuous screen capture of the working application. It retains the exact published narration and keeps the public run clearly described as a synthetic, paper-only rehearsal. It does not claim a credential-backed TxLINE session or successful Solana verification.

The v4 master is the source artefact for the published upload. The exact capture and assembly command was not recorded in the repository, so the verified SHA-256 above, rather than an inferred rebuild command, identifies the uploaded local master.

## Verified output

- Video: H.264, 1280×720, 30 fps.
- Audio: AAC, mono, 44.1 kHz, normalised towards −16 LUFS.
- Container duration: 287.700 seconds.
- YouTube copyright check: complete, no issues found.
- Visibility: unlisted, accessible to anyone with the link.
- Custom thumbnail: unavailable until the channel completes YouTube phone verification.

The endpoint frame was recaptured from the current judge pack so it describes `/auth/guest/start` as anonymous guest-session creation and keeps the synthetic Demo Lab separate from the live reducer path.
