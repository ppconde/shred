import { describe, expect, it } from 'vitest'
import { RhythmicTranscriber, type AudioFeatures } from '../analysis/pipeline'
import {
  DIFFICULTIES,
  PlayableChartGenerator,
  validateChart,
  type MusicalNote,
} from './chart'

const musicalNotes = Array.from({ length: 64 }, (_, index): MusicalNote => ({
  timeMs: index * 125,
  durationMs: index % 8 === 0 ? 420 : 0,
  strength: index % 4 === 0 ? 0.92 : 0.36,
  register: (index % 10) / 9,
  beatPosition: index / 4,
}))

describe('PlayableChartGenerator', () => {
  const chart = new PlayableChartGenerator().generate({
    title: 'Synthetic Riff',
    durationMs: 9_000,
    bpm: 120,
    beatOffsetMs: 0,
    notes: musicalNotes,
  })

  it('builds increasingly detailed, valid tracks for all four difficulties', () => {
    expect(Object.keys(chart.tracks)).toEqual([...DIFFICULTIES])
    const counts = DIFFICULTIES.map((difficulty) => chart.tracks[difficulty].notes.length)
    expect(counts[0]).toBeGreaterThan(0)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
    expect(new Set(counts).size).toBeGreaterThan(2)
    expect(validateChart(chart)).toEqual([])
  })

  it('keeps easier charts readable and reserves chords for harder charts', () => {
    expect(chart.tracks.easy.notes.every((note) => note.lanes.every((lane) => lane <= 2))).toBe(true)
    expect(chart.tracks.easy.notes.every((note) => note.lanes.length === 1)).toBe(true)
    expect(chart.tracks.medium.notes.every((note) => note.lanes.every((lane) => lane <= 3))).toBe(true)
    expect(new Set(chart.tracks.expert.notes.flatMap((note) => note.lanes))).toEqual(new Set([0, 1, 2, 3, 4]))
    expect(chart.tracks.expert.notes.some((note) => note.lanes.length === 2)).toBe(true)
  })

  it('is deterministic for the same musical transcription', () => {
    const rerun = new PlayableChartGenerator().generate({
      title: 'Synthetic Riff',
      durationMs: 9_000,
      bpm: 120,
      beatOffsetMs: 0,
      notes: musicalNotes,
    })
    expect(rerun).toEqual(chart)
  })
})

describe('RhythmicTranscriber', () => {
  it('adds confident beat pulses, quantizes nearby attacks, and stays format-neutral', () => {
    const features: AudioFeatures = {
      durationMs: 2_000,
      bpm: 120,
      beatOffsetMs: 20,
      attacks: [
        { timeMs: 31, strength: 0.9, register: 0.2 },
        { timeMs: 418, strength: 0.7, register: 0.8 },
      ],
      beats: [
        { timeMs: 20, strength: 0.8, register: 0.3 },
        { timeMs: 520, strength: 0.65, register: 0.4 },
        { timeMs: 1_020, strength: 0.1, register: 0.5 },
      ],
      waveform: [],
    }

    const notes = new RhythmicTranscriber().transcribe(features)
    expect(notes.map((note) => note.timeMs)).toEqual([20, 395, 520])
    expect(notes[0].beatPosition).toBe(0)
    expect(notes.every((note) => !('lanes' in note))).toBe(true)
  })
})
