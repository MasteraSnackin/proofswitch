# Demo video build record

Published video: <https://youtu.be/M9kMuOt1kwc>

Published length: 4 minutes 48 seconds

Published master SHA-256: `5a772e572253df67c60e6eae87fac426011edadbb36d70abc86ea3e1ffab2100`

## Source of truth

- [`DEMO_TRANSCRIPT_ELEVENLABS.md`](./DEMO_TRANSCRIPT_ELEVENLABS.md) contains the exact narration.
- [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) contains the judge-facing timeline and shot list.
- `work/demo-video/proofswitch-screen-elevenlabs.mp4` is the uploaded 1280×720 continuous screen-capture master.

The `work/` directory is intentionally excluded from Git because it contains large generated media. No credential or sponsor data is required to rebuild the screen recording. The published narration uses ElevenLabs; its API credential is not stored in the repository.

## Version 4 capture

Version 4 replaced the earlier slideshow-style render with a continuous screen capture of the working application. That screen recording remains the visual source for the published ElevenLabs master and keeps the public run clearly described as a synthetic, paper-only rehearsal. It does not claim a credential-backed TxLINE session or successful Solana verification.

The exact version-four capture command was not recorded in the repository. The ElevenLabs assembly pipeline is recorded, and the verified SHA-256 above identifies the uploaded final master.

## Verified output

- Video: H.264, 1280×720, 30 fps.
- Audio: AAC, mono, 44.1 kHz, −16.7 LUFS integrated and −2.0 dBTP true peak.
- Container duration: 287.650 seconds.
- YouTube copyright check: complete, no issues found.
- Published: 19 July 2026.
- Visibility: unlisted, accessible to anyone with the link.

The endpoint frame was recaptured from the current judge pack so it describes `/auth/guest/start` as anonymous guest-session creation and keeps the synthetic Demo Lab separate from the live reducer path.

## Published ElevenLabs master

The repository includes a local-only pipeline that preserves the verified version-four screen recording, generates narration through ElevenLabs and fits the audio to the existing 287.650-second timeline. It normalises the voice master towards −16 LUFS and leaves additional true-peak headroom before AAC encoding, copies the H.264 video without re-encoding and creates an AAC mono output. It then measures the encoded result and rejects a video at or above five minutes, outside −17 to −15 LUFS, or above −1.5 dBTP.

The resulting ElevenLabs master was reviewed and published under the current public URL above. YouTube does not replace media in place, so the previous upload remains a superseded artefact rather than the current submission video.

1. Put `ELEVENLABS_API_KEY` in the ignored `.env.local`; never paste or commit it.
2. Run `npm run demo:voices`, audition an API-accessible British narration voice and put its ID in `ELEVENLABS_VOICE_ID`.
3. Run `npm run demo:elevenlabs:check` to verify the local inputs and timing without using credits.
4. Run `npm run demo:elevenlabs` to generate `work/demo-video/proofswitch-screen-elevenlabs.mp4`.
5. Review the complete video for pronunciation, timing and claim accuracy before uploading it. A YouTube video cannot be replaced in place, so update every submission link only after the new upload is publicly accessible.

For a full pipeline test that makes no ElevenLabs request, supply an existing local audio file:

```bash
node --env-file-if-exists=.env.local scripts/elevenlabs-demo.mjs \
  --audio work/demo-video/narration.aiff \
  --output work/demo-video/proofswitch-screen-pipeline-test.mp4
```

### Published output

The published ElevenLabs master was generated successfully on 19 July 2026.

- Exact narration: [`DEMO_TRANSCRIPT_ELEVENLABS.md`](./DEMO_TRANSCRIPT_ELEVENLABS.md)
- Voice: George — premade British warm narrative voice (`JBFqnCBsd6RMkjVDRZzb`)
- Model: `eleven_multilingual_v2`
- Source synthesis: 263.967 seconds, 4,132 characters and 592 words
- Fitted master and final video: 287.650 seconds
- Delivered pace: approximately 123.5 words per minute
- Encoded audio: −16.7 LUFS integrated, −2.0 dBTP true peak
- Video: H.264, 1280×720, 30 fps; AAC mono, 44.1 kHz
- Published master SHA-256: `5a772e572253df67c60e6eae87fac426011edadbb36d70abc86ea3e1ffab2100`
- Published local master: `work/demo-video/proofswitch-screen-elevenlabs.mp4`

No silence of 1.5 seconds or longer was detected at −45 dB in the published master. The complete file decoded without media errors before upload.
