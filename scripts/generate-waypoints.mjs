// Analyzes the delivered board art to produce a playable (not pixel-perfect) BoardDefinition
// per variant: real yard positions detected from the image, a track loop scaled/angled to match
// those real positions, and game-logic-correct entry/home-entrance indices. This exists to get
// pieces on the board immediately; for exact hand-traced alignment, use the in-app #editor tool.
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const BOARDS = {
  2: ['Red', 'Blue'],
  3: ['Red', 'Blue', 'Gold'],
  4: ['Red', 'Gold', 'Green', 'Blue'],
  5: ['Blue', 'Gold', 'Purple', 'Green', 'Red'],
  6: ['Gold', 'Blue', 'Purple', 'Orange', 'Green', 'Red'],
}

// Hue ranges (degrees) for each lane color family, tuned against the delivered art.
const HUE_RANGES = {
  Red: [[350, 360], [0, 12]],
  Orange: [[18, 38]],
  Gold: [[42, 62]],
  Green: [[95, 150]],
  Blue: [[195, 228]],
  Purple: [[255, 288]],
}

const SIZE = 320 // analysis resolution
const MARGIN = 0.08 // fraction of image trimmed on each side to skip the ornate frame
const ARM_STEPS = 6 // corridor waypoints per lane
const SQUARES_PER_ARM = 21 // target track squares per lane after resampling (counted directly from board_4p.jpg art)

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  const v = max
  return [h, s, v]
}

function matchesColor(h, s, v, color) {
  if (s < 0.35 || v < 0.22) return false
  return HUE_RANGES[color].some(([lo, hi]) => h >= lo && h <= hi)
}

async function loadPixels(imagePath, size = SIZE) {
  const { data, info } = await sharp(imagePath)
    .resize(size, size, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

function inBounds(x, y, w, h) {
  return x >= w * MARGIN && x <= w * (1 - MARGIN) && y >= h * MARGIN && y <= h * (1 - MARGIN)
}

// Finds each lane color's yard circle center via a density search: the yard is a filled disc,
// so the pixel with the most same-color neighbors within a small radius is its center.
function findYardCenter(pixels, color) {
  const { data, width, height, channels } = pixels
  const radius = Math.round(width * 0.06)
  const step = 4
  let best = { x: 0, y: 0, count: -1 }

  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels
      const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
      if (inBounds(x, y, width, height) && matchesColor(h, s, v, color)) mask[y * width + x] = 1
    }
  }

  // The board's central hub (a small pinwheel showing each color's final square) can be almost
  // as large as a real yard on some boards. No yard is ever legitimately near dead-center, so
  // exclude candidates there rather than risk the hub winning the density search.
  const centerExclusionRadius = width * 0.16

  for (let cy = radius; cy < height - radius; cy += step) {
    for (let cx = radius; cx < width - radius; cx += step) {
      if (Math.hypot(cx - width / 2, cy - height / 2) < centerExclusionRadius) continue
      let count = 0
      for (let dy = -radius; dy <= radius; dy += 2) {
        for (let dx = -radius; dx <= radius; dx += 2) {
          if (dx * dx + dy * dy > radius * radius) continue
          if (mask[(cy + dy) * width + (cx + dx)]) count++
        }
      }
      if (count > best.count) best = { x: cx, y: cy, count }
    }
  }

  return { x: best.x / width, y: best.y / height, found: best.count > 20 }
}

// Each yard has 4 pip holes painted inside the colored disc, each outlined with a gold ring (the
// holes themselves are just a slightly different shade of the yard's own color - the gold ring is
// the actually-distinctive feature). The yard's own outer boundary is ALSO a gold ring, so the
// search excludes an outer band near the yard's edge to avoid picking that up as a "hole". Uses a
// higher-resolution pixel buffer than the rest of the pipeline since these rings are thin enough
// to wash out at the main analysis resolution.
function findYardHoles(pixels, yardCenter, yardRadiusNorm) {
  const { data, width, height, channels } = pixels
  const searchR = yardRadiusNorm * 1.5 // generous - tolerates yardCenter being an imperfect estimate
  const innerHoleBand = yardRadiusNorm * 0.82 // exclude the yard's own outer boundary ring
  const minX = Math.max(0, Math.floor((yardCenter.x - searchR) * width))
  const maxX = Math.min(width - 1, Math.ceil((yardCenter.x + searchR) * width))
  const minY = Math.max(0, Math.floor((yardCenter.y - searchR) * height))
  const maxY = Math.min(height - 1, Math.ceil((yardCenter.y + searchR) * height))

  const candidateSet = new Set()
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const nx = x / width
      const ny = y / height
      const dist = Math.hypot(nx - yardCenter.x, ny - yardCenter.y)
      if (dist > searchR || dist > innerHoleBand) continue
      const idx = (y * width + x) * channels
      const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
      if (matchesColor(h, s, v, 'Gold')) candidateSet.add(`${x},${y}`)
    }
  }

  if (candidateSet.size < 8) return [] // not enough signal - caller falls back to a synthetic grid

  const visited = new Set()
  const blobs = []
  for (const key of candidateSet) {
    if (visited.has(key)) continue
    const [sx, sy] = key.split(',').map(Number)
    const stack = [[sx, sy]]
    visited.add(key)
    const pixelsInBlob = []
    while (stack.length) {
      const [x, y] = stack.pop()
      pixelsInBlob.push([x, y])
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const nk = `${x + dx},${y + dy}`
        if (candidateSet.has(nk) && !visited.has(nk)) {
          visited.add(nk)
          stack.push([x + dx, y + dy])
        }
      }
    }
    blobs.push(pixelsInBlob)
  }

  // On gold-colored yards, the yard's own fill/border is the same hue as the hole rings, so a
  // patch of ordinary fill can get picked up as a "blob" too. Distinguish by shape, not just size:
  // a thin ring has low fill relative to its bounding box (mostly hollow), while a contamination
  // patch from solid fill is much more filled-in - reject anything too solid to be a ring.
  const minBlobSize = 3
  const maxFillRatio = 0.5
  let candidates = blobs.filter((b) => b.length >= minBlobSize).filter((b) => {
    const xs = b.map(([x]) => x)
    const ys = b.map(([, y]) => y)
    const boxArea = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1)
    return b.length / boxArea <= maxFillRatio
  })

  // A single ring can end up as two (or more) disconnected blobs if anti-aliasing or a small
  // decorative mark breaks its connectivity for a pixel or two - counted separately, that falsely
  // consumes two of the four "top" slots for what's really one hole, silently dropping a real one.
  // Merge blobs whose centroids are suspiciously close before ranking by size.
  const mergeDistPx = width * 0.03
  const centroidOf = (b) => [b.reduce((s, [x]) => s + x, 0) / b.length, b.reduce((s, [, y]) => s + y, 0) / b.length]
  let mergedSomething = true
  while (mergedSomething) {
    mergedSomething = false
    outer: for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const [ax, ay] = centroidOf(candidates[i])
        const [bx, by] = centroidOf(candidates[j])
        if (Math.hypot(ax - bx, ay - by) < mergeDistPx) {
          candidates[i] = candidates[i].concat(candidates[j])
          candidates.splice(j, 1)
          mergedSomething = true
          break outer
        }
      }
    }
  }
  candidates.sort((a, b) => b.length - a.length)

  if (process.env.DEBUG_HOLES) {
    for (const b of candidates) {
      const cx = b.reduce((s, [x]) => s + x, 0) / b.length
      const cy = b.reduce((s, [, y]) => s + y, 0) / b.length
      const xs = b.map(([x]) => x)
      const ys = b.map(([, y]) => y)
      const boxArea = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1)
      console.error(`    blob size=${b.length} fill=${(b.length / boxArea).toFixed(2)} centroid_norm=(${(cx / width).toFixed(4)},${(cy / height).toFixed(4)})`)
    }
  }

  const holes = candidates.slice(0, 4).map((blob) => {
    const cx = blob.reduce((s, [x]) => s + x, 0) / blob.length
    const cy = blob.reduce((s, [, y]) => s + y, 0) / blob.length
    return point(cx / width, cy / height)
  })

  return holes
}

// The track band sits well outside the yards, near the board edges. Measure its real radius by
// finding the farthest any-lane-color pixel from the hub center (excluding the yard discs
// themselves and the decorative frame).
function findTrackOuterRadius(pixels, laneColors, cx, cy, yardCenters, yardRadiusNorm) {
  const { data, width, height, channels } = pixels
  let maxDist = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inBounds(x, y, width, height)) continue
      const idx = (y * width + x) * channels
      const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
      const nx = x / width
      const ny = y / height

      const isYardPixel = yardCenters.some((yc) => Math.hypot(nx - yc.x, ny - yc.y) < yardRadiusNorm * 1.4)
      if (isYardPixel) continue

      const matches = laneColors.some((color) => matchesColor(h, s, v, color))
      if (!matches) continue

      const dist = Math.hypot(nx - cx, ny - cy)
      if (dist > maxDist) maxDist = dist
    }
  }

  return maxDist
}

function point(x, y) {
  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  return [Math.round(clamp01(x) * 1000) / 1000, Math.round(clamp01(y) * 1000) / 1000]
}

function angularDist(a, b) {
  let d = Math.abs(a - b) % (2 * Math.PI)
  if (d > Math.PI) d = 2 * Math.PI - d
  return d
}

// Given 3 of a yard's 4 pip holes (arranged as two perpendicular diameters through a shared
// center - true on every board observed), estimate the missing 4th. Naively assuming the mean of
// all 4 equals the (imperfectly-estimated) yard center amplifies that estimate's own error 4x,
// which can push the guess outside the yard entirely. Instead, find which 2 of the 3 real points
// are the opposite pair (their midpoint should be the true center) by checking which pairing's
// implied center best matches the rough yard-center estimate, then reflect the third point
// through that. Falls back to the naive approach only if the result would land implausibly far
// from the yard (a sign the pairing search failed), rather than risk a wild guess.
function estimateFourthHole(threeHoles, roughCenter, yardRadiusNorm) {
  const pairings = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 2, 0],
  ]
  let best = null
  for (const [i, j, k] of pairings) {
    const [ax, ay] = threeHoles[i]
    const [bx, by] = threeHoles[j]
    const centerCandidate = [(ax + bx) / 2, (ay + by) / 2]
    const distToRough = Math.hypot(centerCandidate[0] - roughCenter.x, centerCandidate[1] - roughCenter.y)
    if (!best || distToRough < best.distToRough) {
      const [kx, ky] = threeHoles[k]
      const fourth = [2 * centerCandidate[0] - kx, 2 * centerCandidate[1] - ky]
      best = { distToRough, fourth }
    }
  }

  const distFromCenter = Math.hypot(best.fourth[0] - roughCenter.x, best.fourth[1] - roughCenter.y)
  if (distFromCenter > yardRadiusNorm * 1.1) {
    // Pairing search still landed outside the yard - safer to sit near the center than guess wildly.
    return point(roughCenter.x, roughCenter.y)
  }
  return point(best.fourth[0], best.fourth[1])
}

// A smooth radius(theta) curve can only represent shapes that are star-convex around one center.
// The 2p/3p boards loop back on themselves and are NOT star-convex, so that approach silently
// produces a "loop" where consecutive indices aren't actually adjacent on the real path - a piece
// moving 2 or 5 steps would visually jump to the wrong place. This traces the actual track pixels
// instead: build a mask of ring pixels (any lane color, excluding yard discs and the radial
// corridor spikes), collapse it to a coarse grid of representative points, then walk it via
// greedy nearest-neighbor so consecutive output points are guaranteed to be physically adjacent.
function traceRingLoop(pixels, laneColors, yardCenters, cx, cy, trackOuterRadius, yardRadiusNorm) {
  const { data, width, height, channels } = pixels
  const coneHalfWidth = 0.22 // radians, ~12.6deg - excludes each lane's radial corridor spike
  const corridorInnerCutoff = trackOuterRadius * 0.72

  const laneAngles = yardCenters.map((yc) => {
    const a = Math.atan2(yc.y - cy, yc.x - cx)
    return a < 0 ? a + 2 * Math.PI : a
  })

  const ringPoints = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inBounds(x, y, width, height)) continue
      const idx = (y * width + x) * channels
      const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
      if (!laneColors.some((color) => matchesColor(h, s, v, color))) continue

      const nx = x / width
      const ny = y / height

      if (yardCenters.some((yc) => Math.hypot(nx - yc.x, ny - yc.y) < yardRadiusNorm * 1.4)) continue

      const angle = Math.atan2(ny - cy, nx - cx)
      const angleNorm = angle < 0 ? angle + 2 * Math.PI : angle
      const radius = Math.hypot(nx - cx, ny - cy)

      // The ring never actually passes through the dead-center hub - only corridor spikes do.
      // Without this, different lobes' corridor bases can sit close enough near the hub for the
      // walk to "shortcut" across from one lobe straight to another, badly scrambling order.
      if (radius < trackOuterRadius * 0.32) continue

      const inACorridorSpike =
        radius < corridorInnerCutoff && laneAngles.some((a) => angularDist(angleNorm, a) < coneHalfWidth)
      if (inACorridorSpike) continue

      ringPoints.push([nx, ny])
    }
  }

  // Collapse to a coarse grid (~ band thickness) so the walk follows the centerline instead of
  // zigzagging across the band's width, and so gaps from anti-aliasing don't fragment it.
  const cellSize = 0.028
  const cells = new Map()
  for (const [x, y] of ringPoints) {
    const key = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push([x, y])
  }
  const allGridPoints = [...cells.values()].map((pts) => [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ])

  if (allGridPoints.length < 8) return [] // not enough signal to trace - caller falls back

  const maxJump = cellSize * 3.2

  // The first-encountered point (raster scan order) can be an isolated stray/noise cell far from
  // the real ring, which would kill the walk after one step. Keep only the largest connected
  // component (by maxJump adjacency) so a stray blob elsewhere can't derail tracing.
  const componentId = new Array(allGridPoints.length).fill(-1)
  let largestComponent = []
  for (let start = 0; start < allGridPoints.length; start++) {
    if (componentId[start] !== -1) continue
    const stack = [start]
    componentId[start] = start
    const component = []
    while (stack.length) {
      const i = stack.pop()
      component.push(i)
      for (let j = 0; j < allGridPoints.length; j++) {
        if (componentId[j] !== -1) continue
        const d = Math.hypot(allGridPoints[j][0] - allGridPoints[i][0], allGridPoints[j][1] - allGridPoints[i][1])
        if (d <= maxJump) {
          componentId[j] = start
          stack.push(j)
        }
      }
    }
    if (component.length > largestComponent.length) largestComponent = component
  }

  const gridPoints = largestComponent.map((i) => allGridPoints[i])
  if (gridPoints.length < 8) return []

  // Greedy nearest-neighbor alone can "jump across" to a nearby parallel strand where the band
  // passes close to itself (e.g. the pinch points between lobes on a clover-shaped board),
  // scrambling path order. Bias it to prefer continuing in roughly the same heading as the
  // previous step, so it follows the band it's already on instead of hopping to a neighboring one.
  const visited = new Array(gridPoints.length).fill(false)
  let currentIdx = 0
  visited[0] = true
  const path = [gridPoints[0]]
  let prevDir = null
  const turnWeight = 3

  while (path.length < gridPoints.length) {
    const [cx2, cy2] = gridPoints[currentIdx]
    let bestIdx = -1
    let bestScore = Infinity
    let bestDist = Infinity
    for (let i = 0; i < gridPoints.length; i++) {
      if (visited[i]) continue
      const dx = gridPoints[i][0] - cx2
      const dy = gridPoints[i][1] - cy2
      const d = Math.hypot(dx, dy)
      if (d > maxJump || d === 0) continue

      let turnCost = 0
      if (prevDir) {
        const dirX = dx / d
        const dirY = dy / d
        turnCost = 1 - (dirX * prevDir[0] + dirY * prevDir[1]) // 0 = straight ahead, 2 = reversal
      }
      const score = d * (1 + turnWeight * turnCost)
      if (score < bestScore) {
        bestScore = score
        bestDist = d
        bestIdx = i
      }
    }
    if (bestIdx === -1) break // loop closed (or trail broke) - stop rather than teleport

    const newDir = [(gridPoints[bestIdx][0] - cx2) / bestDist, (gridPoints[bestIdx][1] - cy2) / bestDist]
    prevDir = prevDir ? [(prevDir[0] + newDir[0]) / 2, (prevDir[1] + newDir[1]) / 2] : newDir
    const mag = Math.hypot(prevDir[0], prevDir[1]) || 1
    prevDir = [prevDir[0] / mag, prevDir[1] / mag]

    visited[bestIdx] = true
    path.push(gridPoints[bestIdx])
    currentIdx = bestIdx
  }

  // The walk consumes every point in the component, but nothing forces it to end back next to
  // where it started - leftover band-width pixels can get swept up last, out of true path order,
  // leaving a long "seam" back to the start. Since this is a closed loop, cut the path as soon as
  // it genuinely returns near its start; whatever's left after that is that kind of stray tail.
  const closeSearchStart = Math.floor(path.length * 0.6)
  let closestIdx = -1
  let closestDist = Infinity
  for (let i = closeSearchStart; i < path.length; i++) {
    const d = Math.hypot(path[i][0] - path[0][0], path[i][1] - path[0][1])
    if (d < closestDist) {
      closestDist = d
      closestIdx = i
    }
  }
  if (closestIdx !== -1) return path.slice(0, closestIdx + 1)

  return path
}

// Alternative to the walk: for star-convex boards (one ring crossing per angle from the hub -
// true for the more regular/symmetric layouts), sample the REAL pixel data at each angle instead
// of a guessed formula. Ordering by angle guarantees correct adjacency by construction - no walk
// to get confused at tight pinch points - but it only works where the shape really is star-convex.
// Sample along rays from the hub at each angle, like before - but instead of averaging every
// matching pixel found anywhere along the ray (which lets the point snap between unrelated
// crossings when a ray grazes two features), group matches into contiguous "runs" - each run is
// one real crossing of the band - and track continuity: prefer whichever run continues nearest to
// the previous angle's radius. Without this, adjacent angle samples can jump between different
// crossings independently, producing a zigzag that cuts across empty background instead of
// following the printed curve, even though no single segment is a large enough outlier to fail
// the gap-ratio check.
function polarSampleRingLoop(pixels, laneColors, yardCenters, cx, cy, trackOuterRadius, yardRadiusNorm) {
  const { data, width, height, channels } = pixels
  const N = 360
  const rStart = trackOuterRadius * 0.34
  const rEnd = trackOuterRadius * 1.05
  const steps = 220
  const points = []
  let prevRadius = null

  for (let k = 0; k < N; k++) {
    const theta = (k / N) * 2 * Math.PI
    const runs = []
    let current = null

    for (let s = 0; s <= steps; s++) {
      const r = rStart + (rEnd - rStart) * (s / steps)
      const nx = cx + Math.cos(theta) * r
      const ny = cy + Math.sin(theta) * r

      let isMatch = false
      if (nx >= 0 && nx < 1 && ny >= 0 && ny < 1 && !yardCenters.some((yc) => Math.hypot(nx - yc.x, ny - yc.y) < yardRadiusNorm * 1.4)) {
        const x = Math.min(width - 1, Math.max(0, Math.round(nx * width)))
        const y = Math.min(height - 1, Math.max(0, Math.round(ny * height)))
        const idx = (y * width + x) * channels
        const [h, s2, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
        isMatch = laneColors.some((color) => matchesColor(h, s2, v, color))
      }

      if (isMatch) {
        if (!current) current = { rSum: 0, xSum: 0, ySum: 0, count: 0 }
        current.rSum += r
        current.xSum += nx
        current.ySum += ny
        current.count++
      } else if (current) {
        runs.push(current)
        current = null
      }
    }
    if (current) runs.push(current)
    if (runs.length === 0) continue

    const chosen =
      prevRadius === null
        ? runs.reduce((best, run) => (run.count > best.count ? run : best))
        : runs.reduce((best, run) => {
            const runAvg = run.rSum / run.count
            const bestAvg = best.rSum / best.count
            return Math.abs(runAvg - prevRadius) < Math.abs(bestAvg - prevRadius) ? run : best
          })

    prevRadius = chosen.rSum / chosen.count
    points.push([chosen.xSum / chosen.count, chosen.ySum / chosen.count])
  }

  return points
}

// Objective quality metric matching what tests/generatedBoards.test.ts checks: how much bigger is
// the worst consecutive (wrap-around included) gap than the average gap. Lower is better; a
// well-ordered loop should be close to 1.
function worstGapRatio(loopPoints) {
  if (loopPoints.length < 3) return Infinity
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const gaps = loopPoints.map((p, i) => dist(p, loopPoints[(i + 1) % loopPoints.length]))
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length
  return Math.max(...gaps) / avg
}

// The traced loop has ~150-300 points (needed for accurate tracing), but the actual art only has
// roughly 50-90 hand-drawn squares. Left as-is, each game "step" (+1 array index) would only cover
// a tiny fraction of a real square - motion would be nearly invisible however pieces are rendered.
// Resample down to a realistic square count along the SAME already-correctly-ordered path (arc
// length parameterized), so a step visually covers a real square's worth of distance.
function resampleClosedLoop(points, targetCount) {
  const n = points.length
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const segLengths = points.map((p, i) => dist(p, points[(i + 1) % n]))
  const total = segLengths.reduce((s, d) => s + d, 0)

  const cumulative = [0]
  for (const d of segLengths) cumulative.push(cumulative[cumulative.length - 1] + d)

  const resampled = []
  for (let k = 0; k < targetCount; k++) {
    const targetDist = (k / targetCount) * total
    let segIdx = 0
    while (segIdx < n - 1 && cumulative[segIdx + 1] < targetDist) segIdx++
    const segStart = cumulative[segIdx]
    const segLen = segLengths[segIdx] || 1e-9
    const t = (targetDist - segStart) / segLen
    const a = points[segIdx]
    const b = points[(segIdx + 1) % n]
    resampled.push(point(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
  }
  return resampled
}

function buildBoardDefinition(playerCount, laneColors, yardCenters, trackOuterRadius, tracedLoop, log) {
  const cx = yardCenters.reduce((s, p) => s + p.x, 0) / yardCenters.length
  const cy = yardCenters.reduce((s, p) => s + p.y, 0) / yardCenters.length

  const withAngles = laneColors.map((color, i) => {
    const yard = yardCenters[i]
    const angle = Math.atan2(yard.y - cy, yard.x - cx)
    return { color, yard, angle: angle < 0 ? angle + 2 * Math.PI : angle }
  })

  const usingTrace = tracedLoop.length >= 8
  let trackWaypoints
  let getHomeEntranceIndex

  if (usingTrace) {
    trackWaypoints = tracedLoop.map(([x, y]) => point(x, y))
    // For each lane, the home entrance is wherever its corridor spike actually meets the traced
    // ring - i.e. the ring point nearest that lane's own yard angle.
    getHomeEntranceIndex = (lane) => {
      let bestIdx = 0
      let bestDist = Infinity
      trackWaypoints.forEach(([x, y], i) => {
        const angle = Math.atan2(y - cy, x - cx)
        const angleNorm = angle < 0 ? angle + 2 * Math.PI : angle
        const d = angularDist(angleNorm, lane.angle)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      })
      return bestIdx
    }
  } else {
    // Fallback for boards where tracing didn't find enough signal: same lobed approximation as
    // before. Known to get adjacency wrong on non-star-convex shapes, kept only as a last resort.
    log?.(`  [board_${playerCount}p] falling back to approximated (non-traced) loop - verify with #editor`)
    const outerR = trackOuterRadius * 0.88
    const innerR = trackOuterRadius * 0.42
    const sortedAngles = [...withAngles.map((l) => l.angle)].sort((a, b) => a - b)
    const gaps = sortedAngles.map((a, i) => angularDist(a, sortedAngles[(i + 1) % sortedAngles.length]))
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length
    const sigma = avgGap / 2.4
    const radiusAt = (theta) => {
      let bulge = 0
      for (const lane of withAngles) {
        const d = angularDist(theta, lane.angle)
        bulge = Math.max(bulge, Math.exp(-(d * d) / (2 * sigma * sigma)))
      }
      return innerR + (outerR - innerR) * bulge
    }
    const armLength = 12
    const trackLength = playerCount * armLength
    trackWaypoints = []
    for (let k = 0; k < trackLength; k++) {
      const theta = (k / trackLength) * 2 * Math.PI
      trackWaypoints.push(point(cx + Math.cos(theta) * radiusAt(theta), cy + Math.sin(theta) * radiusAt(theta)))
    }
    getHomeEntranceIndex = (lane) => {
      const sortedByAngle = [...withAngles].sort((a, b) => a.angle - b.angle)
      const rank = sortedByAngle.findIndex((l) => l.color === lane.color)
      const entry = Math.round((rank / playerCount) * trackLength)
      return (entry - 1 + trackLength) % trackLength
    }
  }

  const trackLength = trackWaypoints.length

  const playerLanes = withAngles.map((lane) => {
    const homeEntranceTrackIndex = getHomeEntranceIndex(lane)
    const entryTrackIndex = (homeEntranceTrackIndex + 1) % trackLength
    const [ringJunctionX, ringJunctionY] = trackWaypoints[homeEntranceTrackIndex]

    // Prefer the actually-detected pip holes (see findYardHoles) so pieces sit in the real
    // painted slots. If exactly 3 were found, keep them and estimate the missing 4th rather than
    // discarding 3 good detections for an entirely synthetic grid - assuming the 4 holes average
    // out to the yard's center (true for every board observed), the 4th is whatever makes that
    // hold. Only fall back to a fully synthetic grid if detection found fewer than 3.
    const yardOffset = 0.028
    const detectedHoles = lane.yard.holes || []
    let yardWaypoints
    if (detectedHoles.length === 4) {
      yardWaypoints = detectedHoles
    } else if (detectedHoles.length === 3) {
      const fourth = estimateFourthHole(detectedHoles, lane.yard, 0.06)
      yardWaypoints = [...detectedHoles, fourth]
    } else {
      yardWaypoints = [
        point(lane.yard.x - yardOffset, lane.yard.y - yardOffset),
        point(lane.yard.x + yardOffset, lane.yard.y - yardOffset),
        point(lane.yard.x - yardOffset, lane.yard.y + yardOffset),
        point(lane.yard.x + yardOffset, lane.yard.y + yardOffset),
      ]
    }

    // Corridor spoke runs from where it actually meets the traced ring, inward to the hub, so
    // there's no visible gap between the last track square and the first corridor square.
    const homeCorridorWaypoints = []
    for (let i = 1; i <= ARM_STEPS; i++) {
      const t = i / (ARM_STEPS + 1) // 0 = at the ring junction, 1 = at hub center
      homeCorridorWaypoints.push(point(ringJunctionX + (cx - ringJunctionX) * t, ringJunctionY + (cy - ringJunctionY) * t))
    }

    return {
      color: lane.color,
      entryTrackIndex,
      homeEntranceTrackIndex,
      homeCorridorWaypoints,
      yardWaypoints,
    }
  })

  const safeTrackIndices = playerLanes.map((l) => l.entryTrackIndex)

  return {
    playerCount,
    boardImage: `/boards/board_${playerCount}p.jpg`,
    trackWaypoints,
    safeTrackIndices,
    playerLanes,
  }
}

async function main() {
  const definitions = {}
  for (const [countStr, laneColors] of Object.entries(BOARDS)) {
    const playerCount = Number(countStr)
    const imagePath = path.join(ROOT, 'public', 'boards', `board_${playerCount}p.jpg`)
    const pixels = await loadPixels(imagePath)
    const hiResPixels = await loadPixels(imagePath, 900) // gold hole-ring outlines are too thin to survive downsampling to SIZE

    const yardCenters = []
    for (const color of laneColors) {
      const center = findYardCenter(pixels, color)
      if (!center.found) {
        console.warn(`[board_${playerCount}p] weak/no yard match for ${color} - using fallback position`)
      }
      if (process.env.DEBUG_HOLES) console.error(`  ${playerCount}p ${color}:`)
      const holes = findYardHoles(hiResPixels, center, 0.06)
      if (holes.length === 3) {
        console.warn(`  [board_${playerCount}p] ${color} yard: found 3/4 pip holes - estimating the 4th`)
      } else if (holes.length < 3) {
        console.warn(`  [board_${playerCount}p] ${color} yard: only found ${holes.length}/4 pip holes - using synthetic grid`)
      }
      center.holes = holes
      yardCenters.push(center)
    }

    const hubX = yardCenters.reduce((s, p) => s + p.x, 0) / yardCenters.length
    const hubY = yardCenters.reduce((s, p) => s + p.y, 0) / yardCenters.length
    const trackOuterRadius = findTrackOuterRadius(pixels, laneColors, hubX, hubY, yardCenters, 0.06)

    // Two different tracing strategies, each with a different failure mode: the walk can get
    // confused at tight pinch points but handles non-star-convex shapes; polar sampling can't
    // represent a shape that loops back on itself but never gets confused on one that doesn't.
    // Score both against the same adjacency metric the tests check - but a trace that gives up
    // early (only covers a small arc) can look great on gap-ratio alone while missing most of the
    // board, so also penalize whichever candidate covers noticeably less ground than the other.
    const walked = traceRingLoop(pixels, laneColors, yardCenters, hubX, hubY, trackOuterRadius, 0.06)
    const polar = polarSampleRingLoop(pixels, laneColors, yardCenters, hubX, hubY, trackOuterRadius, 0.06)
    const maxLen = Math.max(walked.length, polar.length, 1)
    const effectiveScore = (candidate) =>
      candidate.length === 0 ? Infinity : worstGapRatio(candidate) * Math.max(1, maxLen / candidate.length)
    const walkedScore = effectiveScore(walked)
    const polarScore = effectiveScore(polar)
    let tracedLoop = walkedScore <= polarScore ? walked : polar

    console.log(
      `board_${playerCount}p: yards ->`,
      yardCenters.map((c) => `(${c.x.toFixed(2)},${c.y.toFixed(2)})`).join(' '),
      `trackOuterRadius=${trackOuterRadius.toFixed(2)}`,
      `walked=${walked.length}pts/${walkedScore.toFixed(2)} polar=${polar.length}pts/${polarScore.toFixed(2)}`,
      `-> using ${walkedScore <= polarScore ? 'walked' : 'polar'}`,
    )

    if (tracedLoop.length >= 8) {
      const targetCount = playerCount * SQUARES_PER_ARM
      tracedLoop = resampleClosedLoop(tracedLoop, targetCount)
      console.log(`  resampled to ${targetCount} squares (${SQUARES_PER_ARM} per arm)`)
    }

    definitions[playerCount] = buildBoardDefinition(playerCount, laneColors, yardCenters, trackOuterRadius, tracedLoop, console.warn)
  }

  writeFileSync(path.join(ROOT, 'src', 'data', 'generated-boards.json'), JSON.stringify(definitions, null, 2))
  console.log('Wrote src/data/generated-boards.json')
}

main()
