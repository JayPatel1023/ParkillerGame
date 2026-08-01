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

// Measured directly from board_2p.jpg via connected-component labeling on the gold pixel mask
// (isolates each of the 4 pip-hole rings as its own component, distinct from the much larger
// outer-boundary-ring and connector-strip components) rather than the general density/circle-fit
// approach, which - confirmed by comparing its output against these same real pixels - was landing
// consistently off (0.01-0.03 normalized units) for this board's yards specifically. Component
// pixel counts for all 4 holes were within 5% of each other (Red: 826-863, Blue: 911-938),
// confirming clean, unambiguous isolation rather than a partial/contaminated match.
// holeRadiusNorm is also measured directly, not guessed: half of each component's own bounding-box
// width/height, averaged across that lane's 4 holes (Red bounding boxes ~0.0321-0.0336, Blue
// ~0.0336-0.0350).
const YARD_HOLES_OVERRIDES = {
  // Same failure as the others below - fitted center (0.2998,0.3639) missed the real holes'
  // (0.253-0.317, 0.354-0.410) clean 2x2 grid, measured directly against a gridded crop.
  '3-Red': {
    holes: [
      [0.253, 0.354],
      [0.317, 0.354],
      [0.253, 0.41],
      [0.317, 0.41],
    ],
    holeRadiusNorm: 0.015,
  },
  '2-Red': {
    holes: [
      [0.2732, 0.6455],
      [0.3285, 0.6439],
      [0.2754, 0.6998],
      [0.3304, 0.6984],
    ],
    holeRadiusNorm: 0.0165,
  },
  '2-Blue': {
    holes: [
      [0.6571, 0.2525],
      [0.7128, 0.2517],
      [0.6588, 0.3071],
      [0.7146, 0.3061],
    ],
    holeRadiusNorm: 0.0173,
  },
  // Same failure as 2-Red/2-Blue above, found on later boards during a demo-readiness sweep: the
  // general density search locked onto Blue's connector stub instead of the yard's own 4 holes (3p),
  // landing pieces well outside the yard entirely - visually obvious, confirmed via screenshot.
  '3-Blue': {
    holes: [
      [0.6683, 0.3547],
      [0.7299, 0.3547],
      [0.6684, 0.4162],
      [0.7299, 0.4162],
    ],
    holeRadiusNorm: 0.014,
  },
  '4-Blue': {
    holes: [
      [0.6822, 0.6059],
      [0.7204, 0.6415],
      [0.6822, 0.6785],
      [0.6444, 0.642],
    ],
    holeRadiusNorm: 0.0106,
  },
  // Same failure again - the density search's fitted center for 4-Red landed about 0.037 off in x
  // from the real holes (measured directly against a gridded crop of the source art: fitted
  // (0.3542,0.2803) vs the real diamond-arranged holes' own center (0.317,0.280)), so pieces
  // rendered clustered near the yard's middle instead of in the 4 holes.
  '4-Red': {
    holes: [
      [0.317, 0.245],
      [0.355, 0.28],
      [0.317, 0.316],
      [0.278, 0.28],
    ],
    holeRadiusNorm: 0.0104,
  },
  // Rest of this table (4-Green through 6-Green) measured in one pass against gridded crops of the
  // source art, same method as the entries above - a full sweep after a client screenshot marked
  // essentially every yard except 2p and 4/5/6-Blue as visibly clustered/off-hole.
  '4-Green': {
    holes: [
      [0.32, 0.605],
      [0.281, 0.639],
      [0.357, 0.639],
      [0.32, 0.673],
    ],
    holeRadiusNorm: 0.014,
  },
  '5-Red': {
    holes: [
      [0.25, 0.521],
      [0.293, 0.541],
      [0.234, 0.564],
      [0.274, 0.586],
    ],
    holeRadiusNorm: 0.014,
  },
  '5-Gold': {
    holes: [
      [0.632, 0.234],
      [0.679, 0.234],
      [0.632, 0.282],
      [0.679, 0.282],
    ],
    holeRadiusNorm: 0.014,
  },
  '5-Purple': {
    holes: [
      [0.736, 0.521],
      [0.696, 0.538],
      [0.753, 0.568],
      [0.713, 0.585],
    ],
    holeRadiusNorm: 0.014,
  },
  '5-Green': {
    holes: [
      [0.504, 0.698],
      [0.471, 0.731],
      [0.537, 0.731],
      [0.504, 0.764],
    ],
    holeRadiusNorm: 0.014,
  },
  '6-Blue': {
    holes: [
      [0.293, 0.33],
      [0.242, 0.342],
      [0.307, 0.382],
      [0.255, 0.394],
    ],
    holeRadiusNorm: 0.014,
  },
  '6-Gold': {
    holes: [
      [0.483, 0.201],
      [0.445, 0.239],
      [0.522, 0.239],
      [0.483, 0.273],
    ],
    holeRadiusNorm: 0.014,
  },
  '6-Purple': {
    holes: [
      [0.68, 0.331],
      [0.725, 0.34],
      [0.668, 0.375],
      [0.713, 0.383],
    ],
    holeRadiusNorm: 0.014,
  },
  '6-Red': {
    holes: [
      [0.67, 0.596],
      [0.713, 0.586],
      [0.724, 0.629],
      [0.682, 0.635],
    ],
    holeRadiusNorm: 0.014,
  },
  '6-Green': {
    holes: [
      [0.483, 0.702],
      [0.443, 0.742],
      [0.522, 0.742],
      [0.483, 0.781],
    ],
    holeRadiusNorm: 0.014,
  },
  // Follow-up pass: these three were missed in the first sweep (4/3-Gold weren't visibly wrong in
  // the gridded-crop check at the time; 6-Orange wasn't checked at all - a client screenshot caught
  // all three still clustered).
  '4-Gold': {
    holes: [
      [0.685, 0.247],
      [0.646, 0.28],
      [0.722, 0.28],
      [0.685, 0.317],
    ],
    holeRadiusNorm: 0.014,
  },
  '3-Gold': {
    holes: [
      [0.463, 0.692],
      [0.525, 0.692],
      [0.463, 0.753],
      [0.525, 0.753],
    ],
    holeRadiusNorm: 0.014,
  },
  '6-Orange': {
    holes: [
      [0.273, 0.579],
      [0.326, 0.593],
      [0.26, 0.636],
      [0.312, 0.642],
    ],
    holeRadiusNorm: 0.014,
  },
}

// Same measurement pass as YARD_HOLES_OVERRIDES, for the entry star icon - verified by cropping the
// exact coordinate and visually confirming the 4-point star sits there.
const ENTRY_STAR_OVERRIDES = {
  '2-Red': { x: 0.1281, y: 0.6703 },
  '2-Blue': { x: 0.8591, y: 0.2954 },
}

// The hub is drawn as one wedge per lane color, each with its own small circle marking that lane's
// actual finish square - not one shared circle at the hub's geometric center. The generic formula
// below aims every lane's home corridor at cx/cy, the *average* of all yards' centers, which isn't
// any lane's own wedge - confirmed by rendering it: Red's corridor line visibly cut across Blue's
// wedge before reaching that shared, wrong point, instead of staying inside Red's own wedge the way
// a real piece moving home should. Measured directly (connected-component centroid, HSV: circle
// interior reads clearly higher-saturation than the wedge fill around it, not darker as it first
// looks - s>0.7 vs ~0.55 for the surrounding wedge, at similar brightness): Red's finish circle at
// (0.4428, 0.5274), Blue's at (0.5447, 0.4256), both well off the shared cx/cy this board computes
// (~0.494, 0.4755). Only measured for 2p so far; other boards still use the shared-center formula.
const HUB_FINISH_OVERRIDES = {
  '2-Red': { x: 0.4428, y: 0.5274 },
  '2-Blue': { x: 0.5447, y: 0.4256 },
}

// The board art has no drawn squares for the home stretch (confirmed via edge detection on the
// source image - only the yard rings/holes and the main loop's tile dividers produce edges, the
// wedge interior is one flat fill with a single finish-circle marker), so there's no real path to
// literally trace. A straight ring-junction -> finish line is the simplest option consistent with
// that, but reads as visibly cutting across the wedge rather than following its own curved
// boundary - per explicit direction, bow it instead. Control points below are verified two ways:
// (1) every point on the curve stays within the *wedge's own painted fill* (sampled hue along the
// whole curve, not just the control point - an earlier attempt bowed far enough to leave the paint
// entirely), and (2) every point clears each of the yard's 4 hole centers by >=0.045 normalized
// units (an even earlier attempt cut straight through them).
const HUB_CORRIDOR_CURVE_OVERRIDES = {
  '2-Red': { x: 0.2225, y: 0.539 },
  '2-Blue': { x: 0.7678, y: 0.4212 },
}

// 2p board: entirely hand-verified and rebuilt, not patched in place - see git history on this file
// for the long trail of per-index overrides (idx0-62 individually corrected, two array splices to
// insert missed squares, a 34%-nudge to squeeze extra room out of one pinch point) that got this
// board's *63-count* data as close to right as a 63-count structure could get. Across that process,
// three independent full-loop gold-divider sweeps (different upsampling, different guide paths, one
// even using a completely fresh screenshot for calibration) all converged on the same number: this
// board's art only has 58 real squares, not 63. The 63 was never correct - it was what the original
// auto-trace happened to output, and every "square with 2 points crammed into it" bug reported this
// session was that same root cause resurfacing in a new spot. Patching individual pinch points can
// only approximate a 58-square board using 63 indices; it can't fix the actual mismatch. So instead
// of another patch, trackWaypoints below *is* the measured 58-square sequence directly - each entry
// the fill-centroid between two real, swept gold-divider crossings on board_2p.jpg, walked in path
// order starting from the same point the original trace started at. Recomputed with trackLength=58,
// the gap between every consecutive pair of squares is 0.032-0.049 (average 0.041) - no outliers in
// either direction, unlike any measurement taken against the old 63-count structure. entryTrackIndex
// and homeEntranceTrackIndex don't need any manual bookkeeping for the new count: both are resolved
// below by nearest-real-position search (to the star icon / to the yard's own angle) against
// whatever trackWaypoints turns out to be, so they land correctly on this shorter array the same way
// they did on the old one. The two star squares (Red idx23, Blue idx52 in this new numbering) use
// the star icon's own exactly-measured position (ENTRY_STAR_OVERRIDES) rather than the swept fill-
// centroid, matching the explicit final call on where a piece should render within the entry square.
const TRACK_WAYPOINTS_2P = [
  [0.8063, 0.5235],
  [0.7974, 0.5608],
  [0.7842, 0.6005],
  [0.7717, 0.6355],
  [0.7498, 0.6702],
  [0.7273, 0.7006],
  [0.6945, 0.7334],
  [0.6555, 0.7596],
  [0.6183, 0.776],
  [0.5837, 0.7897],
  [0.542, 0.796],
  [0.4964, 0.796],
  [0.4533, 0.798],
  [0.4194, 0.8095],
  [0.3943, 0.8327],
  [0.3585, 0.847],
  [0.3157, 0.8447],
  [0.2722, 0.8384],
  [0.2391, 0.8259],
  [0.2096, 0.7983],
  [0.179, 0.7787],
  [0.1579, 0.7498],
  [0.1411, 0.7154],
  [0.1281, 0.6703],
  [0.1374, 0.6295],
  [0.1431, 0.5888],
  [0.1646, 0.5561],
  [0.177, 0.517],
  [0.1841, 0.4751],
  [0.1916, 0.4267],
  [0.1972, 0.3933],
  [0.2033, 0.3543],
  [0.2184, 0.3214],
  [0.2394, 0.2885],
  [0.2645, 0.2578],
  [0.2943, 0.2268],
  [0.3345, 0.2027],
  [0.3695, 0.1828],
  [0.4046, 0.1676],
  [0.4482, 0.1579],
  [0.4931, 0.1558],
  [0.5306, 0.1516],
  [0.5676, 0.1407],
  [0.5956, 0.1248],
  [0.6342, 0.1122],
  [0.6757, 0.1062],
  [0.7221, 0.1138],
  [0.7611, 0.1273],
  [0.7932, 0.1577],
  [0.8127, 0.1857],
  [0.84, 0.2104],
  [0.8519, 0.2527],
  [0.8591, 0.2954],
  [0.8622, 0.3404],
  [0.8414, 0.374],
  [0.8231, 0.4068],
  [0.8154, 0.4386],
  [0.811, 0.4798],
]

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

// Yard radius varies by board (a 6-player board packs smaller yards than a 2-player one) and by
// lane on the same board, but every downstream step that needs "how big is this yard" - hole
// search window, track-tracing's yard-pixel exclusion, entry-star search - used one hardcoded 0.06
// for all of them. Measuring the real radius directly (walk outward from center along many angles,
// median distance where the lane color actually stops - median so the one direction the yard
// connector extends further doesn't skew it) removes that as a shared source of error across all
// of those steps at once, not just hole detection.
// Sweeps outward from `fromCenter` along N angles and returns each direction's real edge point
// (where the lane color actually stops), not just the distance - reused by findYardRadius both to
// measure the radius and, separately, to re-center on the disc's own true shape.
function sweepYardEdge(pixels, fromCenter, color) {
  const { data, width, height, channels } = pixels
  const cx = fromCenter.x * width
  const cy = fromCenter.y * height
  const startR = width * 0.02
  const maxR = width * 0.16
  const gapTolerance = Math.max(2, Math.round(width * 0.006))
  const N = 72

  const edgePoints = []
  for (let k = 0; k < N; k++) {
    const theta = (k / N) * 2 * Math.PI
    let lastMatchR = 0
    for (let r = startR; r <= maxR; r += 1) {
      const x = Math.round(cx + Math.cos(theta) * r)
      const y = Math.round(cy + Math.sin(theta) * r)
      if (x < 0 || y < 0 || x >= width || y >= height) break
      const idx = (y * width + x) * channels
      const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
      if (matchesColor(h, s, v, color)) {
        lastMatchR = r
      } else if (lastMatchR > 0 && r - lastMatchR > gapTolerance) {
        break
      }
    }
    if (lastMatchR > startR) edgePoints.push([(cx + Math.cos(theta) * lastMatchR) / width, (cy + Math.sin(theta) * lastMatchR) / height])
  }
  return edgePoints
}

// findYardCenter's color-density search can land measurably off the disc's true center - denser
// internal regions (the pip-hole rings, a connector stub sharing the same lane color) pull a
// density estimate toward themselves. Confirmed directly against real measured hole positions: a
// fit built on the density center was off by 0.016-0.028 normalized units on one lane tested. The
// disc's own OUTER EDGE is a fuller, more symmetric signal than internal density, so re-center on
// the centroid of the measured edge (two rounds - each round's better center measures a cleaner
// edge) before reporting the final radius.
function findYardRadius(pixels, center, color) {
  let refinedCenter = center
  let edgePoints = null
  for (let pass = 0; pass < 2; pass++) {
    edgePoints = sweepYardEdge(pixels, refinedCenter, color)
    if (edgePoints.length < 36) return pass === 0 ? null : { radiusNorm: null, center: refinedCenter }
    refinedCenter = {
      x: edgePoints.reduce((s, p) => s + p[0], 0) / edgePoints.length,
      y: edgePoints.reduce((s, p) => s + p[1], 0) / edgePoints.length,
    }
  }
  const radii = edgePoints.map((p) => Math.hypot(p[0] - refinedCenter.x, p[1] - refinedCenter.y))
  return { radiusNorm: median(radii), center: refinedCenter }
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
function findYardHoles(pixels, yardCenter, yardRadiusNorm, overrideKey) {
  const override = overrideKey && YARD_HOLES_OVERRIDES[overrideKey]
  if (override) {
    return { holes: override.holes.map((p) => point(p[0], p[1])), holeRadiusNorm: override.holeRadiusNorm }
  }

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
  // the standard trick for finding the dominant orientation of n-fold symmetric point data. Still
  // used, but only for the rotation - forcing every point onto a perfect circle at one fitted
  // radius around one fitted center (the original approach) turned out to be too sensitive to that
  // center being slightly off (confirmed against real measured hole positions: the whole 4-hole
  // pattern would shift together, off by 0.01-0.03 normalized units, whenever the center was off by
  // that much - which the search window's own asymmetry around an imperfect yardCenter can cause).
  const angles = kept.map((p) => Math.atan2(p[1] - center[1], p[0] - center[0]))
  const sumSin = angles.reduce((s, a) => s + Math.sin(4 * a), 0)
  const sumCos = angles.reduce((s, a) => s + Math.cos(4 * a), 0)
  const offset = Math.atan2(sumSin, sumCos) / 4

  // Un-rotate every point by the fitted offset so the 4 holes line up with the x/y axes, then split
  // into quadrants by the rotated points' own bounding-box midpoint (not the circle-fit center) and
  // average each quadrant directly - each hole's reported position is then just where its own real
  // pixels actually are, self-correcting regardless of how far off the initial center estimate was.
  const cosO = Math.cos(-offset), sinO = Math.sin(-offset)
  const rotated = kept.map((p) => {
    const dx = p[0] - center[0], dy = p[1] - center[1]
    return [dx * cosO - dy * sinO, dx * sinO + dy * cosO]
  })
  const rxs = rotated.map((p) => p[0]), rys = rotated.map((p) => p[1])
  const midX = (Math.min(...rxs) + Math.max(...rxs)) / 2
  const midY = (Math.min(...rys) + Math.max(...rys)) / 2
  const quadrants = [[], [], [], []] // ++, -+, --, +- (matches the k*90deg ordering below)
  rotated.forEach(([rx, ry], i) => {
    const right = rx >= midX, top = ry >= midY
    const k = right && top ? 0 : !right && top ? 1 : !right && !top ? 2 : 3
    quadrants[k].push(kept[i]) // average the ORIGINAL (un-rotated) points for the real answer
  })
  const slotCenters = quadrants.map((q, k) => {
    if (q.length === 0) {
      const a = offset + (k * Math.PI) / 2
      return [center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius] // no signal - fall back to the circle fit for just this slot
    }
    return [q.reduce((s, p) => s + p[0], 0) / q.length, q.reduce((s, p) => s + p[1], 0) / q.length]
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
    console.error(`    slotCenters=${JSON.stringify(slotCenters.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]))}`)
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
function findEntryStar(hiResPixels, yardCenter, hubX, hubY, yardRadiusNorm, overrideKey) {
  const override = overrideKey && ENTRY_STAR_OVERRIDES[overrideKey]
  if (override) return override

  const { data, width, height, channels } = hiResPixels
  function isGoldAt(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const idx = (y * width + x) * channels
    const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
    return isGoldDivider(h, s, v)
  }

  // Wider than the yard-hole/track-exclusion uses of this radius: the star's real distance from
  // yard center doesn't scale exactly with yard radius across boards, and the old fixed 0.06 (often
  // an overestimate for smaller yards) was accidentally generous enough to always reach it. Now
  // that the radius is measured precisely per lane, widen the multiplier to not lose that margin -
  // confirmed several lanes' stars went missing at the old 3.7x once the radius shrank to its real,
  // smaller size.
  const searchR = Math.round(yardRadiusNorm * 6 * width)
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

// Nudges each already-finalized square center toward the real color centroid of its own immediate
// neighborhood - unlike an earlier attempt that recomputed crossings/merging from scratch (which
// changed how many squares got detected board-to-board, an unpredictable and unsafe side effect,
// confirmed by a failing regression test), this only adjusts a coordinate already decided, so the
// square count and order from extractRealSquares above can never change. A hard cap on how far any
// point can move (maxCorrection) means a bad local read - e.g. sampling into a neighboring arm at a
// pinch point - can only be rejected, never relocate a point across the board.
function refineToLocalFillCentroid(hiResPixels, points, maxCorrection) {
  const { data, width, height, channels } = hiResPixels
  function isFillColor(nx, ny) {
    const x = Math.max(0, Math.min(width - 1, Math.round(nx * (width - 1))))
    const y = Math.max(0, Math.min(height - 1, Math.round(ny * (height - 1))))
    const idx = (y * width + x) * channels
    const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])
    if (isGoldDivider(h, s, v)) return false
    return s >= 0.2 && v >= 0.18
  }

  const n = points.length
  return points.map((p, i) => {
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const dx = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1e-9
    const dirX = dx / len
    const dirY = dy / len
    const perpX = -dirY
    const perpY = dirX

    const fillPts = []
    for (let a = -0.012; a <= 0.012; a += 0.004) {
      for (let b = -0.03; b <= 0.03; b += 0.004) {
        const sx = p[0] + dirX * a + perpX * b
        const sy = p[1] + dirY * a + perpY * b
        if (isFillColor(sx, sy)) fillPts.push([sx, sy])
      }
    }
    if (fillPts.length < 6) return p // not enough real fill signal nearby - leave this point as-is

    const cx = fillPts.reduce((s, q) => s + q[0], 0) / fillPts.length
    const cy = fillPts.reduce((s, q) => s + q[1], 0) / fillPts.length
    const correctionDist = Math.hypot(cx - p[0], cy - p[1])
    return correctionDist > maxCorrection ? p : [cx, cy]
  })
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

    // 2p: replace the auto-traced 63-point loop entirely with the hand-verified 58-square sequence
    // (see TRACK_WAYPOINTS_2P above for why 58 and not 63). No per-index patching needed here since
    // that array already *is* the final answer, measured directly - not derived from tracedLoop.
    if (playerCount === 2) {
      trackWaypoints = TRACK_WAYPOINTS_2P.map(([x, y]) => point(x, y))
    }

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
    // there's no visible gap between the last track square and the first corridor square. Aims at
    // this lane's own measured finish circle when known (HUB_FINISH_OVERRIDES) - falls back to the
    // shared hub center otherwise, which is wrong (see comment there) but better than nothing on
    // boards that haven't been measured yet.
    const finishOverride = HUB_FINISH_OVERRIDES[`${playerCount}-${lane.color}`]
    const finishX = finishOverride ? finishOverride.x : cx
    const finishY = finishOverride ? finishOverride.y : cy
    // Bows the corridor through this lane's own wedge (HUB_CORRIDOR_CURVE_OVERRIDES) instead of
    // cutting a straight line across it - falls back to a straight ring-junction->finish line
    // (control point == midpoint) on boards that haven't been curve-measured yet.
    const curveOverride = HUB_CORRIDOR_CURVE_OVERRIDES[`${playerCount}-${lane.color}`]
    const controlX = curveOverride ? curveOverride.x : (ringJunctionX + finishX) / 2
    const controlY = curveOverride ? curveOverride.y : (ringJunctionY + finishY) / 2
    const homeCorridorWaypoints = []
    for (let i = 1; i <= ARM_STEPS; i++) {
      const t = i / (ARM_STEPS + 1) // 0 = at the ring junction, 1 = at the finish square
      const oneMinusT = 1 - t
      const bx = oneMinusT * oneMinusT * ringJunctionX + 2 * oneMinusT * t * controlX + t * t * finishX
      const by = oneMinusT * oneMinusT * ringJunctionY + 2 * oneMinusT * t * controlY + t * t * finishY
      homeCorridorWaypoints.push(point(bx, by))
    }

    return {
      color: lane.color,
      entryTrackIndex,
      homeEntranceTrackIndex,
      homeCorridorWaypoints,
      yardWaypoints,
    }
  })

  // Entry squares are always safe by rule, but the rulebook also marks additional squares safe by
  // drawing them in a darker shade (see plan notes) - this generic pass only knows about entries.
  // For 2p, the user hand-marked every real safe (dark-colored) square directly on a screenshot of
  // the rendered board (green dot = safe, white = normal) - measured via color-blob detection
  // against that screenshot, cross-checked against trackWaypoints by nearest-point distance
  // (all matches within 0.016 normalized units, well under one square's spacing).
  // 2p re-matched against the 58-square TRACK_WAYPOINTS_2P sequence (see comment there) - all 8
  // land within 0.003 normalized units, confirming the same 8 real safe squares independent of the
  // 58-vs-63 indexing question.
  const EXTRA_SAFE_INDICES = {
    2: [6, 11, 16, 28, 35, 40, 45, 57],
  }
  const safeTrackIndices = Array.from(
    new Set([...playerLanes.map((l) => l.entryTrackIndex), ...(EXTRA_SAFE_INDICES[playerCount] ?? [])]),
  ).sort((a, b) => a - b)

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
      // Every downstream step (hole search window, entry-star search, track-tracing's yard
      // exclusion) previously shared one hardcoded 0.06 regardless of this board's or lane's real
      // yard size - measure it directly instead. Also re-centers on the disc's real shape (see
      // findYardRadius) rather than trusting findYardCenter's density estimate for the hole search -
      // confirmed against real pixel measurements this was a real source of error, not just a style
      // preference: with the old center+0.06, detected pip holes for board_3p Red were off by
      // 0.01-0.03 normalized units (several pixels) from their true positions in the art.
      const radiusFit = findYardRadius(hiResPixels, center, color)
      if (!radiusFit || radiusFit.radiusNorm == null) {
        console.warn(`  [board_${playerCount}p] ${color} yard: outer radius not measured - falling back to 0.06`)
      } else {
        center.x = radiusFit.center.x
        center.y = radiusFit.center.y
      }
      center.radiusNorm = radiusFit?.radiusNorm ?? 0.06
      if (process.env.DEBUG_HOLES) console.error(`  ${playerCount}p ${color}: radiusNorm=${center.radiusNorm.toFixed(4)} recenteredTo=(${center.x.toFixed(4)},${center.y.toFixed(4)})`)
      const fit = findYardHoles(hiResPixels, center, center.radiusNorm, `${playerCount}-${color}`)
      if (!fit) {
        console.warn(`  [board_${playerCount}p] ${color} yard: not enough pip-hole signal - using synthetic grid`)
      }
      center.holes = fit?.holes ?? []
      center.holeRadiusNorm = fit?.holeRadiusNorm ?? null
      yardCenters.push(center)
    }

    const hubX = yardCenters.reduce((s, p) => s + p.x, 0) / yardCenters.length
    const hubY = yardCenters.reduce((s, p) => s + p.y, 0) / yardCenters.length
    // Functions below exclude a disc of this radius around each yard center to avoid mistaking
    // yard-disc pixels for track squares. Use the largest of this board's real measured yard radii
    // (not the old fixed 0.06) so every yard is fully excluded regardless of its own real size -
    // under-excluding is the worse failure mode here (yard pixels leaking into track detection).
    const sharedYardRadius = Math.max(...yardCenters.map((yc) => yc.radiusNorm))
    const trackOuterRadius = findTrackOuterRadius(pixels, laneColors, hubX, hubY, yardCenters, sharedYardRadius)

    const entryStars = {}
    for (let i = 0; i < laneColors.length; i++) {
      const star = findEntryStar(hiResPixels, yardCenters[i], hubX, hubY, yardCenters[i].radiusNorm, `${playerCount}-${laneColors[i]}`)
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
    const walked = traceRingLoop(pixels, laneColors, yardCenters, hubX, hubY, trackOuterRadius, sharedYardRadius)
    const polar = polarSampleRingLoop(pixels, laneColors, yardCenters, hubX, hubY, trackOuterRadius, sharedYardRadius)
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
    const realSquares = extractRealSquares(dividerPixels, squareSource, yardCenters, sharedYardRadius)

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

    const beforeRefine = tracedLoop
    tracedLoop = refineToLocalFillCentroid(hiResPixels, tracedLoop, 0.02)
    const refinedCount = tracedLoop.filter((p, i) => p[0] !== beforeRefine[i][0] || p[1] !== beforeRefine[i][1]).length
    console.log(`  refined ${refinedCount}/${tracedLoop.length} square centers toward local fill centroid`)

    definitions[playerCount] = buildBoardDefinition(playerCount, laneColors, yardCenters, trackOuterRadius, tracedLoop, entryStars, console.warn)
  }

  writeFileSync(path.join(ROOT, 'src', 'data', 'generated-boards.json'), JSON.stringify(definitions, null, 2))
  console.log('Wrote src/data/generated-boards.json')
}

main()
