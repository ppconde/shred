import { useEffect, useRef } from 'react'
import type { ChartNote } from '../domain/chart'

const LANE_COLORS = ['#30d158', '#ff453a', '#ffd60a', '#0a84ff', '#ff8a00']

interface HighwayProps {
  notes: ChartNote[]
  currentTime: number
  bpm: number
  beatOffset: number
  activeLanes: boolean[]
}

export function Highway({ notes, currentTime, bpm, beatOffset, activeLanes }: HighwayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const bounds = canvas.getBoundingClientRect()
      const scale = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(bounds.width * scale))
      canvas.height = Math.max(1, Math.floor(bounds.height * scale))
      const context = canvas.getContext('2d')
      if (!context) return
      context.scale(scale, scale)

      const { width, height } = bounds
      const horizonY = 54
      const hitY = height - 64
      const topLeft = width * 0.37
      const topRight = width * 0.63
      const bottomLeft = 22
      const bottomRight = width - 22
      const lookAhead = 4.2
      const nowMs = currentTime * 1_000
      const toPoint = (lanePosition: number, timeMs: number) => {
        const progress = 1 - (timeMs / 1_000 - currentTime) / lookAhead
        const left = topLeft + (bottomLeft - topLeft) * progress
        const right = topRight + (bottomRight - topRight) * progress
        return {
          x: left + (lanePosition / 5) * (right - left),
          y: horizonY + (hitY - horizonY) * progress,
          progress,
        }
      }

      const background = context.createLinearGradient(0, 0, 0, height)
      background.addColorStop(0, '#1b0806')
      background.addColorStop(0.45, '#090909')
      background.addColorStop(1, '#020202')
      context.fillStyle = background
      context.fillRect(0, 0, width, height)

      context.fillStyle = '#070707'
      context.beginPath()
      context.moveTo(topLeft, horizonY)
      context.lineTo(topRight, horizonY)
      context.lineTo(bottomRight, hitY + 20)
      context.lineTo(bottomLeft, hitY + 20)
      context.closePath()
      context.fill()

      const beatMs = bpm > 0 ? 60_000 / bpm : 500
      const firstBeat = Math.ceil((nowMs - beatOffset) / beatMs)
      context.lineWidth = 1
      for (let beat = firstBeat; ; beat += 1) {
        const timeMs = beatOffset + beat * beatMs
        if (timeMs > nowMs + lookAhead * 1_000) break
        const left = toPoint(0, timeMs)
        const right = toPoint(5, timeMs)
        if (left.progress < 0 || left.progress > 1.04) continue
        context.strokeStyle = beat % 4 === 0 ? 'rgba(255,92,34,.48)' : 'rgba(255,255,255,.13)'
        context.lineWidth = beat % 4 === 0 ? 2 : 1
        context.beginPath()
        context.moveTo(left.x, left.y)
        context.lineTo(right.x, right.y)
        context.stroke()
      }

      for (let lane = 0; lane <= 5; lane += 1) {
        const top = toPoint(lane, nowMs + lookAhead * 1_000)
        const bottom = toPoint(lane, nowMs)
        context.strokeStyle = lane === 0 || lane === 5 ? '#6f6255' : 'rgba(176,165,147,.32)'
        context.lineWidth = lane === 0 || lane === 5 ? 3 : 1.5
        context.beginPath()
        context.moveTo(top.x, top.y)
        context.lineTo(bottom.x, hitY + 20)
        context.stroke()
      }

      const visible = notes
        .filter((note) => note.timeMs >= nowMs - 130 && note.timeMs <= nowMs + lookAhead * 1_000)
        .reverse()

      for (const note of visible) {
        for (const lane of note.lanes) {
          const center = toPoint(lane + 0.5, note.timeMs)
          if (center.progress < 0 || center.progress > 1.08) continue
          const radius = Math.max(6, 8 + center.progress * 12)

          if (note.durationMs > 0) {
            const end = toPoint(lane + 0.5, note.timeMs + note.durationMs)
            context.strokeStyle = `${LANE_COLORS[lane]}99`
            context.lineWidth = radius * 0.82
            context.beginPath()
            context.moveTo(center.x, center.y)
            context.lineTo(end.x, Math.max(horizonY, end.y))
            context.stroke()
          }

          context.shadowColor = LANE_COLORS[lane]
          context.shadowBlur = note.accent ? radius * 1.25 : radius * 0.5
          context.fillStyle = LANE_COLORS[lane]
          context.strokeStyle = '#0a0908'
          context.lineWidth = Math.max(2, radius * 0.22)
          context.beginPath()
          context.ellipse(center.x, center.y, radius * 1.18, radius * 0.62, 0, 0, Math.PI * 2)
          context.fill()
          context.stroke()
          context.shadowBlur = 0

          context.fillStyle = 'rgba(255,255,255,.72)'
          context.beginPath()
          context.ellipse(
            center.x - radius * 0.25,
            center.y - radius * 0.18,
            radius * 0.34,
            radius * 0.14,
            0,
            0,
            Math.PI * 2,
          )
          context.fill()
        }
      }

      context.strokeStyle = '#f2e2bd'
      context.lineWidth = 4
      context.shadowColor = '#ff3b00'
      context.shadowBlur = 9
      context.beginPath()
      context.moveTo(bottomLeft, hitY)
      context.lineTo(bottomRight, hitY)
      context.stroke()
      context.shadowBlur = 0

      for (let lane = 0; lane < 5; lane += 1) {
        const point = toPoint(lane + 0.5, nowMs)
        const active = activeLanes[lane]
        context.fillStyle = active ? LANE_COLORS[lane] : '#171412'
        context.strokeStyle = active ? '#fff5d8' : LANE_COLORS[lane]
        context.lineWidth = active ? 4 : 2
        if (active) {
          context.shadowColor = LANE_COLORS[lane]
          context.shadowBlur = 22
        }
        context.beginPath()
        context.ellipse(point.x, hitY, active ? 31 : 27, active ? 16 : 14, 0, 0, Math.PI * 2)
        context.fill()
        context.stroke()
        context.shadowBlur = 0
      }

      if (notes.length === 0) {
        context.fillStyle = 'rgba(235,222,193,.65)'
        context.font = '700 15px Impact, sans-serif'
        context.textAlign = 'center'
        context.fillText('DROP A TRACK TO IGNITE THE HIGHWAY', width / 2, height * 0.44)
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [activeLanes, beatOffset, bpm, currentTime, notes])

  return (
    <canvas
      ref={canvasRef}
      className="highway"
      role="img"
      aria-label="Five-lane chart preview synchronized to the song"
    />
  )
}
