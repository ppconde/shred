import { DIFFICULTIES, type Difficulty, type SongChart } from '../domain/chart'
import { Highway } from './Highway'
import { Waveform } from './Waveform'

interface ChartWorkspaceProps {
  chart?: SongChart
  difficulty: Difficulty
  playing: boolean
  currentTime: number
  duration: number
  waveform: number[]
  activeLanes: boolean[]
  onDifficulty(difficulty: Difficulty): void
  onSeek(time: number): void
}

export function ChartWorkspace({
  chart,
  difficulty,
  playing,
  currentTime,
  duration,
  waveform,
  activeLanes,
  onDifficulty,
  onSeek,
}: ChartWorkspaceProps) {
  const notes = chart?.tracks[difficulty].notes ?? []

  return (
    <>
      <section className="stage-grid">
        <aside className="chart-rack metal-panel">
          <div className="panel-heading">
            <span>01</span>
            <div>
              <p>CHART LOADOUT</p>
              <h2>DIFFICULTY</h2>
            </div>
          </div>
          <div className="difficulty-list" role="group" aria-label="Preview difficulty">
            {DIFFICULTIES.map((level, index) => (
              <button
                type="button"
                key={level}
                className={difficulty === level ? 'selected' : ''}
                onClick={() => onDifficulty(level)}
              >
                <span>0{index + 1}</span>
                <strong>{level}</strong>
                <small>{chart ? `${chart.tracks[level].notes.length} NOTES` : '—'}</small>
              </button>
            ))}
          </div>
          <div className="riff-code">
            <span>PREVIEW KEYS</span>
            <p><kbd>SPACE</kbd> PLAY / PAUSE</p>
            <p><kbd>←</kbd><kbd>→</kbd> SEEK 5 SEC</p>
            <p><kbd>1</kbd>–<kbd>4</kbd> DIFFICULTY</p>
            <p><kbd>A</kbd><kbd>S</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd> FRETS</p>
            <p><kbd>R</kbd> RESTART</p>
          </div>
        </aside>

        <div className="preview-deck metal-panel">
          <div className="panel-heading compact">
            <span>02</span>
            <div>
              <p>LIVE PREVIEW</p>
              <h2>{difficulty.toUpperCase()} HIGHWAY</h2>
            </div>
            <i className={playing ? 'live' : ''}>{playing ? 'RUNNING' : 'ARMED'}</i>
          </div>
          <Highway
            notes={notes}
            currentTime={currentTime}
            bpm={chart?.bpm ?? 120}
            beatOffset={chart?.beatOffsetMs ?? 0}
            activeLanes={activeLanes}
          />
          <div className="lane-legend" aria-hidden="true">
            {['A', 'S', 'J', 'K', 'L'].map((key) => <span key={key}>{key}</span>)}
          </div>
        </div>
      </section>

      <section className="timeline-panel metal-panel">
        <div className="panel-heading compact">
          <span>03</span>
          <div>
            <p>SONIC TIMELINE</p>
            <h2>WAVEFORM / NOTE MAP</h2>
          </div>
        </div>
        <Waveform samples={waveform} duration={duration} currentTime={currentTime} notes={notes} onSeek={onSeek} />
      </section>
    </>
  )
}
