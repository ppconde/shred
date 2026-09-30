import { useEffect, useRef } from 'react'
import type { ChartNote } from '../domain/chart'

interface WaveformProps {
  samples: number[]
  duration: number
  currentTime: number
  notes?: ChartNote[]
  onSeek(time: number): void
}

export function Waveform({ samples, duration, currentTime, notes = [], onSeek }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio))
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio))
      const context = canvas.getContext('2d')
      if (!context) return
      context.scale(ratio, ratio)

      const { width, height } = bounds
      const progress = duration > 0 ? currentTime / duration : 0
      context.fillStyle = '#100d0c'
      context.fillRect(0, 0, width, height)

      context.strokeStyle = 'rgba(255,255,255,.08)'
      context.lineWidth = 1
      for (let section = 1; section < 8; section += 1) {
        const x = (section / 8) * width
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x, height)
        context.stroke()
      }

      context.fillStyle = 'rgba(231, 49, 25, .52)'
      for (const note of notes) {
        const x = (note.timeMs / 1_000 / Math.max(duration, 1)) * width
        context.fillRect(x, 0, 1, height)
      }

      const center = height / 2
      const barWidth = width / Math.max(samples.length, 1)
      samples.forEach((sample, index) => {
        const x = index * barWidth
        const amplitude = Math.max(1.5, sample * (height - 12))
        const played = x / width <= progress
        context.fillStyle = played ? '#f15a2a' : '#c9bfaa'
        context.fillRect(x, center - amplitude / 2, Math.max(1, barWidth + 0.4), amplitude)
      })

      const playhead = Math.max(0, Math.min(width, progress * width))
      context.shadowColor = '#ff3d00'
      context.shadowBlur = 10
      context.fillStyle = '#fff2d3'
      context.fillRect(playhead - 1, 0, 2, height)
      context.shadowBlur = 0
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [currentTime, duration, notes, samples])

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      aria-label="Song waveform. Click or drag to seek."
      role="img"
      onPointerDown={(event) => {
        if (!duration) return
        const bounds = event.currentTarget.getBoundingClientRect()
        onSeek(Math.max(0, Math.min(duration, ((event.clientX - bounds.left) / bounds.width) * duration)))
      }}
    />
  )
}
