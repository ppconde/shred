import { describe, expect, it } from 'vitest'
import { highwayGemSize, highwayProgress } from './highwayMath'

describe('highway projection', () => {
  it('moves equal time intervals by equal screen-space steps', () => {
    const positions = [3_000, 2_500, 2_000].map((time) => highwayProgress(time, 0))
    expect(positions[1] - positions[0]).toBeCloseTo(positions[2] - positions[1], 8)
  })

  it('grows gems as they approach the hit line', () => {
    expect(highwayGemSize(1)).toBeGreaterThan(highwayGemSize(0.5))
    expect(highwayGemSize(0.5)).toBeGreaterThan(highwayGemSize(0))
  })
})
