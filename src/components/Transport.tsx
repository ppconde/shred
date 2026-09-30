import type { SongChart } from '../domain/chart'

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  const remainder = Math.floor(Math.max(0, seconds) % 60)
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

interface TransportProps {
  hasAudio: boolean
  songTitle: string
  chart?: SongChart
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  speed: number
  onRestart(): void
  onToggle(): void
  onSeek(time: number): void
  onVolume(volume: number): void
  onSpeed(speed: number): void
}

export function Transport({
  hasAudio,
  songTitle,
  chart,
  playing,
  currentTime,
  duration,
  volume,
  speed,
  onRestart,
  onToggle,
  onSeek,
  onVolume,
  onSpeed,
}: TransportProps) {
  return (
    <section className="transport metal-panel">
      <div className="track-readout">
        <span>NOW FORGING</span>
        <strong>{songTitle}</strong>
        <small>
          {chart ? `${chart.bpm.toFixed(1)} BPM // ${chart.tracks.expert.notes.length} EXPERT NOTES` : 'AWAITING ANALYSIS'}
        </small>
      </div>
      <div className="transport-buttons">
        <button type="button" onClick={onRestart} disabled={!hasAudio} aria-label="Restart">↺</button>
        <button type="button" className="play-button" onClick={onToggle} disabled={!hasAudio}>
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
          onChange={(event) => onSeek(Number(event.target.value))}
          disabled={!hasAudio}
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
          onChange={(event) => onVolume(Number(event.target.value))}
        />
      </label>
      <label className="speed-control">
        <span>SPEED</span>
        <select name="speed" value={speed} onChange={(event) => onSpeed(Number(event.target.value))}>
          <option value="0.5">50%</option>
          <option value="0.75">75%</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
        </select>
      </label>
    </section>
  )
}
