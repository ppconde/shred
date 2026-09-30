import { useCallback, useEffect, useRef, useState } from 'react'
import { processAudio } from './analysis/pipeline'
import { downmixChannels } from './analysis/signal'
import { ChartWorkspace } from './components/ChartWorkspace'
import { Transport } from './components/Transport'
import { UploadForge } from './components/UploadForge'
import { validateChart, type Difficulty, type SongChart } from './domain/chart'
import { usePreviewKeyboard } from './hooks/usePreviewKeyboard'

const MAX_AUDIO_BYTES = 250 * 1024 * 1024
const AUDIO_EXTENSION = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i
const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
type Status = 'idle' | 'decoding' | 'analyzing' | 'ready' | 'error'

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const uploadSequence = useRef(0)
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
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('Audio never leaves this machine.')

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
    if (!audio.paused) {
      audio.pause()
      return
    }
    try {
      await audio.play()
    } catch {
      setMessage('Playback was blocked. Hit play again to unleash it.')
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
  const activeLanes = usePreviewKeyboard({
    audioRef,
    onToggle: togglePlayback,
    onRestart: restart,
    onSeek: seek,
    onDifficulty: setDifficulty,
  })

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
      const result = await processAudio({ samples, sampleRate: buffer.sampleRate }, (analysisProgress) => {
        if (sequence === uploadSequence.current) setProgress(0.2 + analysisProgress * 0.72)
      })
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
        <UploadForge hasAudio={Boolean(audioUrl)} onFile={loadAudio} />

        <section className="signal-strip" aria-live="polite">
          <span className={`signal-lamp ${status}`} />
          <strong>{status === 'idle' ? 'STANDBY' : status.toUpperCase()}</strong>
          <span>{message}</span>
          <progress className="signal-progress" value={progress} max="1" aria-label="Analysis progress" />
        </section>

        <Transport
          hasAudio={Boolean(audioUrl)}
          songTitle={songTitle}
          chart={chart}
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          speed={speed}
          onRestart={restart}
          onToggle={togglePlayback}
          onSeek={seek}
          onVolume={setVolume}
          onSpeed={setSpeed}
        />

        <ChartWorkspace
          chart={chart}
          difficulty={difficulty}
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          waveform={waveform}
          activeLanes={activeLanes}
          onDifficulty={setDifficulty}
          onSeek={seek}
        />
      </main>

      <footer>
        <strong>SHRED // SIGNAL STAYS LOCAL</strong>
        <span>EDITOR + CLONE HERO EXPORT: NEXT ENCORE</span>
      </footer>
    </div>
  )
}
