import { useEffect, useMemo, useRef } from 'react'
import type { ChartNote } from '../domain/chart'

const LANE_COLORS = ['#30d158', '#ff453a', '#ffd60a', '#0a84ff', '#ff8a00']
const LOOK_AHEAD_SECONDS = 4.2

export function fretHalfHeight(radius: number, nearestGapMs: number, travelHeight: number) {
  if (!Number.isFinite(nearestGapMs)) return radius * 0.62
  const projectedGap = (nearestGapMs / 1_000 / LOOK_AHEAD_SECONDS) * travelHeight
  return Math.min(radius * 0.62, Math.max(2, projectedGap * 0.38))
}

export function fretHalfWidth(radius: number, laneWidth: number) {
  return Math.min(radius * 1.12, laneWidth * 0.38)
}

interface HighwayProps {
  notes: ChartNote[]
  currentTime: number
  bpm: number
  beatOffset: number
  activeLanes: boolean[]
}

export function Highway({ notes, currentTime, bpm, beatOffset, activeLanes }: HighwayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const noteSpacing = useMemo(() => {
    const times = [...new Set(notes.map((note) => note.timeMs))].sort((a, b) => a - b)
    return new Map(
      times.map((time, index) => [
        time,
        Math.min(time - (times[index - 1] ?? -Infinity), (times[index + 1] ?? Infinity) - time),
      ]),
    )
  }, [notes])

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
      const horizonY = Math.max(110, height * 0.28)
      const hitY = height - 64
      const topLeft = width * 0.37
      const topRight = width * 0.63
      const bottomLeft = 22
      const bottomRight = width - 22
      const lookAhead = LOOK_AHEAD_SECONDS
      const nowMs = currentTime * 1_000
      const toPoint = (lanePosition: number, timeMs: number) => {
        const progress = 1 - (timeMs / 1_000 - currentTime) / lookAhead
        const left = topLeft + (bottomLeft - topLeft) * progress
        const right = topRight + (bottomRight - topRight) * progress
        return {
          x: left + (lanePosition / 5) * (right - left),
          y: horizonY + (hitY - horizonY) * progress,
          laneWidth: (right - left) / 5,
          progress,
        }
      }

      const background = context.createLinearGradient(0, 0, 0, height)
      background.addColorStop(0, '#162029')
      background.addColorStop(0.38, '#0b0f14')
      background.addColorStop(1, '#020305')
      context.fillStyle = background
      context.fillRect(0, 0, width, height)

      // Show plane: restrained loading-dock truss, speakers, haze, and crowd silhouettes.
      context.strokeStyle = '#4b5661'
      context.lineWidth = 5
      context.beginPath()
      context.moveTo(0, 28)
      context.lineTo(width, 28)
      context.stroke()
      context.lineWidth = 1
      context.strokeStyle = 'rgba(174, 185, 194, .28)'
      for (let x = 0; x < width; x += 44) {
        context.beginPath()
        context.moveTo(x, 18)
        context.lineTo(x + 44, 38)
        context.moveTo(x + 44, 18)
        context.lineTo(x, 38)
        context.stroke()
      }

      for (const light of [
        { x: width * 0.22, color: 'rgba(53, 205, 224, .14)', lean: 1 },
        { x: width * 0.78, color: 'rgba(255, 91, 46, .14)', lean: -1 },
      ]) {
        const beam = context.createLinearGradient(light.x, 26, light.x, horizonY)
        beam.addColorStop(0, light.color)
        beam.addColorStop(1, 'rgba(9, 10, 13, 0)')
        context.fillStyle = beam
        context.beginPath()
        context.moveTo(light.x - 12, 30)
        context.lineTo(light.x + 12, 30)
        context.lineTo(light.x + light.lean * 80 + 115, horizonY)
        context.lineTo(light.x + light.lean * 80 - 115, horizonY)
        context.closePath()
        context.fill()
      }

      context.fillStyle = '#0a0d11'
      for (const x of [20, width - 72]) {
        context.fillRect(x, horizonY - 82, 52, 82)
        context.strokeStyle = '#343d47'
        context.strokeRect(x + 4, horizonY - 77, 44, 34)
        context.strokeRect(x + 4, horizonY - 38, 44, 33)
      }
      context.fillStyle = '#05070a'
      for (let x = 0; x < width; x += 24) {
        if (x > topLeft - 24 && x < topRight + 24) continue
        const headY = horizonY - 8 - (x % 3) * 3
        context.beginPath()
        context.arc(x + 12, headY, 8, 0, Math.PI * 2)
        context.fill()
        context.fillRect(x + 4, headY + 5, 17, 14)
      }

      context.fillStyle = '#07090c'
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
        context.strokeStyle = beat % 4 === 0 ? 'rgba(255, 91, 46, .52)' : 'rgba(174, 185, 194, .16)'
        context.lineWidth = beat % 4 === 0 ? 2 : 1
        context.beginPath()
        context.moveTo(left.x, left.y)
        context.lineTo(right.x, right.y)
        context.stroke()
      }

      for (let lane = 0; lane <= 5; lane += 1) {
        const top = toPoint(lane, nowMs + lookAhead * 1_000)
        const bottom = toPoint(lane, nowMs)
        context.strokeStyle = lane === 0 || lane === 5 ? '#87939e' : 'rgba(120, 135, 148, .38)'
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
          const halfHeight = fretHalfHeight(
            radius,
            noteSpacing.get(note.timeMs) ?? Infinity,
            hitY - horizonY,
          )
          const halfWidth = fretHalfWidth(radius, center.laneWidth)
          const rimPadding = Math.min(2.5, halfHeight * 0.25)

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
          context.fillStyle = '#030405'
          context.beginPath()
          context.ellipse(
            center.x,
            center.y,
            Math.min(radius * 1.3, center.laneWidth * 0.44),
            halfHeight + rimPadding,
            0,
            0,
            Math.PI * 2,
          )
          context.fill()

          context.fillStyle = LANE_COLORS[lane]
          context.strokeStyle = '#f1e7d2'
          context.lineWidth = Math.max(1.5, radius * 0.12)
          context.beginPath()
          context.ellipse(center.x, center.y, halfWidth, halfHeight, 0, 0, Math.PI * 2)
          context.fill()
          context.stroke()
          context.shadowBlur = 0

          context.fillStyle = 'rgba(255,255,255,.78)'
          context.beginPath()
          context.ellipse(
            center.x - halfWidth * 0.22,
            center.y - halfHeight * 0.28,
            halfWidth * 0.28,
            Math.max(1.2, halfHeight * 0.2),
            0,
            0,
            Math.PI * 2,
          )
          context.fill()
        }
      }

      context.strokeStyle = '#f1e7d2'
      context.lineWidth = 4
      context.shadowColor = '#35cde0'
      context.shadowBlur = 9
      context.beginPath()
      context.moveTo(bottomLeft, hitY)
      context.lineTo(bottomRight, hitY)
      context.stroke()
      context.shadowBlur = 0

      for (let lane = 0; lane < 5; lane += 1) {
        const point = toPoint(lane + 0.5, nowMs)
        const active = activeLanes[lane]
        const receptorWidth = Math.min(active ? 31 : 27, point.laneWidth * 0.4)
        context.fillStyle = active ? LANE_COLORS[lane] : '#15191f'
        context.strokeStyle = active ? '#fff5d8' : LANE_COLORS[lane]
        context.lineWidth = active ? 4 : 2
        if (active) {
          context.shadowColor = LANE_COLORS[lane]
          context.shadowBlur = 22
        }
        context.beginPath()
        context.ellipse(point.x, hitY, receptorWidth, receptorWidth * 0.52, 0, 0, Math.PI * 2)
        context.fill()
        context.stroke()
        context.shadowBlur = 0
      }

      if (notes.length === 0) {
        context.fillStyle = 'rgba(241, 231, 210, .72)'
        context.font = '700 15px Impact, sans-serif'
        context.textAlign = 'center'
        context.fillText('DROP A TRACK TO IGNITE THE HIGHWAY', width / 2, height * 0.44)
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [activeLanes, beatOffset, bpm, currentTime, noteSpacing, notes])

  return (
    <canvas
      ref={canvasRef}
      className="highway"
      role="img"
      aria-label="Five-lane chart preview synchronized to the song"
    />
  )
}
