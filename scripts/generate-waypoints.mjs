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

function buildBoardDefinition(playerCount, laneColors, yardCenters, trackOuterRadius) {
  const cx = yardCenters.reduce((s, p) => s + p.x, 0) / yardCenters.length
  const cy = yardCenters.reduce((s, p) => s + p.y, 0) / yardCenters.length

  const withAngles = laneColors.map((color, i) => {
    const yard = yardCenters[i]
    const angle = Math.atan2(yard.y - cy, yard.x - cx)
    return { color, yard, angle: angle < 0 ? angle + 2 * Math.PI : angle }
  })

  // The track isn't circular - it's a lobed "clover" that bulges out near each yard and pinches
  // in between them. Model radius(theta) as Gaussian bumps centered on each yard's real angle,
  // instead of a plain circle, so the loop at least approximates that shape.
  const outerR = trackOuterRadius * 0.88
  const innerR = trackOuterRadius * 0.42
  const sortedAngles = [...withAngles.map((l) => l.angle)].sort((a, b) => a - b)
  const gaps = sortedAngles.map((a, i) => angularDist(a, sortedAngles[(i + 1) % sortedAngles.length]))
  const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length
  const sigma = avgGap / 2.4

  function radiusAt(theta) {
    let bulge = 0
    for (const lane of withAngles) {
      const d = angularDist(theta, lane.angle)
      bulge = Math.max(bulge, Math.exp(-(d * d) / (2 * sigma * sigma)))
    }
    return innerR + (outerR - innerR) * bulge
  }

  const armLength = 12
  const trackLength = playerCount * armLength

  // entry index proportional to each lane's real measured angle, so lanes keep their actual
  // relative layout instead of being forced into even spacing.
  const sortedByAngle = [...withAngles].sort((a, b) => a.angle - b.angle)
  const entryIndexByColor = {}
  sortedByAngle.forEach((lane, i) => {
    entryIndexByColor[lane.color] = Math.round((i / playerCount) * trackLength)
  })

  const trackWaypoints = []
  for (let k = 0; k < trackLength; k++) {
    const theta = (k / trackLength) * 2 * Math.PI
    const r = radiusAt(theta)
    trackWaypoints.push(point(cx + Math.cos(theta) * r, cy + Math.sin(theta) * r))
  }

  const playerLanes = withAngles.map((lane) => {
    const entryTrackIndex = entryIndexByColor[lane.color]
    const homeEntranceTrackIndex = (entryTrackIndex - 1 + trackLength) % trackLength

    const yardOffset = 0.028
    const yardWaypoints = [
      point(lane.yard.x - yardOffset, lane.yard.y - yardOffset),
      point(lane.yard.x + yardOffset, lane.yard.y - yardOffset),
      point(lane.yard.x - yardOffset, lane.yard.y + yardOffset),
      point(lane.yard.x + yardOffset, lane.yard.y + yardOffset),
    ]

    const homeCorridorWaypoints = []
    for (let i = 1; i <= ARM_STEPS; i++) {
      const t = i / (ARM_STEPS + 1) // 0 = at track loop, 1 = at hub center; skip both endpoints
      const r = outerR * (1 - t * 0.85)
      homeCorridorWaypoints.push(point(cx + Math.cos(lane.angle) * r, cy + Math.sin(lane.angle) * r))
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

    definitions[playerCount] = buildBoardDefinition(playerCount, laneColors, yardCenters, trackOuterRadius)
    console.log(
      `board_${playerCount}p: yards ->`,
      yardCenters.map((c) => `(${c.x.toFixed(2)},${c.y.toFixed(2)})`).join(' '),
      `trackOuterRadius=${trackOuterRadius.toFixed(2)}`,
    )
  }

  writeFileSync(path.join(ROOT, 'src', 'data', 'generated-boards.json'), JSON.stringify(definitions, null, 2))
  console.log('Wrote src/data/generated-boards.json')
}

main()
