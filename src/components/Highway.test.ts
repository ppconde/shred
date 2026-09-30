import { describe, expect, it } from 'vitest'
import { fretHalfHeight, fretHalfWidth } from './Highway'

describe('highway fret spacing', () => {
  it('compresses dense gems vertically enough to leave visible travel space', () => {
    const travelHeight = 400
    const gapMs = 125
    const projectedGap = (gapMs / 1_000 / 4.2) * travelHeight

    expect(fretHalfHeight(20, gapMs, travelHeight) * 2).toBeLessThan(projectedGap)
  })

  it('keeps the full perspective size when note spacing is generous', () => {
    expect(fretHalfHeight(20, 1_000, 400)).toBeCloseTo(20 * 0.62)
  })

  it('keeps neighboring lane gems separate on a narrow highway', () => {
    expect(fretHalfWidth(20, 45) * 2).toBeLessThan(45)
  })
})
