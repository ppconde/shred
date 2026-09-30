import { Canvas, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import { Shape } from 'three'
import type { ChartNote } from '../domain/chart'
import { HIGHWAY_LOOK_AHEAD, highwayGemSize, highwayProgress } from './highwayMath'

const LANE_COLORS = ['#30d158', '#ff453a', '#ffd60a', '#0a84ff', '#ff8a00']

type Point = { x: number; y: number }
type Layout = {
  topY: number
  hitY: number
  topHalf: number
  bottomHalf: number
  point(lanePosition: number, progress: number): Point
}

interface HighwayProps {
  notes: ChartNote[]
  currentTime: number
  bpm: number
  beatOffset: number
  activeLanes: boolean[]
}

function Bar({
  from,
  to,
  color,
  thickness,
  z = 0,
  opacity = 1,
}: {
  from: Point
  to: Point
  color: string
  thickness: number
  z?: number
  opacity?: number
}) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return (
    <mesh
      position={[(from.x + to.x) / 2, (from.y + to.y) / 2, z]}
      rotation={[0, 0, Math.atan2(dy, dx)]}
    >
      <planeGeometry args={[Math.hypot(dx, dy), thickness]} />
      <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

function Road({ layout }: { layout: Layout }) {
  const shape = useMemo(() => {
    const road = new Shape()
    road.moveTo(-layout.topHalf, layout.topY)
    road.lineTo(layout.topHalf, layout.topY)
    road.lineTo(layout.bottomHalf, layout.hitY - 0.2)
    road.lineTo(-layout.bottomHalf, layout.hitY - 0.2)
    road.closePath()
    return road
  }, [layout.bottomHalf, layout.hitY, layout.topHalf, layout.topY])

  return (
    <mesh position={[0, 0, -0.5]}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color="#070707" />
    </mesh>
  )
}

function Gem({ point, size, lane, accent }: { point: Point; size: number; lane: number; accent: boolean }) {
  const color = LANE_COLORS[lane]
  return (
    <group position={[point.x, point.y, 0.55]}>
      {accent && (
        <mesh scale={[size * 1.45, size * 0.82, 1]}>
          <torusGeometry args={[1, 0.13, 8, 28]} />
          <meshBasicMaterial color={color} transparent opacity={0.42} />
        </mesh>
      )}
      <mesh scale={[size * 1.2, size * 0.66, size * 0.36]}>
        <sphereGeometry args={[1, 24, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={accent ? 0.82 : 0.45}
          metalness={0.38}
          roughness={0.28}
        />
      </mesh>
      <mesh position={[-size * 0.26, size * 0.16, size * 0.35]} scale={[size * 0.28, size * 0.12, size * 0.08]}>
        <sphereGeometry args={[1, 12, 6]} />
        <meshBasicMaterial color="#fff7db" />
      </mesh>
    </group>
  )
}

function FretButton({ point, lane, active }: { point: Point; lane: number; active: boolean }) {
  const color = LANE_COLORS[lane]
  const size = active ? 0.36 : 0.31
  return (
    <group position={[point.x, point.y, 0.7]}>
      <mesh scale={[size * 1.18, size * 0.62, size * 0.28]}>
        <sphereGeometry args={[1, 24, 12]} />
        <meshStandardMaterial
          color={active ? color : '#171412'}
          emissive={color}
          emissiveIntensity={active ? 1.25 : 0.3}
          metalness={0.5}
          roughness={0.25}
        />
      </mesh>
      <mesh scale={[size * 1.26, size * 0.68, 1]}>
        <torusGeometry args={[1, active ? 0.13 : 0.09, 8, 32]} />
        <meshBasicMaterial color={active ? '#fff5d8' : color} />
      </mesh>
    </group>
  )
}

function HighwayScene({ notes, currentTime, bpm, beatOffset, activeLanes }: HighwayProps) {
  const { width, height } = useThree((state) => state.viewport)
  const layout = useMemo<Layout>(() => {
    const topY = height / 2 - 0.48
    const hitY = -height / 2 + 0.64
    const topHalf = width * 0.13
    const bottomHalf = width / 2 - 0.22
    return {
      topY,
      hitY,
      topHalf,
      bottomHalf,
      point(lanePosition, progress) {
        const halfWidth = topHalf + (bottomHalf - topHalf) * progress
        return {
          x: ((lanePosition / 5) * 2 - 1) * halfWidth,
          y: topY + (hitY - topY) * progress,
        }
      },
    }
  }, [height, width])

  const nowMs = currentTime * 1_000
  const beatMs = bpm > 0 ? 60_000 / bpm : 500
  const firstBeat = Math.ceil((nowMs - beatOffset) / beatMs)
  const beats: { beat: number; progress: number }[] = []
  for (let beat = firstBeat; ; beat += 1) {
    const timeMs = beatOffset + beat * beatMs
    if (timeMs > nowMs + HIGHWAY_LOOK_AHEAD * 1_000) break
    const progress = highwayProgress(timeMs, currentTime)
    if (progress >= 0 && progress <= 1.04) beats.push({ beat, progress })
  }

  const visible = notes.filter(
    (note) => note.timeMs >= nowMs - 130 && note.timeMs <= nowMs + HIGHWAY_LOOK_AHEAD * 1_000,
  )

  return (
    <>
      <color attach="background" args={['#080303']} />
      <ambientLight intensity={1.35} />
      <directionalLight position={[-2, 5, 8]} intensity={2.3} color="#fff0d2" />
      <pointLight position={[0, layout.hitY, 3]} intensity={12} distance={8} color="#ff3b00" />

      <mesh position={[0, 0, -1]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#100504" />
      </mesh>
      <Road layout={layout} />

      {beats.map(({ beat, progress }) => (
        <Bar
          key={beat}
          from={layout.point(0, progress)}
          to={layout.point(5, progress)}
          color={beat % 4 === 0 ? '#8c2d18' : '#514b43'}
          thickness={beat % 4 === 0 ? 0.025 : 0.012}
          z={0.05}
          opacity={beat % 4 === 0 ? 0.9 : 0.58}
        />
      ))}

      {Array.from({ length: 6 }, (_, lane) => (
        <Bar
          key={lane}
          from={layout.point(lane, 0)}
          to={layout.point(lane, 1.04)}
          color={lane === 0 || lane === 5 ? '#81766a' : '#4c4842'}
          thickness={lane === 0 || lane === 5 ? 0.032 : 0.016}
          z={0.12}
        />
      ))}

      {visible.flatMap((note, noteIndex) =>
        note.lanes.map((lane) => {
          const progress = highwayProgress(note.timeMs, currentTime)
          const point = layout.point(lane + 0.5, progress)
          const size = highwayGemSize(progress)
          const endProgress = Math.max(0, highwayProgress(note.timeMs + note.durationMs, currentTime))
          const end = layout.point(lane + 0.5, endProgress)
          return (
            <group key={`${note.timeMs}-${lane}-${noteIndex}`}>
              {note.durationMs > 0 && (
                <Bar
                  from={point}
                  to={end}
                  color={LANE_COLORS[lane]}
                  thickness={size * 0.42}
                  z={0.3}
                  opacity={0.65}
                />
              )}
              <Gem point={point} size={size} lane={lane} accent={note.accent} />
            </group>
          )
        }),
      )}

      <Bar
        from={layout.point(0, 1)}
        to={layout.point(5, 1)}
        color="#fff0ce"
        thickness={0.045}
        z={0.4}
      />
      {LANE_COLORS.map((_, lane) => (
        <FretButton
          key={lane}
          point={layout.point(lane + 0.5, 1)}
          lane={lane}
          active={activeLanes[lane]}
        />
      ))}
    </>
  )
}

export function Highway(props: HighwayProps) {
  return (
    <div className="highway" role="img" aria-label="Five-lane chart preview synchronized to the song">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 10], zoom: 100, near: 0.1, far: 100 }}
        dpr={[1, 1.75]}
        frameloop="demand"
        gl={{ antialias: true, alpha: false }}
      >
        <HighwayScene {...props} />
      </Canvas>
      {props.notes.length === 0 && <span className="highway-empty">DROP A TRACK TO IGNITE THE HIGHWAY</span>}
    </div>
  )
}
