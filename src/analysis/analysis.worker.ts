import { analyzeSignal } from './signal'

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
    scope.postMessage({ type: 'result', features })
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown analysis failure',
    })
  }
}
