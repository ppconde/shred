export const HIGHWAY_LOOK_AHEAD = 4.2

export const highwayProgress = (noteTimeMs: number, currentTime: number) =>
  1 - (noteTimeMs / 1_000 - currentTime) / HIGHWAY_LOOK_AHEAD

export const highwayGemSize = (progress: number) =>
  0.1 + Math.min(1.08, Math.max(0, progress)) * 0.17
