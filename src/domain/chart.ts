export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const

export type Difficulty = (typeof DIFFICULTIES)[number]
export type Lane = 0 | 1 | 2 | 3 | 4

/** A musical event inferred from the recording, before any game-specific mapping. */
export interface MusicalNote {
  timeMs: number
  durationMs: number
  strength: number
  register: number
  beatPosition: number
}

/** A five-lane performance note. This model deliberately has no file-format concerns. */
export interface ChartNote {
  timeMs: number
  durationMs: number
  lanes: Lane[]
  accent: boolean
}

export interface DifficultyTrack {
  difficulty: Difficulty
  notes: ChartNote[]
}

export interface SongChart {
  title: string
  durationMs: number
  bpm: number
  beatOffsetMs: number
  tracks: Record<Difficulty, DifficultyTrack>
}

export interface ChartGenerator {
  generate(input: {
    title: string
    durationMs: number
    bpm: number
    beatOffsetMs: number
    notes: MusicalNote[]
  }): SongChart
}

const CONFIG: Record<
  Difficulty,
  {
    lanes: number
    subdivisions: number
    minGapMs: number
    minStrength: number
    rescueGapBeats: number
    chordStrength: number
    minSustainMs: number
  }
> = {
  easy: {
    lanes: 3,
    subdivisions: 1,
    minGapMs: 320,
    minStrength: 0.42,
    rescueGapBeats: 2,
    chordStrength: 2,
    minSustainMs: 360,
  },
  medium: {
    lanes: 4,
    subdivisions: 2,
    minGapMs: 220,
    minStrength: 0.3,
    rescueGapBeats: 1.5,
    chordStrength: 2,
    minSustainMs: 300,
  },
  hard: {
    lanes: 5,
    subdivisions: 4,
    minGapMs: 125,
    minStrength: 0.2,
    rescueGapBeats: 1,
    chordStrength: 0.84,
    minSustainMs: 240,
  },
  expert: {
    lanes: 5,
    subdivisions: 4,
    minGapMs: 72,
    minStrength: 0.08,
    rescueGapBeats: 0.75,
    chordStrength: 0.68,
    minSustainMs: 180,
  },
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

function selectNotes(notes: MusicalNote[], difficulty: Difficulty, beatMs: number) {
  const config = CONFIG[difficulty]
  const selected: MusicalNote[] = []
  let previousTime = -Infinity

  for (const note of notes) {
    const gap = note.timeMs - previousTime
    const onGrid =
      Math.abs(note.beatPosition * config.subdivisions - Math.round(note.beatPosition * config.subdivisions)) <
      0.16
    const strongOffGrid = note.strength >= 0.8
    const rescuesSilence = gap >= beatMs * config.rescueGapBeats

    if (gap < config.minGapMs || (!onGrid && !strongOffGrid) || (note.strength < config.minStrength && !rescuesSilence)) {
      continue
    }

    selected.push(note)
    previousTime = note.timeMs
  }

  return selected
}

const RIFF_SHAPES: Record<number, number[]> = {
  3: [0, 1, 2, 1, 0, 1, 2, 1],
  4: [0, 1, 2, 3, 2, 1, 0, 2, 3, 2, 1],
  5: [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 3, 1, 2],
}

function laneFor(note: MusicalNote, index: number, previous: number, laneCount: number) {
  const shape = RIFF_SHAPES[laneCount][index % RIFF_SHAPES[laneCount].length]
  const contourNudge = index % 4 === 3 ? (note.register > 0.68 ? 1 : note.register < 0.2 ? -1 : 0) : 0
  const target = clamp(shape + contourNudge, 0, laneCount - 1)
  return clamp(target, previous - 1, previous + 1) as Lane
}

export class PlayableChartGenerator implements ChartGenerator {
  generate(input: {
    title: string
    durationMs: number
    bpm: number
    beatOffsetMs: number
    notes: MusicalNote[]
  }): SongChart {
    const beatMs = 60_000 / input.bpm
    const tracks = {} as Record<Difficulty, DifficultyTrack>

    for (const difficulty of DIFFICULTIES) {
      const config = CONFIG[difficulty]
      let previousLane = 0
      const selected = selectNotes(input.notes, difficulty, beatMs)
      const notes = selected.map((note, index): ChartNote => {
        const lane = laneFor(note, index, previousLane, config.lanes)
        previousLane = lane
        const nearDownbeat = Math.abs(note.beatPosition - Math.round(note.beatPosition)) < 0.14
        const chord = note.strength >= config.chordStrength && nearDownbeat
        const secondLane = lane === config.lanes - 1 ? lane - 1 : lane + 1
        const nextTime = selected[index + 1]?.timeMs ?? input.durationMs
        const availableSustain = Math.max(0, nextTime - note.timeMs - config.minGapMs)
        const durationMs =
          note.durationMs >= config.minSustainMs
            ? Math.round(Math.min(note.durationMs, availableSustain, beatMs * 3))
            : 0

        return {
          timeMs: Math.round(note.timeMs),
          durationMs,
          lanes: (chord ? [lane, secondLane] : [lane]).sort((a, b) => a - b) as Lane[],
          accent: note.strength >= 0.72,
        }
      })

      tracks[difficulty] = { difficulty, notes }
    }

    return {
      title: input.title,
      durationMs: Math.round(input.durationMs),
      bpm: Math.round(input.bpm * 10) / 10,
      beatOffsetMs: Math.round(input.beatOffsetMs),
      tracks,
    }
  }
}

export function validateChart(chart: SongChart): string[] {
  const errors: string[] = []

  for (const difficulty of DIFFICULTIES) {
    let previousTime = -1
    for (const [index, note] of chart.tracks[difficulty].notes.entries()) {
      const label = `${difficulty} note ${index + 1}`
      if (!Number.isFinite(note.timeMs) || note.timeMs < 0 || note.timeMs > chart.durationMs) {
        errors.push(`${label} is outside the song`)
      }
      if (note.timeMs < previousTime) errors.push(`${label} is out of order`)
      if (note.durationMs < 0 || note.timeMs + note.durationMs > chart.durationMs) {
        errors.push(`${label} has an invalid sustain`)
      }
      if (note.lanes.length === 0 || new Set(note.lanes).size !== note.lanes.length || note.lanes.some((lane) => lane < 0 || lane > 4)) {
        errors.push(`${label} has invalid lanes`)
      }
      previousTime = note.timeMs
    }
  }

  return errors
}
