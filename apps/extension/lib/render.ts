import { normalizeRect, type Point, type Rect, type Shape } from "./annotations"
import { blurBlockSize, pixelate } from "./pixelate"

function strokeWidth(size: { width: number }) {
  return Math.max(3, Math.round(size.width / 400))
}

function drawArrow(context: CanvasRenderingContext2D, from: Point, to: Point, width: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const head = width * 5
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6))
  context.moveTo(to.x, to.y)
  context.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6))
  context.stroke()
}

/**
 * Draws the screenshot with its annotations. Blur areas are pixelated on the image pixels first,
 * so the exported PNG never contains what was hidden.
 */
export function renderAnnotated(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  size: { width: number; height: number },
  shapes: readonly Shape[],
): void {
  const width = strokeWidth(size)
  context.clearRect(0, 0, size.width, size.height)
  context.drawImage(image, 0, 0, size.width, size.height)

  for (const shape of shapes) {
    if (shape.kind !== "blur") continue
    const region = blurRegion(normalizeRect(shape.from, shape.to), size)
    if (!region) continue
    const pixels = context.getImageData(region.x, region.y, region.width, region.height)
    pixelate(pixels, { x: 0, y: 0, width: region.width, height: region.height }, blurBlockSize(size.width))
    context.putImageData(pixels, region.x, region.y)
  }

  context.lineCap = "round"
  context.lineJoin = "round"
  context.lineWidth = width
  for (const shape of shapes) {
    if (shape.kind === "blur") continue
    context.strokeStyle = shape.color
    context.fillStyle = shape.color
    if (shape.kind === "pen") {
      context.beginPath()
      shape.points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)))
      context.stroke()
    } else if (shape.kind === "box") {
      const rect = normalizeRect(shape.from, shape.to)
      context.strokeRect(rect.x, rect.y, rect.width, rect.height)
    } else if (shape.kind === "arrow") {
      drawArrow(context, shape.from, shape.to, width)
    } else if (shape.kind === "text") {
      context.font = `bold ${width * 8}px system-ui, sans-serif`
      context.textBaseline = "top"
      context.lineWidth = Math.max(2, width / 2)
      context.strokeStyle = "#ffffff"
      context.strokeText(shape.text, shape.at.x, shape.at.y)
      context.fillText(shape.text, shape.at.x, shape.at.y)
      context.lineWidth = width
    }
  }
}

/**
 * The whole pixels a blur rectangle touches, clipped to the image: both edges are rounded outward,
 * so a fractional edge is never left sharp, and nothing past the image is read. Null when outside it.
 */
export function blurRegion(rect: Rect, size: { width: number; height: number }): Rect | null {
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const right = Math.min(size.width, Math.ceil(rect.x + rect.width))
  const bottom = Math.min(size.height, Math.ceil(rect.y + rect.height))
  if (right - x < 1 || bottom - y < 1) return null
  return { x, y, width: right - x, height: bottom - y }
}
