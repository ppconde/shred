import { useEffect, useState, type RefObject } from 'react'
import { DIFFICULTIES, type Difficulty } from '../domain/chart'

const LANE_KEYS: Record<string, number> = { KeyA: 0, KeyS: 1, KeyJ: 2, KeyK: 3, KeyL: 4 }

interface PreviewKeyboardOptions {
  audioRef: RefObject<HTMLAudioElement | null>
  onToggle(): void | Promise<void>
  onRestart(): void
  onSeek(time: number): void
  onDifficulty(difficulty: Difficulty): void
}

export function usePreviewKeyboard({
  audioRef,
  onToggle,
  onRestart,
  onSeek,
  onDifficulty,
}: PreviewKeyboardOptions) {
  const [activeLanes, setActiveLanes] = useState([false, false, false, false, false])

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
      if (updateLane(event.code, true) || event.repeat) return

      if (event.code === 'Space') {
        event.preventDefault()
        void onToggle()
      } else if (event.code === 'KeyR') {
        onRestart()
      } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault()
        onSeek((audioRef.current?.currentTime ?? 0) + (event.code === 'ArrowLeft' ? -5 : 5))
      } else if (/^Digit[1-4]$/.test(event.code)) {
        onDifficulty(DIFFICULTIES[Number(event.code.at(-1)) - 1])
      }
    }
    const keyUp = (event: KeyboardEvent) => updateLane(event.code, false)

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [audioRef, onDifficulty, onRestart, onSeek, onToggle])

  return activeLanes
}
