import type { SongChart } from '../domain/chart'

type WorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'result'; chart: SongChart; waveform: number[] }
  | { type: 'error'; message: string }

export function processAudio(
  input: { samples: Float32Array; sampleRate: number },
  onProgress?: (progress: number) => void,
) {
  return new Promise<{ chart: SongChart; waveform: number[] }>((resolve, reject) => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') {
        onProgress?.(data.progress)
        return
      }

      worker.terminate()
      if (data.type === 'error') reject(new Error(data.message))
      else resolve({ chart: data.chart, waveform: data.waveform })
    }
    worker.onerror = ({ message }) => {
      worker.terminate()
      reject(new Error(message || 'Audio analysis worker failed'))
    }
    worker.postMessage(input, [input.samples.buffer])
  })
}
