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

- `src/analysis/pipeline.ts` defines replaceable analyzer, transcription, and chart-generator boundaries. The included analyzer runs amplitude/attack, pulse, and tempo heuristics locally.
- `src/analysis/analysis.worker.ts` performs the signal scan off the UI thread.
- `src/domain/chart.ts` owns the format-neutral musical-note and five-lane chart models, difficulty mapping, playability constraints, and validation.
- `src/components/Highway.tsx` and `Waveform.tsx` are canvas views. Their playhead comes only from `HTMLAudioElement.currentTime`; they do not maintain a competing playback clock.

The analyzer is intentionally lightweight rather than an ML transcription system. It favors a stable rhythmic interpretation, restrained density, quantization near the inferred beat grid, simple melodic contours, and selective accents/chords.

## Milestone boundary

This build proves upload → decode/play → local analysis → four charts → synchronized preview. Editing, persistence, a backend, ML/WASM transcription, and Clone Hero serialization/export are intentionally deferred. The chart model contains no Clone Hero file-format fields so a later exporter can translate it without coupling analysis to serialization.
