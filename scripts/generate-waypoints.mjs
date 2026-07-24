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
// Known-bad case: on the 5-player board, Gold's yard density search locks onto the connector
// strip joining the yard to the shared track instead of the yard disc itself - the connector is
// solid-colored and locally denser than the yard's own radially-gradient-shaded fill, so no
// density-based heuristic tried (an absolute ratio threshold, then a relative comparison against
// nearby and against whole-image candidates) discriminated the two reliably without also breaking
// other, already-correct yards. Measured directly from the art instead of guessed: crop
// public/boards/board_5p.jpg to roughly (0.55-0.85, 0.12-0.42) normalized to see the true yard
// circle in isolation from the connector, and read its center off the crop.
const YARD_CENTER_OVERRIDES = {
  '5-Gold': { x: 0.655, y: 0.243 },
  '6-Gold': { x: 0.494, y: 0.218 },
}

function findYardCenter(pixels, color, playerCount) {
  const { data, width, height, channels } = pixels
  const innerRadius = Math.round(width * 0.06)
  const step = 4

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

  const override = YARD_CENTER_OVERRIDES[`${playerCount}-${color}`]
  if (override) {
    const cx = Math.round(override.x * width)
    const cy = Math.round(override.y * height)
    let count = 0
    for (let dy = -innerRadius; dy <= innerRadius; dy += 2) {
      for (let dx = -innerRadius; dx <= innerRadius; dx += 2) {
        if (dx * dx + dy * dy > innerRadius * innerRadius) continue
        if (mask[(cy + dy) * width + (cx + dx)]) count++
      }
    }
    return { x: override.x, y: override.y, found: count > 20 }
  }

  // A raw density search alone can lock onto a home-corridor spoke instead of the yard disc: a
  // corridor is solid-colored and, sampled at any point along its length, can be just as dense
  // within innerRadius as the real yard. Distinguish them by shape: a yard is an isolated round
  // blob, so pixels quickly thin out just past its own radius in every direction; a corridor
  // keeps going, so an annulus further out is still substantially filled. Reject candidates whose
  // outer annulus is too full to be a real yard.
  function outerAnnulusFraction(cx, cy) {
    const rIn = innerRadius * 1.3
    const rOut = innerRadius * 2.5
    let total = 0
    let matched = 0
    for (let dy = -rOut; dy <= rOut; dy += 3) {
      for (let dx = -rOut; dx <= rOut; dx += 3) {
        const d2 = dx * dx + dy * dy
        if (d2 > rOut * rOut || d2 < rIn * rIn) continue
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        total++
        if (mask[y * width + x]) matched++
      }
    }
    return total === 0 ? 0 : matched / total
  }

  // Best raw count within innerRadius wins, among candidates that pass the shape check.
  // Correctly finds 20 of 21 yards across every board.
  let best = { x: 0, y: 0, count: -1 }
  for (let cy = innerRadius; cy < height - innerRadius; cy += step) {
    for (let cx = innerRadius; cx < width - innerRadius; cx += step) {
      if (Math.hypot(cx - width / 2, cy - height / 2) < centerExclusionRadius) continue
      let count = 0
      for (let dy = -innerRadius; dy <= innerRadius; dy += 2) {
        for (let dx = -innerRadius; dx <= innerRadius; dx += 2) {
          if (dx * dx + dy * dy > innerRadius * innerRadius) continue
          if (mask[(cy + dy) * width + (cx + dx)]) count++
        }
      }
      if (count <= best.count) continue
      if (count > 20 && outerAnnulusFraction(cx, cy) > 0.4) continue // looks like a corridor/connector, not an isolated yard
      best = { x: cx, y: cy, count }
    }
  }

  return { x: best.x / width, y: best.y / height, found: best.count > 20 }
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Each yard has 4 pip holes painted inside the colored disc, arranged with 4-fold rotational
// symmetry around the yard's own center (true on every board observed), each outlined with a gold
// ring. Treating each ring as an independent blob is fragile - anti-aliasing or a small art detail
// can break a single ring into multiple disconnected fragments, which get miscounted as separate
// holes and silently drop a real one. Instead, pool every matching pixel from all 4 holes together
// and fit the symmetric pattern directly as one measurement: a robust center, a common radius, and
// one shared rotational offset. That's immune to any individual ring being fragmentary, and
// mathematically guarantees the 4 results are exactly evenly spaced with no possibility of
// overlap - it's a fit, not a per-hole guess. Uses a higher-resolution pixel buffer than the rest
// of the pipeline since these rings are thin enough to wash out at the main analysis resolution.
function findYardHoles(pixels, yardCenter, yardRadiusNorm) {
  const { data, width, height, channels } = pixels
  const searchR = yardRadiusNorm * 1.5 // generous - tolerates yardCenter being an imperfect estimate
  const innerHoleBand = yardRadiusNorm * 0.82 // exclude the yard's own outer boundary ring
  const minX = Math.max(0, Math.floor((yardCenter.x - searchR) * width))
  const maxX = Math.min(width - 1, Math.ceil((yardCenter.x + searchR) * width))
  const minY = Math.max(0, Math.floor((yardCenter.y - searchR) * height))
  const maxY = Math.min(height - 1, Math.ceil((yardCenter.y + searchR) * height))

  const pts = []
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const nx = x / width
      const ny = y / height
      const dist = Math.hypot(nx - yardCenter.x, ny - yardCenter.y)
      if (dist > searchR || dist > innerHoleBand) continue
      const idx = (y * width + x) * channels
      const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
      if (matchesColor(h, s, v, 'Gold')) pts.push([nx, ny])
    }
  }

  if (pts.length < 20) return null // not enough signal - caller falls back to a synthetic grid

  // Pass 1: rough center/radius from every matching pixel.
  let center = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
  let radii = pts.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]))
  const roughRadius = median(radii)

  // Pass 2: drop anything far from the typical ring radius (stray marks, hub-adjacent noise,
  // boundary leakage), then refit a tighter center/radius from the cleaned set.
  const kept = pts.filter((_, i) => radii[i] > roughRadius * 0.5 && radii[i] < roughRadius * 1.6)
  if (kept.length < 12) return null
  center = [kept.reduce((s, p) => s + p[0], 0) / kept.length, kept.reduce((s, p) => s + p[1], 0) / kept.length]
  radii = kept.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]))
  const radius = median(radii)

  // Fit the shared rotational offset of the 4-fold pattern via a circular mean at 4x frequency -
  // the standard trick for finding the dominant orientation of n-fold symmetric point data.
  const angles = kept.map((p) => Math.atan2(p[1] - center[1], p[0] - center[0]))
  const sumSin = angles.reduce((s, a) => s + Math.sin(4 * a), 0)
  const sumCos = angles.reduce((s, a) => s + Math.cos(4 * a), 0)
  const offset = Math.atan2(sumSin, sumCos) / 4

  const slotCenters = [0, 1, 2, 3].map((k) => {
    const a = offset + (k * Math.PI) / 2
    return [center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]
  })

  // Each individual hole's own radius (for sizing pieces): average distance from points to
  // whichever of the 4 fitted slot centers they're nearest to.
  const perSlotDistances = [[], [], [], []]
  for (const p of kept) {
    let bestK = 0
    let bestD = Infinity
    for (let k = 0; k < 4; k++) {
      const d = Math.hypot(p[0] - slotCenters[k][0], p[1] - slotCenters[k][1])
      if (d < bestD) {
        bestD = d
        bestK = k
      }
    }
    perSlotDistances[bestK].push(bestD)
  }
  // center, radius, and perSlotDistances are already in normalized [0..1] units (pts was built
  // from nx/ny, not raw pixel coordinates) - no further division by width/height needed here.
  const holeRadiusNorm = median(perSlotDistances.flat())

  if (process.env.DEBUG_HOLES) {
    console.error(
      `    fitted center_norm=(${center[0].toFixed(4)},${center[1].toFixed(4)}) radius_norm=${radius.toFixed(4)} offsetDeg=${((offset * 180) / Math.PI).toFixed(1)} holeRadiusNorm=${holeRadiusNorm.toFixed(4)} points=${kept.length}/${pts.length}`,
    )
  }

  return { holes: slotCenters.map(([x, y]) => point(x, y)), holeRadiusNorm }
}

// Each lane's own 4-pointed gold star icon marks exactly which square is its entry point onto the
// shared track - the board art itself says so, so use it directly instead of assuming entry is
// "whatever square is next to home-entrance" (a guess that isn't always true - the two are
// generally different physical spokes: a short yard connector vs. the long home-stretch corridor).
// The star is a small, roughly square/compact, moderately concave (its points leave gaps) gold
// blob - unlike a track divider (a thin strip) or a yard's pip-hole ring (which sits inside the
// yard, filtered out by requiring the candidate be well outside the yard's own radius). It's also
// reliably positioned "outward" from the hub through the yard, which discriminates it from the
// hub's own center decoration and from other lanes' stars caught in the same search window.
function findEntryStar(hiResPixels, yardCenter, hubX, hubY, yardRadiusNorm) {
  const { data, width, height, channels } = hiResPixels
  function isGoldAt(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const idx = (y * width + x) * channels
    const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
    return isGoldDivider(h, s, v)
  }

  const searchR = Math.round(yardRadiusNorm * 3.7 * width)
  const cx = Math.round(yardCenter.x * width)
  const cy = Math.round(yardCenter.y * height)
  const minX = Math.max(0, cx - searchR), maxX = Math.min(width - 1, cx + searchR)
  const minY = Math.max(0, cy - searchR), maxY = Math.min(height - 1, cy + searchR)

  const mask = new Uint8Array(width * height)
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (isGoldAt(x, y)) mask[y * width + x] = 1
    }
  }

  const labels = new Int32Array(width * height).fill(-1)
  const comps = []
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const start = y * width + x
      if (mask[start] === 0 || labels[start] !== -1) continue
      const compId = comps.length
      const stack = [start]
      labels[start] = compId
      let minCX = x, maxCX = x, minCY = y, maxCY = y, count = 0
      while (stack.length) {
        const p = stack.pop()
        const px = p % width
        const py = Math.floor(p / width)
        count++
        minCX = Math.min(minCX, px); maxCX = Math.max(maxCX, px)
        minCY = Math.min(minCY, py); maxCY = Math.max(maxCY, py)
        for (const n of [p - 1, p + 1, p - width, p + width]) {
          if (n < 0 || n >= width * height) continue
          if (Math.abs((n % width) - px) > 1) continue
          if (mask[n] === 1 && labels[n] === -1) {
            labels[n] = compId
            stack.push(n)
          }
        }
      }
      comps.push({ minCX, maxCX, minCY, maxCY, count })
    }
  }

  const outX = yardCenter.x - hubX
  const outY = yardCenter.y - hubY
  const outMag = Math.hypot(outX, outY) || 1

  const candidates = comps
    .map((c) => {
      const bw = c.maxCX - c.minCX + 1
      const bh = c.maxCY - c.minCY + 1
      const cxNorm = (c.minCX + c.maxCX) / 2 / width
      const cyNorm = (c.minCY + c.maxCY) / 2 / height
      return { count: c.count, bw, bh, fillRatio: c.count / (bw * bh), aspect: bw / bh, x: cxNorm, y: cyNorm }
    })
    .filter((c) => c.bw >= 8 && c.bw <= 60 && c.bh >= 8 && c.bh <= 60)
    .filter((c) => c.aspect > 0.55 && c.aspect < 1.8)
    .filter((c) => c.fillRatio > 0.22 && c.fillRatio < 0.75)
    .filter((c) => Math.hypot(c.x - yardCenter.x, c.y - yardCenter.y) > yardRadiusNorm * 1.6)
    .filter((c) => {
      const toX = c.x - yardCenter.x, toY = c.y - yardCenter.y
      const toMag = Math.hypot(toX, toY) || 1
      return (outX * toX + outY * toY) / (outMag * toMag) > 0.3
    })
    .sort((a, b) => b.count - a.count)

  return candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : null
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

function isGoldDivider(h, s, v) {
  return s >= 0.3 && v >= 0.3 && h >= 40 && h <= 64
}

// The traced loop (walked/polar) is dense enough to trace accurately but doesn't correspond 1:1
// to real drawn squares - arc-length resampling to a guessed count (the old approach) distributes
// points evenly along the CURVE, not evenly across real squares, so it undercounts wherever the
// art draws squares more densely than the curve's average (see generatedBoards.test.ts history).
// This instead walks the traced loop's own path (a reliable route/shape guide) at fine resolution
// and finds every real gold divider line it actually crosses, using the midpoint between
// consecutive crossings as that square's true center - i.e. it measures the real squares directly
// instead of estimating a count.
function extractRealSquares(hiResPixels, rawTrace, yardCenters, yardRadiusNorm) {
  const { data, width, height, channels } = hiResPixels
  function sampleGold(nx, ny) {
    const x = Math.max(0, Math.min(width - 1, Math.round(nx * (width - 1))))
    const y = Math.max(0, Math.min(height - 1, Math.round(ny * (height - 1))))
    const idx = (y * width + x) * channels
    const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
    return isGoldDivider(h, s, v)
  }

  const UPSAMPLE = 10
  const fine = []
  const n = rawTrace.length
  for (let i = 0; i < n; i++) {
    const a = rawTrace[i]
    const b = rawTrace[(i + 1) % n]
    for (let s = 0; s < UPSAMPLE; s++) {
      const t = s / UPSAMPLE
      fine.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  const total = fine.length
  // A straight chord between two valid (outside-yard) raw trace points can still cut through a
  // yard's excluded disc if the yard bulges between them - and a yard's own decorations (pip-hole
  // rings, outer border) are gold, so that chord would wrongly register real divider crossings
  // inside the yard. Force every fine sample inside any yard to read as "not gold" unconditionally.
  // A tighter radius here was tried (to stop swallowing real squares just outside the yard whose
  // chord passes nearby) but let the yard's own outer border ring leak through as false crossings
  // instead - visually worse (pieces landing inside a yard) than the coverage gap it was meant to
  // fix, so this stays at the wider, fully-verified radius.
  const goldFlags = fine.map(([x, y]) => {
    if (yardCenters.some((yc) => Math.hypot(x - yc.x, y - yc.y) < yardRadiusNorm * 1.4)) return false
    return sampleGold(x, y)
  })

  const crossingCenters = []
  let i = 0
  let loops = 0
  while (i < total && loops < total * 2) {
    if (goldFlags[i % total]) {
      let j = i
      let count = 0
      while (goldFlags[j % total] && count < total) {
        j++
        count++
      }
      crossingCenters.push(Math.floor((i + (j - 1)) / 2) % total)
      i = j
    } else {
      i++
    }
    loops++
  }

  const rawSquares = []
  for (let k = 0; k < crossingCenters.length; k++) {
    const startIdx = crossingCenters[k]
    const endIdx = crossingCenters[(k + 1) % crossingCenters.length]
    const span = endIdx > startIdx ? endIdx - startIdx : total - startIdx + endIdx
    if (span < 2) continue // adjacent crossings with nothing between - a double-detect, skip
    const midFineIdx = (startIdx + Math.floor(span / 2)) % total
    rawSquares.push(fine[midFineIdx])
  }
  if (rawSquares.length < 8) return []

  // Sharp corners/junctions can make the sweep graze the same real square from several adjacent
  // angles, producing a burst of spurious extra crossings very close together. Merge any run of
  // centroids closer together than a fraction of the typical spacing into one.
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const spacings = rawSquares.map((c, idx) => dist(c, rawSquares[(idx + 1) % rawSquares.length]))
  const sortedSpacings = [...spacings].sort((a, b) => a - b)
  const medianSpacing = sortedSpacings[Math.floor(sortedSpacings.length / 2)]
  const mergeThreshold = medianSpacing * 0.6

  const merged = []
  let bucket = [rawSquares[0]]
  for (let k = 1; k < rawSquares.length; k++) {
    const prev = bucket[bucket.length - 1]
    const cur = rawSquares[k]
    if (dist(prev, cur) < mergeThreshold) {
      bucket.push(cur)
    } else {
      merged.push([bucket.reduce((s, p) => s + p[0], 0) / bucket.length, bucket.reduce((s, p) => s + p[1], 0) / bucket.length])
      bucket = [cur]
    }
  }
  merged.push([bucket.reduce((s, p) => s + p[0], 0) / bucket.length, bucket.reduce((s, p) => s + p[1], 0) / bucket.length])
  if (merged.length > 1 && dist(merged[0], merged[merged.length - 1]) < mergeThreshold) {
    const a = merged.shift()
    const b = merged.pop()
    merged.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
  }

  // Safety net: a single spurious crossing can still occasionally slip through right where a
  // gap forces a long chord past a yard, landing a "square" inside the yard itself - drop any
  // survivor like that outright rather than let a piece ever render inside a yard's own disc.
  return merged.filter((p) => !yardCenters.some((yc) => Math.hypot(p[0] - yc.x, p[1] - yc.y) < yardRadiusNorm * 1.3))
}

function buildBoardDefinition(playerCount, laneColors, yardCenters, trackOuterRadius, tracedLoop, entryStars, log) {
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

    // The board art marks each lane's real entry square with a gold star - use it directly
    // instead of assuming entry sits right next to home-entrance (the two are usually different
    // physical spokes: the short yard connector vs. the long home-stretch corridor).
    const star = entryStars[lane.color]
    let entryTrackIndex = (homeEntranceTrackIndex + 1) % trackLength
    if (star) {
      let bestIdx = 0
      let bestDist = Infinity
      trackWaypoints.forEach(([x, y], i) => {
        const d = Math.hypot(x - star.x, y - star.y)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      })
      // If the nearest waypoint is still far away, a coverage gap likely left nothing real near
      // the star - snapping anyway would land the entry on a distant, unrelated square, worse than
      // the angle-based guess.
      if (bestDist < 0.05) entryTrackIndex = bestIdx
    }
    const [ringJunctionX, ringJunctionY] = trackWaypoints[homeEntranceTrackIndex]

    // Prefer the actually-fitted pip holes (see findYardHoles) so pieces sit exactly in the real
    // painted slots, evenly spaced by construction. Only fall back to a synthetic grid if there
    // wasn't enough signal to fit the pattern at all.
    const yardOffset = 0.028
    const detectedHoles = lane.yard.holes || []
    const yardWaypoints =
      detectedHoles.length === 4
        ? detectedHoles
        : [
            point(lane.yard.x - yardOffset, lane.yard.y - yardOffset),
            point(lane.yard.x + yardOffset, lane.yard.y - yardOffset),
            point(lane.yard.x - yardOffset, lane.yard.y + yardOffset),
            point(lane.yard.x + yardOffset, lane.yard.y + yardOffset),
          ]

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
      const center = findYardCenter(pixels, color, playerCount)
      if (!center.found) {
        console.warn(`[board_${playerCount}p] weak/no yard match for ${color} - using fallback position`)
      }
      if (process.env.DEBUG_HOLES) console.error(`  ${playerCount}p ${color}:`)
      const fit = findYardHoles(hiResPixels, center, 0.06)
      if (!fit) {
        console.warn(`  [board_${playerCount}p] ${color} yard: not enough pip-hole signal - using synthetic grid`)
      }
      center.holes = fit?.holes ?? []
      center.holeRadiusNorm = fit?.holeRadiusNorm ?? null
      yardCenters.push(center)
    }

    const hubX = yardCenters.reduce((s, p) => s + p.x, 0) / yardCenters.length
    const hubY = yardCenters.reduce((s, p) => s + p.y, 0) / yardCenters.length
    const trackOuterRadius = findTrackOuterRadius(pixels, laneColors, hubX, hubY, yardCenters, 0.06)

    const entryStars = {}
    for (let i = 0; i < laneColors.length; i++) {
      const star = findEntryStar(hiResPixels, yardCenters[i], hubX, hubY, 0.06)
      if (!star) {
        console.warn(`  [board_${playerCount}p] ${laneColors[i]}: entry star not found - falling back to angle-based entry`)
      }
      entryStars[laneColors[i]] = star
    }

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

    // Polar sampling can't self-overlap (angle-ordered by construction), so it's the reliable
    // source for measuring real squares even on boards where the walk scores better on gap-ratio
    // alone - the walk's grid-cell collapse can double back over itself on some board shapes
    // (confirmed on the 2-player board: it revisited the same real squares twice), which gap-ratio
    // doesn't detect but divider-crossing counting would double-count. Only fall back to the walk
    // if polar didn't find enough of the ring to be usable.
    const primaryIsPolar = polar.length >= 30
    const squareSource = primaryIsPolar ? polar : walked
    const dividerPixels = await loadPixels(imagePath, 1100) // thin gold divider lines need this much resolution to survive JPEG compression
    const realSquares = extractRealSquares(dividerPixels, squareSource, yardCenters, 0.06)

    if (realSquares.length >= playerCount * 8) {
      tracedLoop = realSquares
      console.log(`  measured ${realSquares.length} real squares directly from the board art`)
    } else {
      console.warn(`  [board_${playerCount}p] divider extraction found too few squares (${realSquares.length}) - falling back to estimated resampling`)
      if (tracedLoop.length >= 8) {
        const targetCount = playerCount * SQUARES_PER_ARM
        tracedLoop = resampleClosedLoop(tracedLoop, targetCount)
        console.log(`  resampled to ${targetCount} squares (${SQUARES_PER_ARM} per arm)`)
      }
    }

    definitions[playerCount] = buildBoardDefinition(playerCount, laneColors, yardCenters, trackOuterRadius, tracedLoop, entryStars, console.warn)
  }

  writeFileSync(path.join(ROOT, 'src', 'data', 'generated-boards.json'), JSON.stringify(definitions, null, 2))
  console.log('Wrote src/data/generated-boards.json')
}

main()
