# SHRED

A browser-first five-lane guitar chart forge with an original, arcade-rock visual identity. This first vertical slice loads and plays a local recording, analyzes its rhythm in a Web Worker, creates four difficulty tracks, and previews them on a highway synchronized to the browser audio clock.

Audio stays in the browser. There is no upload, account, backend, or telemetry.

## Run it

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, choose a browser-decodable audio file, and press Play. Format support ultimately depends on the browser; current browsers commonly decode MP3, WAV, OGG, M4A/AAC, FLAC, and WebM audio.

```bash
npm test        # domain behavior
npm run lint    # TypeScript checks
npm run build   # production build
```

## Preview controls

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `R` | Restart |
| `←` / `→` | Seek five seconds |
| `1`–`4` | Easy / Medium / Hard / Expert |
| `A` `S` `J` `K` `L` | Light the five fret receptors |

The transport also provides seek, volume, and playback-speed controls. Click the waveform to seek.

## Current architecture

- `src/analysis/pipeline.ts` runs the worker, transcribes detected attacks, and passes format-neutral guitar events into generation. Beat confidence aligns real attacks but never fabricates notes.
- `src/analysis/signal.ts` preserves both stereo channels in a mono analysis mix, applies a lightweight guitar-range filter, rejects out-of-range transients, estimates register, and finds pulse/attacks locally. `analysis.worker.ts` keeps the signal scan off the UI thread.
- `src/domain/chart.ts` groups events into phrases, selects one known voice, remembers repeated-motif lane mappings, builds Expert, then musically selects and remaps each lower difficulty. It also owns chord, sustain, articulation, playability, and validation rules independent of serialization.
- `src/components/Highway.tsx` and `Waveform.tsx` are lightweight Canvas2D views. Their playhead comes only from `HTMLAudioElement.currentTime`; they do not maintain a competing playback clock.

The analyzer is intentionally lightweight rather than an ML transcription system. It favors a stable rhythmic interpretation, restrained density, quantization near the inferred beat grid, phrase contour, and repeated-riff consistency. Its guitar-focus pass suppresses much of the bass and cymbal range, but it is **not stem separation**: reliable guitar isolation from a finished mix needs a substantially larger ML/WASM source-separation model. A guitar stem or guitar-forward mix will produce the cleanest chart.

The current signal pass cannot reliably separate guitar voices or identify muting and legato. It emits conservative harmony and ringing evidence for occasional chords and useful sustains, while unknown articulation remains strummed. Retained attacks are locked to the nearest straight-sixteenth or triplet subdivision of the inferred beat.

## Milestone boundary

This build proves upload → decode/play → local analysis → four charts → synchronized preview. Editing, persistence, a backend, ML/WASM transcription, and Clone Hero serialization/export are intentionally deferred. The chart model contains no Clone Hero file-format fields so a later exporter can translate it without coupling analysis to serialization.
