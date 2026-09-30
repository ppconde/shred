import { generateChart } from '../domain/chart'
import { analyzeSignal } from './signal'
import { transcribe } from './transcribe'

type AnalysisRequest = { samples: Float32Array; sampleRate: number }
type WorkerScope = {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null
  postMessage(message: unknown): void
}

const scope = globalThis as unknown as WorkerScope

scope.onmessage = ({ data }) => {
  try {
    const features = analyzeSignal(data.samples, data.sampleRate, (progress) => {
      scope.postMessage({ type: 'progress', progress })
    })
    scope.postMessage({
      type: 'result',
      chart: generateChart({
        durationMs: features.durationMs,
        bpm: features.bpm,
        beatOffsetMs: features.beatOffsetMs,
        notes: transcribe(features),
      }),
      waveform: features.waveform,
    })
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown analysis failure',
    })
  }
}
