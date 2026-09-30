import { describe, expect, it } from 'vitest'
import { transcribe, type AudioFeatures } from '../analysis/pipeline'
import {
  DIFFICULTIES,
  generateChart,
  validateChart,
  type MusicalNote,
} from './chart'

const note = (
  timeMs: number,
  register: number,
  strength = 0.7,
  extra: Partial<MusicalNote> = {},
): MusicalNote => ({
  timeMs,
  durationMs: 0,
  strength,
  register,
  beatPosition: timeMs / 500,
  ...extra,
})

const chartFor = (notes: MusicalNote[], durationMs = (notes.at(-1)?.timeMs ?? 0) + 1_000) =>
  generateChart({ durationMs, bpm: 120, beatOffsetMs: 0, notes })

describe('generateChart', () => {
  it('builds valid, monotonically simpler tracks within each lane limit', () => {
    const notes = Array.from({ length: 64 }, (_, index) =>
      note(index * 125, (index % 10) / 9, index % 4 === 0 ? 0.92 : 0.36),
    )
    const chart = chartFor(notes, 9_000)
    const counts = DIFFICULTIES.map((difficulty) => chart.tracks[difficulty].notes.length)
    const widths = DIFFICULTIES.map((difficulty) =>
      Math.max(...chart.tracks[difficulty].notes.map((event) => event.lanes.length), 0),
    )

    expect(counts[0]).toBeGreaterThan(0)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
    expect(chart.tracks.easy.notes.every((event) => event.lanes.every((lane) => lane <= 2))).toBe(true)
    expect(chart.tracks.medium.notes.every((event) => event.lanes.every((lane) => lane <= 3))).toBe(true)
    expect(validateChart(chart)).toEqual([])
  })

  it('reuses a repeated motif mapping and preserves ascending contour', () => {
    const repeated = chartFor([
      note(0, 0.2), note(250, 0.5), note(500, 0.8),
      note(1_500, 0.1), note(1_750, 0.4), note(2_000, 0.7),
    ]).tracks.expert.notes
    expect(repeated.slice(0, 3).map((event) => event.lanes)).toEqual(
      repeated.slice(3).map((event) => event.lanes),
    )

    const ascending = chartFor([
      note(0, 0.1), note(250, 0.3), note(500, 0.5), note(750, 0.7), note(1_000, 0.9),
    ]).tracks.expert.notes.map((event) => event.lanes[0])
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b))
  })

  it('selects one coherent guitar voice for a phrase', () => {
    const expert = chartFor([
      note(0, 0.2, 0.45, { voiceId: 'rhythm' }),
      note(125, 0.6, 0.9, { voiceId: 'lead' }),
      note(500, 0.3, 0.45, { voiceId: 'rhythm' }),
      note(625, 0.8, 0.9, { voiceId: 'lead' }),
    ]).tracks.expert.notes

    expect(expert.map((event) => event.timeMs)).toEqual([125, 625])
  })

  it('reduces an explicitly supported emphatic chord by difficulty', () => {
    const chart = chartFor([
      note(0, 0.5, 0.96, { harmonicConfidence: 0.96 }),
    ])

    expect(chart.tracks.expert.notes[0].lanes).toHaveLength(3)
    expect(chart.tracks.hard.notes[0].lanes).toHaveLength(2)
    expect(chart.tracks.medium.notes[0].lanes).toHaveLength(2)
    expect(chart.tracks.easy.notes[0].lanes).toHaveLength(1)
  })

  it('keeps an identity-defining upbeat and remaps reduced contours', () => {
    const syncopated = chartFor([
      note(0, 0.2, 0.25),
      note(250, 0.5, 0.95),
      note(500, 0.8, 0.25),
    ]).tracks.easy.notes
    expect(syncopated.map((event) => event.timeMs)).toEqual([250])

    const reduced = chartFor([
      note(0, 0.1, 0.9),
      note(125, 0.3, 0.1),
      note(250, 0.5, 0.9),
      note(375, 0.7, 0.1),
      note(500, 0.9, 0.9),
    ]).tracks.medium.notes
    expect(reduced.map((event) => event.lanes[0])).toEqual([0, 1, 2])
  })

  it('repairs sustains and only marks evidenced, different-lane legato as HOPO', () => {
    const sustained = chartFor([
      note(0, 0.2, 0.9, { durationMs: 430 }),
      note(600, 0.5, 0.9),
    ], 1_500)
    for (const difficulty of DIFFICULTIES) {
      const [held, next] = sustained.tracks[difficulty].notes
      expect(held.durationMs).toBeGreaterThanOrEqual(200)
      expect(next.timeMs - held.timeMs - held.durationMs).toBeGreaterThanOrEqual(60)
    }

    const legato = chartFor([
      note(0, 0.2, 0.9),
      note(250, 0.5, 0.9, { legatoConfidence: 0.9 }),
      note(500, 0.5, 0.9, { legatoConfidence: 0.9 }),
    ], 1_500)
    const expert = legato.tracks.expert.notes
    expect(expert[1].articulation).toBe('hopo')
    expect(expert[2].articulation).toBe('strum')
    expect(legato.tracks.medium.notes.every((event) => event.articulation === 'strum')).toBe(true)
    expect(legato.tracks.easy.notes.every((event) => event.articulation === 'strum')).toBe(true)
    expect(validateChart(sustained)).toEqual([])
    expect(validateChart(legato)).toEqual([])
  })
})

describe('transcribe', () => {
  it('quantizes detected guitar attacks and stays format-neutral', () => {
    const features: AudioFeatures = {
      durationMs: 2_000,
      bpm: 120,
      beatOffsetMs: 20,
      attacks: [
        { timeMs: 31, strength: 0.9, register: 0.2 },
        { timeMs: 418, strength: 0.7, register: 0.8 },
      ],
      waveform: [],
    }

    const notes = transcribe(features)
    expect(notes.map((event) => event.timeMs)).toEqual([20, 395])
    expect(notes[0].beatPosition).toBe(0)
    expect(notes.every((event) => !('lanes' in event))).toBe(true)
  })

  it('does not invent guitar notes when analysis detects no attacks', () => {
    expect(transcribe({ durationMs: 2_000, bpm: 120, beatOffsetMs: 0, attacks: [], waveform: [] })).toEqual([])
  })
})
