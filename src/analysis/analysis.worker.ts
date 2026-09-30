import type { AudioFeatures, TimedFeature } from './pipeline'

type AnalysisRequest = { samples: Float32Array; sampleRate: number }
type WorkerScope = {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null
  postMessage(message: unknown): void
}

const scope = globalThis as unknown as WorkerScope
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

function estimateTempo(envelope: Float32Array, framesPerSecond: number) {
  let bestBpm = 120
  let bestScore = -Infinity

  for (let bpm = 75; bpm <= 180; bpm += 1) {
    const lag = Math.round((60 * framesPerSecond) / bpm)
    let correlation = 0
    let weight = 0
    for (let index = lag; index < envelope.length; index += 1) {
      correlation += envelope[index] * envelope[index - lag]
      weight += envelope[index] + envelope[index - lag]
    }
    const score = weight > 0 ? correlation / weight : 0
    const centeredScore = score * (1 - Math.abs(bpm - 120) / 1_500)
    if (centeredScore > bestScore) {
      bestScore = centeredScore
      bestBpm = bpm
    }
  }

  return bestBpm
}

function findBeatOffset(envelope: Float32Array, bpm: number, framesPerSecond: number) {
  const beatFrames = (60 * framesPerSecond) / bpm
  let bestPhase = 0
  let bestScore = -Infinity

  for (let phase = 0; phase < Math.ceil(beatFrames); phase += 1) {
    let score = 0
    for (let frame = phase; frame < envelope.length; frame += beatFrames) {
      score += envelope[Math.round(frame)] ?? 0
    }
    if (score > bestScore) {
      bestScore = score
      bestPhase = phase
    }
  }

  return (bestPhase / framesPerSecond) * 1_000
}

function analyze({ samples, sampleRate }: AnalysisRequest): AudioFeatures {
  const durationMs = (samples.length / sampleRate) * 1_000
  const hopSize = Math.max(128, Math.round(sampleRate * 0.012))
  const windowSize = hopSize * 2
  const frameCount = Math.max(1, Math.floor((samples.length - windowSize) / hopSize))
  const framesPerSecond = sampleRate / hopSize
  const energy = new Float32Array(frameCount)
  const brightness = new Float32Array(frameCount)
  const flux = new Float32Array(frameCount)
  let maxEnergy = 0
  let maxFlux = 0

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize
    let amplitude = 0
    let difference = 0
    let previous = samples[start] ?? 0

    for (let index = start; index < Math.min(samples.length, start + windowSize); index += 2) {
      const sample = samples[index]
      amplitude += Math.abs(sample)
      difference += Math.abs(sample - previous)
      previous = sample
    }

    const sampleCount = Math.ceil(windowSize / 2)
    energy[frame] = amplitude / sampleCount
    brightness[frame] = difference / sampleCount
    const energyRise = Math.max(0, energy[frame] - (energy[frame - 1] ?? energy[frame]))
    const brightnessRise = Math.max(
      0,
      brightness[frame] - (brightness[frame - 1] ?? brightness[frame]),
    )
    flux[frame] = energyRise + brightnessRise * 0.45
    maxEnergy = Math.max(maxEnergy, energy[frame])
    maxFlux = Math.max(maxFlux, flux[frame])
  }

  scope.postMessage({ type: 'progress', progress: 0.35 })

  const envelope = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const normalizedEnergy = maxEnergy > 0 ? energy[frame] / maxEnergy : 0
    const normalizedFlux = maxFlux > 0 ? flux[frame] / maxFlux : 0
    envelope[frame] = normalizedFlux * 0.72 + normalizedEnergy * 0.28
  }

  const bpm = maxEnergy < 0.0001 ? 120 : estimateTempo(envelope, framesPerSecond)
  const beatOffsetMs = findBeatOffset(envelope, bpm, framesPerSecond)
  scope.postMessage({ type: 'progress', progress: 0.65 })

  const attacks: TimedFeature[] = []
  const localRadius = Math.max(3, Math.round(framesPerSecond * 0.11))
  const minimumGapFrames = Math.round(framesPerSecond * 0.072)
  let lastPeak = -minimumGapFrames

  for (let frame = 1; frame < frameCount - 1; frame += 1) {
    let localMean = 0
    let localCount = 0
    for (
      let neighbor = Math.max(0, frame - localRadius);
      neighbor <= Math.min(frameCount - 1, frame + localRadius);
      neighbor += 1
    ) {
      localMean += envelope[neighbor]
      localCount += 1
    }
    localMean /= localCount

    const isPeak = envelope[frame] >= envelope[frame - 1] && envelope[frame] > envelope[frame + 1]
    if (!isPeak || envelope[frame] < localMean * 1.22 + 0.035 || frame - lastPeak < minimumGapFrames) {
      continue
    }

    const spectralRatio = brightness[frame] / Math.max(energy[frame] * 2.4, 0.00001)
    attacks.push({
      timeMs: (frame / framesPerSecond) * 1_000,
      strength: clamp(envelope[frame], 0, 1),
      register: clamp(spectralRatio, 0, 1),
    })
    lastPeak = frame
  }

  const beats: TimedFeature[] = []
  const beatMs = 60_000 / bpm
  for (let timeMs = beatOffsetMs; timeMs < durationMs; timeMs += beatMs) {
    const frame = Math.min(frameCount - 1, Math.max(0, Math.round((timeMs / 1_000) * framesPerSecond)))
    const normalizedEnergy = maxEnergy > 0 ? energy[frame] / maxEnergy : 0
    beats.push({
      timeMs,
      strength: clamp(normalizedEnergy * 0.8, 0, 1),
      register: clamp(brightness[frame] / Math.max(energy[frame] * 2.4, 0.00001), 0, 1),
    })
  }

  const binCount = Math.min(1_200, Math.max(240, Math.ceil(durationMs / 35)))
  const waveform = Array.from({ length: binCount }, (_, bin) => {
    const start = Math.floor((bin / binCount) * samples.length)
    const end = Math.max(start + 1, Math.floor(((bin + 1) / binCount) * samples.length))
    let peak = 0
    for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(samples[index]))
    return peak
  })

  scope.postMessage({ type: 'progress', progress: 0.92 })
  return { durationMs, bpm, beatOffsetMs, attacks, beats, waveform }
}

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ type: 'result', features: analyze(data) })
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown analysis failure',
    })
  }
}
