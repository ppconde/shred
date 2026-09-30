import { describe, expect, it } from 'vitest'
import { analyzeSignal, downmixChannels, focusGuitarBand } from './signal'

const SAMPLE_RATE = 44_100

function sine(frequency: number, seconds = 1) {
  return Float32Array.from(
    { length: SAMPLE_RATE * seconds },
    (_, index) => Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE),
  )
}

function rms(samples: Float32Array) {
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
}

function addBurst(samples: Float32Array, time: number, frequency: number, gain: number, decay: number) {
  const start = Math.round(time * SAMPLE_RATE)
  const length = Math.round(0.22 * SAMPLE_RATE)
  for (let offset = 0; offset < length && start + offset < samples.length; offset += 1) {
    const age = offset / SAMPLE_RATE
    samples[start + offset] +=
      Math.sin(2 * Math.PI * frequency * age) * gain * Math.exp(-age * decay)
  }
}

describe('guitar-focused signal analysis', () => {
  it('keeps a guitar line that is panned to only one stereo channel', () => {
    const left = new Float32Array(SAMPLE_RATE * 2)
    const right = new Float32Array(SAMPLE_RATE * 2)
    addBurst(left, 0.25, 45, 0.9, 20)
    addBurst(right, 0.5, 220, 0.45, 7)

    const attacks = analyzeSignal(downmixChannels([left, right]), SAMPLE_RATE).attacks
    expect(attacks.some((attack) => Math.abs(attack.timeMs - 500) < 90)).toBe(true)
  })

  it('emphasizes guitar frequencies over bass thumps and high cymbal energy', () => {
    const guitar = rms(focusGuitarBand(sine(220), SAMPLE_RATE))
    const bass = rms(focusGuitarBand(sine(45), SAMPLE_RATE))
    const cymbal = rms(focusGuitarBand(sine(9_000), SAMPLE_RATE))

    expect(guitar).toBeGreaterThan(bass * 2)
    expect(guitar).toBeGreaterThan(cymbal * 2)
  })

  it('keeps quieter guitar attacks visible beside louder out-of-band percussion', () => {
    const samples = new Float32Array(SAMPLE_RATE * 4)
    const guitarTimes = [0.5, 1.5, 2.5, 3.5]
    for (const time of [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25]) {
      addBurst(samples, time, 45, 0.95, 20)
    }
    for (const time of [1, 2, 3]) addBurst(samples, time, 9_000, 0.8, 35)
    for (const time of guitarTimes) addBurst(samples, time, 220, 0.42, 7)

    const features = analyzeSignal(samples, SAMPLE_RATE)
    const attacks = features.attacks
    expect(features.bpm).toBe(120)
    for (const time of guitarTimes) {
      expect(attacks.some((attack) => Math.abs(attack.timeMs - time * 1_000) < 90)).toBe(true)
    }
    expect(attacks).toHaveLength(guitarTimes.length)
    expect(attacks.every((attack) => attack.register > 0.25 && attack.register < 0.5)).toBe(true)
    expect(attacks.filter((attack) => guitarTimes.every((time) => Math.abs(attack.timeMs - time * 1_000) >= 90))).toHaveLength(0)
  })
})
