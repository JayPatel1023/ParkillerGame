import { useEffect, useState } from 'react'

/**
 * Reads each square's real color straight from the board art (at its own waypoint's normalized
 * [u, v] position), instead of guessing per-square color from "nearest yard" - the board's actual
 * pixels are the ground truth for what color that square is drawn as.
 */
export function useBoardColorSampler(imageUrl: string): ((u: number, v: number) => string) | null {
  const [sampler, setSampler] = useState<((u: number, v: number) => string) | null>(null)

  useEffect(() => {
    setSampler(null)
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const { width, height } = canvas
      const data = ctx.getImageData(0, 0, width, height).data
      setSampler(() => (u: number, v: number) => {
        const x = Math.max(0, Math.min(width - 1, Math.round(u * width)))
        const y = Math.max(0, Math.min(height - 1, Math.round(v * height)))
        const idx = (y * width + x) * 4
        const toHex = (n: number) => n.toString(16).padStart(2, '0')
        return `#${toHex(data[idx])}${toHex(data[idx + 1])}${toHex(data[idx + 2])}`
      })
    }
    img.src = imageUrl
    return () => {
      cancelled = true
    }
  }, [imageUrl])

  return sampler
}
