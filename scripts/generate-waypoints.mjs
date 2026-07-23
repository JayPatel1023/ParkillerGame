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
const SQUARES_PER_ARM = 13 // target track squares per lane after resampling (~classic parchís proportions)

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

async function loadPixels(imagePath) {
  const { data, info } = await sharp(imagePath)
    .resize(SIZE, SIZE, { fit: 'fill' })
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
function polarSampleRingLoop(pixels, laneColors, yardCenters, cx, cy, trackOuterRadius, yardRadiusNorm) {
  const { data, width, height, channels } = pixels
  const N = 200
  const rStart = trackOuterRadius * 0.34
  const rEnd = trackOuterRadius * 1.05
  const steps = 160
  const points = []

  for (let k = 0; k < N; k++) {
    const theta = (k / N) * 2 * Math.PI
    const matches = []
    for (let s = 0; s <= steps; s++) {
      const r = rStart + (rEnd - rStart) * (s / steps)
      const nx = cx + Math.cos(theta) * r
      const ny = cy + Math.sin(theta) * r
      if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) continue
      if (yardCenters.some((yc) => Math.hypot(nx - yc.x, ny - yc.y) < yardRadiusNorm * 1.4)) continue

      const x = Math.min(width - 1, Math.max(0, Math.round(nx * width)))
      const y = Math.min(height - 1, Math.max(0, Math.round(ny * height)))
      const idx = (y * width + x) * channels
      const [h, s2, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
      if (laneColors.some((color) => matchesColor(h, s2, v, color))) matches.push([nx, ny])
    }
    if (matches.length === 0) continue
    points.push([
      matches.reduce((s3, p) => s3 + p[0], 0) / matches.length,
      matches.reduce((s3, p) => s3 + p[1], 0) / matches.length,
    ])
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

    const yardOffset = 0.028
    const yardWaypoints = [
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

    const yardCenters = []
    for (const color of laneColors) {
      const center = findYardCenter(pixels, color)
      if (!center.found) {
        console.warn(`[board_${playerCount}p] weak/no yard match for ${color} - using fallback position`)
      }
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
