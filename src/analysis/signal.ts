import type { AudioFeatures, TimedFeature } from './transcribe'

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function downmixChannels(channels: Float32Array[]) {
  const mono = new Float32Array(channels[0]?.length ?? 0)
  const gain = 1 / Math.max(channels.length, 1)
  for (const channel of channels) {
    for (let index = 0; index < mono.length; index += 1) mono[index] += channel[index] * gain
  }
  return mono
}

/** Lightweight emphasis of the useful guitar range; this is not source separation. */
export function focusGuitarBand(samples: Float32Array, sampleRate: number) {
  const focused = new Float32Array(samples.length)
  const dt = 1 / sampleRate
  const highPassAlpha = 1 / (1 + 2 * Math.PI * 75 * dt)
  const lowPassAlpha = dt / (1 / (2 * Math.PI * 5_200) + dt)
  let previousInput = 0
  let previousHighInput = 0
  let high1 = 0
  let high2 = 0
  let low1 = 0
  let low2 = 0

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]
    high1 = highPassAlpha * (high1 + sample - previousInput)
    previousInput = sample
    high2 = highPassAlpha * (high2 + high1 - previousHighInput)
    previousHighInput = high1
    low1 += lowPassAlpha * (high2 - low1)
    low2 += lowPassAlpha * (low1 - low2)
    focused[index] = low2
  }

  return focused
}

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

function estimatePitch(samples: Float32Array, start: number, sampleRate: number) {
  // Skip the pick transient, then use autocorrelation so distortion harmonics do not
  // masquerade as the fundamental as readily as zero-crossing counts do.
  const stride = Math.max(1, Math.round(sampleRate / 6_000))
  const effectiveRate = sampleRate / stride
  const offset = Math.min(samples.length - 1, start + Math.round(sampleRate * 0.02))
  const crossingEnd = Math.min(samples.length, offset + Math.round(sampleRate * 0.06))
  let crossings = 0
  for (let index = offset + 1; index < crossingEnd; index += 1) {
    if (samples[index - 1] <= 0 && samples[index] > 0) crossings += 1
  }
  const crossingPitchHz = crossings / Math.max((crossingEnd - offset) / sampleRate, 0.0001)
  const end = Math.min(samples.length, offset + Math.round(sampleRate * 0.1))
  const values: number[] = []
  for (let index = offset; index < end; index += stride) values.push(samples[index])
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  for (let index = 0; index < values.length; index += 1) values[index] -= mean

  const minimumLag = Math.max(2, Math.floor(effectiveRate / 1_200))
  const maximumLag = Math.min(values.length - 2, Math.ceil(effectiveRate / 70))
  const scores = new Float32Array(maximumLag + 1)
  let bestLag = minimumLag
  let bestScore = -1

  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let correlation = 0
    let energyA = 0
    let energyB = 0
    for (let index = 0; index < values.length - lag; index += 1) {
      correlation += values[index] * values[index + lag]
      energyA += values[index] * values[index]
      energyB += values[index + lag] * values[index + lag]
    }
    const score = correlation / Math.sqrt(Math.max(energyA * energyB, 0.000001))
    scores[lag] = score
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  const peakThreshold = Math.max(0.35, bestScore * 0.85)
  for (let lag = minimumLag + 1; lag < maximumLag; lag += 1) {
    if (scores[lag] >= peakThreshold && scores[lag] >= scores[lag - 1] && scores[lag] > scores[lag + 1]) {
      bestLag = lag
      bestScore = scores[lag]
      break
    }
  }

  const pitchHz = effectiveRate / Math.max(bestLag, 1)
  return {
    confidence: bestScore,
    crossingPitchHz,
    pitchHz,
    register: clamp(Math.log2(Math.max(82, pitchHz) / 82) / 4, 0, 1),
  }
}

export function analyzeSignal(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (progress: number) => void,
): AudioFeatures {
  const focused = focusGuitarBand(samples, sampleRate)
  const durationMs = (samples.length / sampleRate) * 1_000
  const hopSize = Math.max(128, Math.round(sampleRate * 0.012))
  const windowSize = hopSize * 2
  const frameCount = Math.max(1, Math.floor((samples.length - windowSize) / hopSize))
  const framesPerSecond = sampleRate / hopSize
  const energy = new Float32Array(frameCount)
  const broadEnergy = new Float32Array(frameCount)
  const broadFlux = new Float32Array(frameCount)
  const brightness = new Float32Array(frameCount)
  const flux = new Float32Array(frameCount)
  let maxEnergy = 0
  let maxFlux = 0
  let maxBroadEnergy = 0
  let maxBroadFlux = 0

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize
    const end = Math.min(samples.length, start + windowSize)
    let amplitude = 0
    let broadAmplitude = 0
    let difference = 0
    let previous = focused[start] ?? 0
    let sampleCount = 0

    for (let index = start; index < end; index += 2) {
      const sample = focused[index]
      amplitude += Math.abs(sample)
      broadAmplitude += Math.abs(samples[index])
      difference += Math.abs(sample - previous)
      previous = sample
      sampleCount += 1
    }

    energy[frame] = amplitude / Math.max(sampleCount, 1)
    broadEnergy[frame] = broadAmplitude / Math.max(sampleCount, 1)
    brightness[frame] = difference / Math.max(sampleCount, 1)
    const energyRise = Math.max(0, energy[frame] - (energy[frame - 1] ?? energy[frame]))
    const brightnessRise = Math.max(
      0,
      brightness[frame] - (brightness[frame - 1] ?? brightness[frame]),
    )
    flux[frame] = energyRise + brightnessRise * 0.45
    broadFlux[frame] = Math.max(0, broadEnergy[frame] - (broadEnergy[frame - 1] ?? broadEnergy[frame]))
    maxEnergy = Math.max(maxEnergy, energy[frame])
    maxFlux = Math.max(maxFlux, flux[frame])
    maxBroadEnergy = Math.max(maxBroadEnergy, broadEnergy[frame])
    maxBroadFlux = Math.max(maxBroadFlux, broadFlux[frame])
  }

  onProgress?.(0.35)

  const envelope = new Float32Array(frameCount)
  const tempoEnvelope = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const normalizedEnergy = maxEnergy > 0 ? energy[frame] / maxEnergy : 0
    const normalizedFlux = maxFlux > 0 ? flux[frame] / maxFlux : 0
    const normalizedBroadEnergy = maxBroadEnergy > 0 ? broadEnergy[frame] / maxBroadEnergy : 0
    const normalizedBroadFlux = maxBroadFlux > 0 ? broadFlux[frame] / maxBroadFlux : 0
    // Square roots compress loud drum transients so quieter guitar attacks remain visible.
    envelope[frame] = Math.sqrt(normalizedFlux) * 0.76 + Math.sqrt(normalizedEnergy) * 0.24
    // The backing rhythm is useful for tempo, but never becomes a guitar note by itself.
    tempoEnvelope[frame] = Math.sqrt(normalizedBroadFlux) * 0.72 + Math.sqrt(normalizedBroadEnergy) * 0.28
  }

  const bpm = maxBroadEnergy < 0.0001 ? 120 : estimateTempo(tempoEnvelope, framesPerSecond)
  const beatOffsetMs = findBeatOffset(tempoEnvelope, bpm, framesPerSecond)
  onProgress?.(0.65)

  const attacks: TimedFeature[] = []
  const localRadius = Math.max(3, Math.round(framesPerSecond * 0.11))
  const minimumGapFrames = Math.round(framesPerSecond * 0.072)
  const beatMs = 60_000 / bpm
  let lastPeak = -minimumGapFrames
  let previousAttackHardness = 0

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

    const guitarShare = energy[frame] / Math.max(broadEnergy[frame], 0.00001)
    const isPeak = envelope[frame] >= envelope[frame - 1] && envelope[frame] > envelope[frame + 1]
    if (
      !isPeak ||
      envelope[frame] < localMean * 1.14 + 0.025 ||
      guitarShare < 0.18 ||
      frame - lastPeak < minimumGapFrames
    ) {
      continue
    }

    const pitch = estimatePitch(focused, frame * hopSize, sampleRate)
    if (pitch.crossingPitchHz < 70 || pitch.crossingPitchHz > 2_400) continue
    const register = pitch.confidence >= 0.35 ? pitch.register : (attacks.at(-1)?.register ?? 0.5)

    const sustainFloor = Math.max(maxEnergy * 0.025, energy[frame] * 0.28)
    let sustainEnd = frame + 1
    const maximumEnd = Math.min(frameCount, frame + Math.round(framesPerSecond * 1.8))
    while (sustainEnd < maximumEnd && energy[sustainEnd] >= sustainFloor) sustainEnd += 1

    const durationMs = ((sustainEnd - frame) / framesPerSecond) * 1_000
    const probeEnd = Math.min(sustainEnd, frame + Math.round(framesPerSecond * 0.28))
    let strongestRetrigger = 0
    for (let probe = frame + 2; probe < probeEnd; probe += 1) {
      strongestRetrigger = Math.max(strongestRetrigger, flux[probe])
    }
    const ringingConfidence =
      durationMs >= 200
        ? clamp(1 - strongestRetrigger / Math.max(flux[frame], maxFlux * 0.03), 0, 1)
        : 0
    const strength = clamp(envelope[frame] * (0.7 + Math.min(guitarShare, 1) * 0.3), 0, 1)
    const harmonicRatio = pitch.crossingPitchHz / Math.max(pitch.pitchHz, 1)
    const harmonicConfidence =
      strength >= 0.65 &&
      durationMs >= 200 &&
      pitch.confidence >= 0.45 &&
      harmonicRatio >= 1.35 &&
      harmonicRatio <= 3.5
        ? clamp(0.62 + (harmonicRatio - 1.35) * 0.12 + strength * 0.15, 0, 0.95)
        : undefined

    // A hammer-on/pull-off re-pitches an already-ringing string instead of striking it again, so
    // its onset is markedly softer (lower flux relative to sustained energy) than a picked attack,
    // and it lands soon after the previous note on a nearby fret.
    const attackHardness = flux[frame] / Math.max(energy[frame], 0.00001)
    const previousAttack = attacks.at(-1)
    const timeMs = (frame / framesPerSecond) * 1_000
    const gapMs = previousAttack ? timeMs - previousAttack.timeMs : Infinity
    const registerDelta = previousAttack ? Math.abs(register - previousAttack.register) : Infinity
    const legatoConfidence =
      previousAttack &&
      gapMs > 0 &&
      gapMs <= beatMs * 0.6 &&
      registerDelta > 0.008 &&
      registerDelta <= 0.12 &&
      attackHardness < previousAttackHardness * 0.85
        ? clamp(0.65 + (1 - attackHardness / Math.max(previousAttackHardness, 0.00001)) * 0.3, 0, 0.95)
        : undefined

    attacks.push({
      timeMs,
      durationMs,
      strength,
      register,
      harmonicConfidence,
      ringingConfidence,
      legatoConfidence,
    })
    previousAttackHardness = attackHardness
    lastPeak = frame
  }

  const binCount = Math.min(1_200, Math.max(240, Math.ceil(durationMs / 35)))
  const waveform = Array.from({ length: binCount }, (_, bin) => {
    const start = Math.floor((bin / binCount) * samples.length)
    const end = Math.max(start + 1, Math.floor(((bin + 1) / binCount) * samples.length))
    let peak = 0
    for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(samples[index]))
    return peak
  })

  onProgress?.(0.92)
  return { durationMs, bpm, beatOffsetMs, attacks, waveform }
}
