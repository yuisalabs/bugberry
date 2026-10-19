import type { Rect } from "./annotations"

export interface PixelBuffer {
  width: number
  height: number
  data: Uint8ClampedArray
}

export const BLUR_BLOCK_SIZE = 14

/** Blocks scale with the screenshot: fine blocks over hi-DPI text can be reversed by matching fonts. */
export function blurBlockSize(imageWidth: number): number {
  return Math.max(BLUR_BLOCK_SIZE, Math.round(imageWidth / 60))
}

/**
 * Irreversibly hides an area: every block becomes the average of its pixels. Works in place on
 * RGBA data, so the exported PNG never contains the original pixels.
 */
export function pixelate(image: PixelBuffer, rect: Rect, blockSize = BLUR_BLOCK_SIZE): void {
  const left = Math.max(0, Math.floor(rect.x))
  const top = Math.max(0, Math.floor(rect.y))
  const right = Math.min(image.width, Math.ceil(rect.x + rect.width))
  const bottom = Math.min(image.height, Math.ceil(rect.y + rect.height))

  for (let blockY = top; blockY < bottom; blockY += blockSize) {
    for (let blockX = left; blockX < right; blockX += blockSize) {
      const endX = Math.min(blockX + blockSize, right)
      const endY = Math.min(blockY + blockSize, bottom)
      const sum = [0, 0, 0, 0]
      let count = 0
      for (let y = blockY; y < endY; y++) {
        for (let x = blockX; x < endX; x++) {
          const offset = (y * image.width + x) * 4
          for (let channel = 0; channel < 4; channel++) sum[channel] = (sum[channel] ?? 0) + (image.data[offset + channel] ?? 0)
          count += 1
        }
      }
      const average = sum.map((total) => Math.round(total / count))
      for (let y = blockY; y < endY; y++) {
        for (let x = blockX; x < endX; x++) image.data.set(average, (y * image.width + x) * 4)
      }
    }
  }
}
