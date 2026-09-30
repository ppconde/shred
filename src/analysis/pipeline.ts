import { generateChart, type MusicalNote } from '../domain/chart'

export interface TimedFeature {
  timeMs: number
  strength: number
  register: number
  durationMs?: number
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

  return deduplicated.map((feature, index) => {
    const gridIndex = Math.round((feature.timeMs - features.beatOffsetMs) / sixteenthMs)
    const gridTime = features.beatOffsetMs + gridIndex * sixteenthMs
    const timeMs = Math.abs(feature.timeMs - gridTime) <= 72 ? gridTime : feature.timeMs
    const nextTime = deduplicated[index + 1]?.timeMs ?? features.durationMs

    return {
      timeMs: clamp(timeMs, 0, features.durationMs),
      durationMs: feature.durationMs
        ? Math.min(feature.durationMs, Math.max(0, nextTime - timeMs - 90))
        : 0,
      strength: clamp(feature.strength, 0, 1),
      register: clamp(feature.register, 0, 1),
      beatPosition: (timeMs - features.beatOffsetMs) / beatMs,
    }
  })
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
