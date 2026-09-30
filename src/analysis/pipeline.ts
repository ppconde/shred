import { generateChart, type MusicalNote } from '../domain/chart'

export interface TimedFeature {
  timeMs: number
  strength: number
  register: number
  durationMs?: number
  harmonicConfidence?: number
  ringingConfidence?: number
}

export interface AudioFeatures {
  durationMs: number
  bpm: number
  beatOffsetMs: number
  attacks: TimedFeature[]
  waveform: number[]
}

type WorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'result'; features: AudioFeatures }
  | { type: 'error'; message: string }

export function analyzeInWorker(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (progress: number) => void,
) {
  return new Promise<AudioFeatures>((resolve, reject) => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') {
        onProgress?.(data.progress)
        return
      }

      worker.terminate()
      if (data.type === 'error') reject(new Error(data.message))
      else resolve(data.features)
    }
    worker.onerror = ({ message }) => {
      worker.terminate()
      reject(new Error(message || 'Audio analysis worker failed'))
    }
    worker.postMessage({ samples, sampleRate }, [samples.buffer])
  })
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function transcribe(features: AudioFeatures): MusicalNote[] {
  const beatMs = 60_000 / features.bpm
  const sixteenthMs = beatMs / 4
  const candidates = [...features.attacks].sort((a, b) => a.timeMs - b.timeMs)
  const deduplicated: TimedFeature[] = []

  for (const candidate of candidates) {
    const previous = deduplicated.at(-1)
    if (!previous || candidate.timeMs - previous.timeMs >= 58) {
      deduplicated.push(candidate)
    } else if (candidate.strength > previous.strength) {
      deduplicated[deduplicated.length - 1] = candidate
    }
  }

  const quantized: TimedFeature[] = []
  for (const feature of deduplicated) {
    const straightTime =
      features.beatOffsetMs +
      Math.round((feature.timeMs - features.beatOffsetMs) / sixteenthMs) * sixteenthMs
    const tripletStep = beatMs / 3
    const tripletTime =
      features.beatOffsetMs +
      Math.round((feature.timeMs - features.beatOffsetMs) / tripletStep) * tripletStep
    const timeMs =
      Math.abs(feature.timeMs - tripletTime) < Math.abs(feature.timeMs - straightTime)
        ? tripletTime
        : straightTime
    const candidate = { ...feature, timeMs: clamp(timeMs, 0, features.durationMs) }
    const previous = quantized.at(-1)
    if (previous && Math.abs(previous.timeMs - candidate.timeMs) < 0.5) {
      if (candidate.strength > previous.strength) quantized[quantized.length - 1] = candidate
    } else {
      quantized.push(candidate)
    }
  }

  return quantized.map((feature) => ({
    timeMs: feature.timeMs,
    durationMs: feature.durationMs ?? 0,
    strength: clamp(feature.strength, 0, 1),
    register: clamp(feature.register, 0, 1),
    beatPosition: (feature.timeMs - features.beatOffsetMs) / beatMs,
    harmonicConfidence: feature.harmonicConfidence,
    ringingConfidence: feature.ringingConfidence,
  }))
}

export async function processAudio(
  input: { samples: Float32Array; sampleRate: number },
  onProgress?: (progress: number) => void,
) {
  const features = await analyzeInWorker(input.samples, input.sampleRate, onProgress)
  return {
    chart: generateChart({
      durationMs: features.durationMs,
      bpm: features.bpm,
      beatOffsetMs: features.beatOffsetMs,
      notes: transcribe(features),
    }),
    waveform: features.waveform,
  }
}
