import { useEffect, useState } from 'react'
import { useRobustTexture } from './useRobustTexture'

/**
 * Reads each square's real color straight from the board art (at its own waypoint's normalized
 * [u, v] position), instead of guessing per-square color from "nearest yard" - the board's actual
 * pixels are the ground truth for what color that square is drawn as.
 *
 * Reported directly, with a screenshot, recurring across multiple reloads ("después de recargar de
 * nuevo... y una vez más" - after reloading, and once more): this used to fetch imageUrl itself via
 * a bare `new Image()`, completely independently of BoardMesh's own texture for that exact same
 * URL, with no onerror handler, no retry, and no shared cache - a genuinely different, more fragile
 * loader than useRobustTexture, which was already built (see its own doc comment) to fix this exact
 * failure class for BoardMesh/TrackTile. A failed load here just left `sampler` null forever, with
 * zero track tiles ever rendering (BoardScene's own trackTiles memo returns [] on a null sampler),
 * while BoardMesh's separately-robust texture could still recover - explaining a board that shows
 * its plain fallback color with nothing on top, pieces included, surviving several reloads instead
 * of just one flaky one. Now reads pixels from the exact same THREE.Texture useRobustTexture already
 * loads for BoardMesh (retried, backed off, shared, cache-busted) instead of re-fetching separately.
 */
export function useBoardColorSampler(imageUrl: string): ((u: number, v: number) => string) | null {
  const texture = useRobustTexture(imageUrl)
  const [sampler, setSampler] = useState<((u: number, v: number) => string) | null>(null)

  useEffect(() => {
    if (!texture) {
      setSampler(null)
      return
    }
    const image = texture.image as HTMLImageElement | ImageBitmap
    const width = 'naturalWidth' in image ? image.naturalWidth : image.width
    const height = 'naturalHeight' in image ? image.naturalHeight : image.height
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const data = ctx.getImageData(0, 0, width, height).data
    setSampler(() => (u: number, v: number) => {
      const x = Math.max(0, Math.min(width - 1, Math.round(u * width)))
      const y = Math.max(0, Math.min(height - 1, Math.round(v * height)))
      const idx = (y * width + x) * 4
      const toHex = (n: number) => n.toString(16).padStart(2, '0')
      return `#${toHex(data[idx])}${toHex(data[idx + 1])}${toHex(data[idx + 2])}`
    })
  }, [texture])

  return sampler
}
