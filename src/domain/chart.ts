export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const

export type Difficulty = (typeof DIFFICULTIES)[number]
export type Lane = 0 | 1 | 2 | 3 | 4
export type NoteArticulation = 'strum' | 'hopo'

/** A guitar event inferred from the recording, before any game-specific mapping. */
export interface MusicalNote {
  timeMs: number
  durationMs: number
  strength: number
  register: number
  beatPosition: number
  voiceId?: string
  harmonicConfidence?: number
  ringingConfidence?: number
  mutedConfidence?: number
  legatoConfidence?: number
  phraseId?: string | number
}

/** A five-lane performance note. This model deliberately has no file-format concerns. */
export interface ChartNote {
  timeMs: number
  durationMs: number
  lanes: Lane[]
  accent: boolean
  articulation: NoteArticulation
}

export interface DifficultyTrack {
  notes: ChartNote[]
}

export interface SongChart {
  durationMs: number
  bpm: number
  beatOffsetMs: number
  tracks: Record<Difficulty, DifficultyTrack>
}

type DifficultyConfig = {
  lanes: number
  minGapBeats: number
  minGapMs: number
  minStrength: number
  maxChordWidth: number
  releaseGapMs: number
}

const CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: {
    lanes: 3,
    minGapBeats: 0.95,
    minGapMs: 360,
    minStrength: 0.66,
    maxChordWidth: 1,
    releaseGapMs: 100,
  },
  medium: {
    lanes: 4,
    minGapBeats: 0.58,
    minGapMs: 220,
    minStrength: 0.56,
    maxChordWidth: 2,
    releaseGapMs: 85,
  },
  hard: {
    lanes: 5,
    minGapBeats: 0.3,
    minGapMs: 115,
    minStrength: 0.48,
    maxChordWidth: 2,
    releaseGapMs: 75,
  },
  expert: {
    lanes: 5,
    minGapBeats: 0.12,
    minGapMs: 58,
    minStrength: 0.4,
    maxChordWidth: 3,
    releaseGapMs: 70,
  },
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

function splitPhrases(notes: MusicalNote[], beatMs: number) {
  const phrases: MusicalNote[][] = []
  for (const note of [...notes].sort((a, b) => a.timeMs - b.timeMs)) {
    const phrase = phrases.at(-1)
    const previous = phrase?.at(-1)
    const suppliedBoundary =
      previous?.phraseId !== undefined && note.phraseId !== previous.phraseId
    const derivedBoundary =
      previous !== undefined &&
      (note.timeMs - previous.timeMs > Math.max(650, beatMs * 1.5) ||
        note.beatPosition - (phrase?.[0]?.beatPosition ?? note.beatPosition) >= 4)

    if (!phrase || suppliedBoundary || derivedBoundary) phrases.push([note])
    else phrase.push(note)
  }
  return phrases
}

function selectPhraseVoice(notes: MusicalNote[], previousVoice?: string) {
  if (!notes.some((note) => note.voiceId)) return { notes, voice: previousVoice }

  const voices = new Map<string, MusicalNote[]>()
  for (const note of notes) {
    const voice = note.voiceId ?? 'unknown'
    voices.set(voice, [...(voices.get(voice) ?? []), note])
  }

  const selected = [...voices.entries()].sort(([voiceA, notesA], [voiceB, notesB]) => {
    const score = (voice: string, voiceNotes: MusicalNote[]) =>
      voiceNotes.reduce(
        (total, note) =>
          total + note.strength + (hasUsefulSustain(note) ? 0.2 : 0) + (note.harmonicConfidence ?? 0) * 0.1,
        voice === previousVoice ? 0.45 : 0,
      )
    return score(voiceB, notesB) - score(voiceA, notesA)
  })[0]

  return { voice: selected[0], notes: selected[1] }
}

function hasUsefulSustain(note: MusicalNote) {
  return note.durationMs >= 200 && (note.ringingConfidence ?? 0) >= 0.5
}

function eventImportance(note: MusicalNote, index: number, notes: MusicalNote[]) {
  const phase = ((note.beatPosition % 1) + 1) % 1
  const previous = notes[index - 1]
  const next = notes[index + 1]
  const isPeak =
    previous !== undefined &&
    next !== undefined &&
    ((note.register > previous.register && note.register > next.register) ||
      (note.register < previous.register && note.register < next.register))

  return (
    note.strength * 4 +
    (hasUsefulSustain(note) ? 1.5 : 0) +
    (index === 0 ? 0.9 : 0) +
    (index === notes.length - 1 ? 0.7 : 0) +
    (Math.abs(phase - 0.5) < 0.13 ? 1.15 : 0) +
    (phase > 0.13 && Math.abs(phase - 0.5) >= 0.13 && phase < 0.87 ? 0.65 : 0) +
    (isPeak ? 0.55 : 0) +
    (note.harmonicConfidence ?? 0) * 0.35
  )
}

function selectEvents(notes: MusicalNote[], difficulty: Difficulty, beatMs: number) {
  const config = CONFIG[difficulty]
  const minimumGap = Math.max(config.minGapMs, beatMs * config.minGapBeats)
  const ranked = notes
    .map((note, index) => ({ note, index, score: eventImportance(note, index, notes) }))
    .filter(
      ({ note, index }) =>
        note.strength >= config.minStrength ||
        hasUsefulSustain(note) ||
        index === 0 ||
        index === notes.length - 1,
    )
    .sort((a, b) => b.score - a.score || a.note.timeMs - b.note.timeMs)

  const selected: MusicalNote[] = []
  for (const { note } of ranked) {
    if (selected.every((kept) => Math.abs(kept.timeMs - note.timeMs) >= minimumGap)) {
      selected.push(note)
    }
  }
  return selected.sort((a, b) => a.timeMs - b.timeMs)
}

function pitchLevel(note: MusicalNote) {
  return Math.round(clamp(note.register, 0, 1) * 12)
}

function smoothedPitchLevels(notes: MusicalNote[]) {
  const levels = notes.map(pitchLevel)
  return levels.map((level, index) => {
    if (index === 0 || index === levels.length - 1 || notes[index].strength >= 0.78) return level
    const window = [levels[index - 1], level, levels[index + 1]]
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b)
    return window[Math.floor(window.length / 2)]
  })
}

function motifKey(notes: MusicalNote[]) {
  if (notes.length === 0) return 'empty'
  const levels = smoothedPitchLevels(notes)
  const contour = levels
    .slice(1)
    .map((level, index) => Math.sign(level - levels[index]))
    .filter((direction) => direction !== 0)
    .filter((direction, index, directions) => direction !== directions[index - 1])
  const duration = Math.round((notes.at(-1)!.beatPosition - notes[0].beatPosition) * 2)
  const accentBins = [0, 0, 0, 0]
  const span = Math.max(notes.at(-1)!.timeMs - notes[0].timeMs, 1)
  for (const note of notes) {
    if (note.strength >= 0.72) {
      accentBins[Math.min(3, Math.floor(((note.timeMs - notes[0].timeMs) / span) * 4))] = 1
    }
  }
  const harmony = notes.some((note) => (note.harmonicConfidence ?? 0) >= 0.68) ? 'chord' : 'single'
  return `${duration}|${contour.join(',')}|${accentBins.join('')}|${harmony}`
}

function mapPhraseLanes(
  notes: MusicalNote[],
  laneCount: number,
  motifMappings: Map<string, Lane[]>,
) {
  const key = motifKey(notes)
  const remembered = motifMappings.get(key)
  if (remembered?.length) {
    if (notes.length === 1) return [remembered[0]]
    return notes.map((_, index) =>
      remembered[Math.round((index / (notes.length - 1)) * (remembered.length - 1))],
    )
  }

  const levels = smoothedPitchLevels(notes)
  const netMotion = levels.slice(1).reduce((sum, level, index) => sum + Math.sign(level - levels[index]), 0)
  const center = Math.floor((laneCount - 1) / 2)
  let current = clamp(center + (netMotion > 0 ? -1 : netMotion < 0 ? 1 : 0), 0, laneCount - 1)
  const lanes: Lane[] = []
  const laneByLevel = new Map<number, number>()

  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index]
    if (index > 0) {
      const delta = level - levels[index - 1]
      const gapBeats = notes[index].beatPosition - notes[index - 1].beatPosition
      const maximumStep = gapBeats >= 1 ? 2 : 1
      const rememberedLane = laneByLevel.get(level)
      if (rememberedLane !== undefined) {
        current += clamp(rememberedLane - current, -maximumStep, maximumStep)
      } else if (Math.abs(delta) >= 2) {
        const desiredStep = Math.abs(delta) >= 5 && gapBeats >= 0.5 ? 2 : 1
        current += Math.sign(delta) * Math.min(desiredStep, maximumStep)
      }
      current = clamp(current, 0, laneCount - 1)
    }

    lanes.push(current as Lane)
    if (!laneByLevel.has(level)) laneByLevel.set(level, current)
  }

  motifMappings.set(key, lanes)
  return lanes
}

function chordWidth(
  note: MusicalNote,
  difficulty: Difficulty,
  index: number,
  notes: MusicalNote[],
  beatMs: number,
) {
  const config = CONFIG[difficulty]
  const confidence = note.harmonicConfidence
  if (
    config.maxChordWidth === 1 ||
    confidence === undefined ||
    (note.mutedConfidence ?? 0) >= 0.5
  ) {
    return 1
  }

  if (difficulty === 'expert' && confidence >= 0.92 && note.strength >= 0.85) return 3
  if (difficulty === 'medium') {
    const previousGap = note.timeMs - (notes[index - 1]?.timeMs ?? -Infinity)
    const nextGap = (notes[index + 1]?.timeMs ?? Infinity) - note.timeMs
    return confidence >= 0.82 && Math.min(previousGap, nextGap) >= beatMs * 0.55 ? 2 : 1
  }
  return confidence >= (difficulty === 'hard' ? 0.72 : 0.68) ? 2 : 1
}

function lanesForChord(base: Lane, width: number, laneCount: number): Lane[] {
  if (width === 1) return [base]
  if (width === 2) {
    const low = Math.min(base, laneCount - 2) as Lane
    return [low, (low + 1) as Lane]
  }
  const center = clamp(base, 1, laneCount - 2)
  return [(center - 1) as Lane, center as Lane, (center + 1) as Lane]
}

function articulationFor(
  note: MusicalNote,
  lanes: Lane[],
  previous: { note: MusicalNote; lanes: Lane[] } | undefined,
  difficulty: Difficulty,
  beatMs: number,
): NoteArticulation {
  if (
    difficulty === 'easy' ||
    difficulty === 'medium' ||
    lanes.length !== 1 ||
    previous?.lanes.length !== 1 ||
    (note.legatoConfidence ?? 0) < 0.65 ||
    note.timeMs - previous.note.timeMs > beatMs * 0.55 ||
    lanes[0] === previous.lanes[0]
  ) {
    return 'strum'
  }
  return 'hopo'
}

export function generateChart(input: {
  durationMs: number
  bpm: number
  beatOffsetMs: number
  notes: MusicalNote[]
}): SongChart {
  const beatMs = 60_000 / input.bpm
  let previousVoice: string | undefined
  const expertPhrases = splitPhrases(input.notes, beatMs).map((phrase) => {
    const selectedVoice = selectPhraseVoice(phrase, previousVoice)
    previousVoice = selectedVoice.voice
    return selectEvents(selectedVoice.notes, 'expert', beatMs)
  })
  const tracks = {} as Record<Difficulty, DifficultyTrack>

  for (const difficulty of DIFFICULTIES) {
    const config = CONFIG[difficulty]
    const motifMappings = new Map<string, Lane[]>()
    const mapped = expertPhrases.flatMap((expertPhrase) => {
      const notes = difficulty === 'expert' ? expertPhrase : selectEvents(expertPhrase, difficulty, beatMs)
      const lanes = mapPhraseLanes(notes, config.lanes, motifMappings)
      return notes.map((note, index) => ({ note, lane: lanes[index] }))
    })
    const mappedNotes = mapped.map((event) => event.note)
    const mappedLanes = mapped.map(({ note, lane }, index) =>
      lanesForChord(
        lane,
        Math.min(chordWidth(note, difficulty, index, mappedNotes, beatMs), config.maxChordWidth),
        config.lanes,
      ),
    )

    const notes = mapped.map(({ note }, index): ChartNote => {
      const lanes = mappedLanes[index]
      const nextTime = mapped[index + 1]?.note.timeMs ?? input.durationMs
      const availableSustain = Math.max(0, nextTime - note.timeMs - config.releaseGapMs)
      const candidateDuration = hasUsefulSustain(note)
        ? Math.round(Math.min(note.durationMs, availableSustain, beatMs * 4))
        : 0
      const durationMs = candidateDuration >= 200 ? candidateDuration : 0
      const previous = mapped[index - 1]

      return {
        timeMs: Math.round(note.timeMs),
        durationMs,
        lanes,
        accent: note.strength >= 0.72,
        articulation: articulationFor(
          note,
          lanes,
          previous ? { note: previous.note, lanes: mappedLanes[index - 1] } : undefined,
          difficulty,
          beatMs,
        ),
      }
    })

    tracks[difficulty] = { notes }
  }

  return {
    durationMs: Math.round(input.durationMs),
    bpm: Math.round(input.bpm * 10) / 10,
    beatOffsetMs: Math.round(input.beatOffsetMs),
    tracks,
  }
}

export function validateChart(chart: SongChart): string[] {
  const errors: string[] = []

  for (const difficulty of DIFFICULTIES) {
    const track = chart.tracks[difficulty]
    for (const [index, note] of track.notes.entries()) {
      const label = `${difficulty} note ${index + 1}`
      const previous = track.notes[index - 1]
      const next = track.notes[index + 1]
      if (!Number.isFinite(note.timeMs) || note.timeMs < 0 || note.timeMs > chart.durationMs) {
        errors.push(`${label} is outside the song`)
      }
      if (previous && note.timeMs < previous.timeMs) errors.push(`${label} is out of order`)
      if (note.durationMs < 0 || note.timeMs + note.durationMs > chart.durationMs) {
        errors.push(`${label} has an invalid sustain`)
      }
      if (note.durationMs > 0 && note.durationMs < 200) errors.push(`${label} has a stumpy sustain`)
      if (note.durationMs > 0 && next && next.timeMs - note.timeMs - note.durationMs < 60) {
        errors.push(`${label} leaves too little sustain release space`)
      }
      if (
        note.lanes.length === 0 ||
        note.lanes.length > CONFIG[difficulty].maxChordWidth ||
        new Set(note.lanes).size !== note.lanes.length ||
        note.lanes.some((lane) => lane < 0 || lane >= CONFIG[difficulty].lanes)
      ) {
        errors.push(`${label} has invalid lanes`)
      }
      if (
        note.articulation === 'hopo' &&
        (difficulty === 'easy' ||
          difficulty === 'medium' ||
          (previous?.lanes.length === 1 && previous.lanes[0] === note.lanes[0]))
      ) {
        errors.push(`${label} has an invalid HOPO`)
      }
    }
  }

  const counts = DIFFICULTIES.map((difficulty) => chart.tracks[difficulty].notes.length)
  if (counts.some((count, index) => index > 0 && count < counts[index - 1])) {
    errors.push('difficulty event counts are not monotonic')
  }

  const expertOnsets = new Set(chart.tracks.expert.notes.map((note) => note.timeMs))
  for (const difficulty of DIFFICULTIES.slice(0, -1)) {
    if (chart.tracks[difficulty].notes.some((note) => !expertOnsets.has(note.timeMs))) {
      errors.push(`${difficulty} contains an onset that is not in Expert`)
    }
  }

  return errors
}
