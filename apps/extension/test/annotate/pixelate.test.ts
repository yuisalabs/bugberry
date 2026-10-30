import { describe, expect, test } from "bun:test"
import { type PixelBuffer, pixelate } from "../../lib/annotate/pixelate"

/** A checkerboard: every pixel differs from its neighbours, like small text. */
function checkerboard(width: number, height: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = (x + y) % 2 === 0 ? 0 : 255
      data.set([value, value, value, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

const pixel = (image: PixelBuffer, x: number, y: number) =>
  Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4))

describe("pixelate", () => {
  test("replaces each block with its average colour, destroying detail", () => {
    const image = checkerboard(8, 8)
    pixelate(image, { x: 0, y: 0, width: 4, height: 4 }, 4)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(pixel(image, x, y)).toEqual([128, 128, 128, 255])
  })

  test("leaves pixels outside the area untouched", () => {
    const image = checkerboard(8, 8)
    pixelate(image, { x: 0, y: 0, width: 4, height: 4 }, 4)
    expect(pixel(image, 5, 5)).toEqual([0, 0, 0, 255])
    expect(pixel(image, 4, 5)).toEqual([255, 255, 255, 255])
  })

  test("clamps areas that extend past the image", () => {
    const image = checkerboard(6, 6)
    expect(() => pixelate(image, { x: 4, y: 4, width: 50, height: 50 }, 4)).not.toThrow()
    expect(pixel(image, 4, 4)).toEqual(pixel(image, 5, 5))
  })
})

describe("blurBlockSize", () => {
  test("grows with the screenshot so hi-DPI text cannot be recovered from fine blocks", async () => {
    const { blurBlockSize } = await import("../../lib/annotate/pixelate")
    expect(blurBlockSize(600)).toBe(14)
    expect(blurBlockSize(1440)).toBe(24)
    expect(blurBlockSize(2880)).toBe(48)
  })
})
