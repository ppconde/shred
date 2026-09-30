import {
  PlayableChartGenerator,
  type ChartGenerator,
  type MusicalNote,
  type SongChart,
} from '../domain/chart'

export interface TimedFeature {
  timeMs: number
  strength: number
  register: number
}

export interface AudioFeatures {
  durationMs: number
  bpm: number
  beatOffsetMs: number
  attacks: TimedFeature[]
  beats: TimedFeature[]
  waveform: number[]
}

export interface AudioAnalyzer {
  analyze(
    samples: Float32Array,
    sampleRate: number,
    onProgress?: (progress: number) => void,
  ): Promise<AudioFeatures>
}

export interface NoteTranscriber {
  transcribe(features: AudioFeatures): MusicalNote[]
}

export interface PipelineResult {
  chart: SongChart
  waveform: number[]
}

type WorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'result'; features: AudioFeatures }
  | { type: 'error'; message: string }

export class WorkerAudioAnalyzer implements AudioAnalyzer {
  analyze(samples: Float32Array, sampleRate: number, onProgress?: (progress: number) => void) {
    return new Promise<AudioFeatures>((resolve, reject) => {
      const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), {
        type: 'module',
      })

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
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/** Turns raw attacks and beat confidence into quantized, format-neutral musical notes. */
export class RhythmicTranscriber implements NoteTranscriber {
  transcribe(features: AudioFeatures): MusicalNote[] {
    const beatMs = 60_000 / features.bpm
    const sixteenthMs = beatMs / 4
    const candidates = [...features.attacks]

    for (const beat of features.beats) {
      const nearbyAttack = candidates.some((attack) => Math.abs(attack.timeMs - beat.timeMs) < 85)
      if (beat.strength >= 0.24 && !nearbyAttack) candidates.push(beat)
    }

    candidates.sort((a, b) => a.timeMs - b.timeMs)
    const deduplicated: TimedFeature[] = []
    for (const candidate of candidates) {
      const previous = deduplicated.at(-1)
      if (!previous || candidate.timeMs - previous.timeMs >= 58) {
        deduplicated.push(candidate)
      } else if (candidate.strength > previous.strength) {
        deduplicated[deduplicated.length - 1] = candidate
      }
    }

    return deduplicated.map((feature, index): MusicalNote => {
      const gridIndex = Math.round((feature.timeMs - features.beatOffsetMs) / sixteenthMs)
      const gridTime = features.beatOffsetMs + gridIndex * sixteenthMs
      const timeMs = Math.abs(feature.timeMs - gridTime) <= 72 ? gridTime : feature.timeMs
      const nextTime = deduplicated[index + 1]?.timeMs ?? features.durationMs
      const gap = nextTime - timeMs

      return {
        timeMs: clamp(timeMs, 0, features.durationMs),
        durationMs: feature.strength >= 0.62 && gap >= 330 ? Math.min(1_400, gap - 90) : 0,
        strength: clamp(feature.strength, 0, 1),
        register: clamp(feature.register, 0, 1),
        beatPosition: (timeMs - features.beatOffsetMs) / beatMs,
      }
    })
  }
}

export class LocalChartPipeline {
  constructor(
    private readonly analyzer: AudioAnalyzer = new WorkerAudioAnalyzer(),
    private readonly transcriber: NoteTranscriber = new RhythmicTranscriber(),
    private readonly generator: ChartGenerator = new PlayableChartGenerator(),
  ) {}

  async process(
    input: { title: string; samples: Float32Array; sampleRate: number },
    onProgress?: (progress: number) => void,
  ): Promise<PipelineResult> {
    const features = await this.analyzer.analyze(input.samples, input.sampleRate, onProgress)
    const notes = this.transcriber.transcribe(features)
    const chart = this.generator.generate({
      title: input.title,
      durationMs: features.durationMs,
      bpm: features.bpm,
      beatOffsetMs: features.beatOffsetMs,
      notes,
    })

    return { chart, waveform: features.waveform }
  }
}
