import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LocalChartPipeline } from './analysis/pipeline'
import { downmixChannels } from './analysis/signal'
import { Highway } from './components/Highway'
import { Waveform } from './components/Waveform'
import {
  DIFFICULTIES,
  validateChart,
  type Difficulty,
  type SongChart,
} from './domain/chart'

const MAX_AUDIO_BYTES = 250 * 1024 * 1024
const AUDIO_EXTENSION = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i
const LANE_KEYS: Record<string, number> = { KeyA: 0, KeyS: 1, KeyJ: 2, KeyK: 3, KeyL: 4 }

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  const remainder = Math.floor(Math.max(0, seconds) % 60)
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const uploadSequence = useRef(0)
  const pipeline = useMemo(() => new LocalChartPipeline(), [])
  const [audioUrl, setAudioUrl] = useState<string>()
  const [songTitle, setSongTitle] = useState('NO TRACK LOADED')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.85)
  const [speed, setSpeed] = useState(1)
  const [chart, setChart] = useState<SongChart>()
  const [waveform, setWaveform] = useState<number[]>([])
  const [difficulty, setDifficulty] = useState<Difficulty>('expert')
  const [status, setStatus] = useState<'idle' | 'decoding' | 'analyzing' | 'ready' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('Audio never leaves this machine.')
  const [activeLanes, setActiveLanes] = useState([false, false, false, false, false])

  const selectedTrack = chart?.tracks[difficulty]

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    },
    [audioUrl],
  )

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.playbackRate = speed
  }, [audioUrl, speed, volume])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const updateClock = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
      frame = requestAnimationFrame(updateClock)
    }
    frame = requestAnimationFrame(updateClock)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current
    if (!audioUrl || !audio) return
    if (audio.paused) {
      try {
        await audio.play()
      } catch {
        setMessage('Playback was blocked. Hit play again to unleash it.')
      }
    } else {
      audio.pause()
    }
  }, [audioUrl])

  const seek = useCallback(
    (time: number) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = Math.max(0, Math.min(duration, time))
      setCurrentTime(audio.currentTime)
    },
    [duration],
  )

  const restart = useCallback(() => seek(0), [seek])

  useEffect(() => {
    const updateLane = (code: string, pressed: boolean) => {
      const lane = LANE_KEYS[code]
      if (lane === undefined) return false
      setActiveLanes((current) => {
        if (current[lane] === pressed) return current
        const next = [...current]
        next[lane] = pressed
        return next
      })
      return true
    }

    const keyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(element.tagName)) return
      if (updateLane(event.code, true)) return
      if (event.repeat) return

      if (event.code === 'Space') {
        event.preventDefault()
        void togglePlayback()
      } else if (event.code === 'KeyR') {
        restart()
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault()
        seek((audioRef.current?.currentTime ?? 0) - 5)
      } else if (event.code === 'ArrowRight') {
        event.preventDefault()
        seek((audioRef.current?.currentTime ?? 0) + 5)
      } else if (/^Digit[1-4]$/.test(event.code)) {
        setDifficulty(DIFFICULTIES[Number(event.code.at(-1)) - 1])
      }
    }
    const keyUp = (event: KeyboardEvent) => updateLane(event.code, false)

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [restart, seek, togglePlayback])

  const loadAudio = async (file: File) => {
    const sequence = ++uploadSequence.current
    if (!file.size) {
      setStatus('error')
      setMessage('That file is empty. Feed the forge a real recording.')
      return
    }
    if (file.size > MAX_AUDIO_BYTES) {
      setStatus('error')
      setMessage('Keep tracks under 250 MB so the browser stays upright.')
      return
    }
    if (!file.type.startsWith('audio/') && !AUDIO_EXTENSION.test(file.name)) {
      setStatus('error')
      setMessage('Unsupported file. Try MP3, WAV, OGG, M4A, AAC, FLAC, or WebM audio.')
      return
    }

    audioRef.current?.pause()
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setChart(undefined)
    setWaveform([])
    setSongTitle(titleFromFile(file.name).toUpperCase())
    setAudioUrl(URL.createObjectURL(file))
    setStatus('decoding')
    setProgress(0.08)
    setMessage('Decoding the signal… playback is already armed.')

    let context: AudioContext | undefined
    try {
      const bytes = await file.arrayBuffer()
      context = new AudioContext()
      const buffer = await context.decodeAudioData(bytes)
      if (sequence !== uploadSequence.current) return

      setDuration(buffer.duration)
      setStatus('analyzing')
      setProgress(0.2)
      setMessage('Focusing the guitar range and tracing playable attacks…')
      const samples = downmixChannels(
        Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)),
      )
      const result = await pipeline.process(
        { title: titleFromFile(file.name), samples, sampleRate: buffer.sampleRate },
        (analysisProgress) => {
          if (sequence === uploadSequence.current) setProgress(0.2 + analysisProgress * 0.72)
        },
      )
      if (sequence !== uploadSequence.current) return

      const errors = validateChart(result.chart)
      if (errors.length) throw new Error(errors[0])
      setChart(result.chart)
      setWaveform(result.waveform)
      setDuration(result.chart.durationMs / 1_000)
      setStatus('ready')
      setProgress(1)
      setMessage(
        result.chart.tracks.expert.notes.length
          ? 'Four difficulty charts forged. The highway is live.'
          : 'Analysis complete. This signal was too quiet to forge reliable notes.',
      )
    } catch (error) {
      if (sequence !== uploadSequence.current) return
      setStatus('error')
      setMessage(
        error instanceof Error
          ? `Could not analyze this recording: ${error.message}`
          : 'Could not analyze this recording.',
      )
    } finally {
      await context?.close()
    }
  }

  return (
    <div className="app-shell">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      />

      <header className="masthead">
        <div className="brand-lockup" aria-label="SHRED">
          <span className="brand-kicker">FIVE-LANE CHART FORGE</span>
          <span className="brand">SHR<span>E</span>D</span>
        </div>
        <div className="build-stamp">
          <span>LOCAL SIGNAL</span>
          <strong>PREVIEW // 01</strong>
        </div>
      </header>

      <main>
        <section className={`forge-panel riveted ${audioUrl ? 'loaded' : ''}`}>
          <div className="forge-copy">
            <p className="eyebrow">TURN NOISE INTO NOTEFIRE</p>
            <h1>LOAD IT. READ IT. <em>SHRED IT.</em></h1>
            <p>
              Drop a recording into the local forge. SHRED reads its pulse, builds four playable
              interpretations, and drives the preview straight from the audio clock.
            </p>
          </div>
          <label className="drop-zone">
            <input
              id="audio-file"
              name="audio-file"
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.webm"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void loadAudio(file)
                event.target.value = ''
              }}
            />
            <span className="pick-icon">ϟ</span>
            <strong>{audioUrl ? 'SWAP THE TRACK' : 'FEED THE FORGE'}</strong>
            <small>MP3 · WAV · OGG · M4A · AAC · FLAC · WEBM</small>
          </label>
        </section>

        <section className="signal-strip" aria-live="polite">
          <span className={`signal-lamp ${status}`} />
          <strong>{status === 'idle' ? 'STANDBY' : status.toUpperCase()}</strong>
          <span>{message}</span>
          <div className="meter" aria-hidden="true">
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        </section>

        <section className="transport metal-panel">
          <div className="track-readout">
            <span>NOW FORGING</span>
            <strong>{songTitle}</strong>
            <small>
              {chart ? `${chart.bpm.toFixed(1)} BPM // ${chart.tracks.expert.notes.length} EXPERT NOTES` : 'AWAITING ANALYSIS'}
            </small>
          </div>
          <div className="transport-buttons">
            <button type="button" onClick={restart} disabled={!audioUrl} aria-label="Restart">
              ↺
            </button>
            <button
              type="button"
              className="play-button"
              onClick={() => void togglePlayback()}
              disabled={!audioUrl}
            >
              {playing ? 'PAUSE' : 'PLAY'}
            </button>
          </div>
          <label className="seek-control">
            <span>{formatTime(currentTime)}</span>
            <input
              type="range"
              name="position"
              min="0"
              max={duration || 0}
              step="0.01"
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => seek(Number(event.target.value))}
              disabled={!audioUrl}
              aria-label="Song position"
            />
            <span>{formatTime(duration)}</span>
          </label>
          <label className="dial-control">
            <span>VOLUME</span>
            <input
              type="range"
              name="volume"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </label>
          <label className="speed-control">
            <span>SPEED</span>
            <select name="speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
              <option value="0.5">50%</option>
              <option value="0.75">75%</option>
              <option value="1">100%</option>
              <option value="1.25">125%</option>
              <option value="1.5">150%</option>
            </select>
          </label>
        </section>

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
                  onClick={() => setDifficulty(level)}
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
              notes={selectedTrack?.notes ?? []}
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
          <Waveform
            samples={waveform}
            duration={duration}
            currentTime={currentTime}
            notes={selectedTrack?.notes}
            onSeek={seek}
          />
        </section>
      </main>

      <footer>
        <strong>SHRED // SIGNAL STAYS LOCAL</strong>
        <span>EDITOR + CLONE HERO EXPORT: NEXT ENCORE</span>
      </footer>
    </div>
  )
}
