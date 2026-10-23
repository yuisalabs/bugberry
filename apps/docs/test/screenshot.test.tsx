import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Screenshot } from "@/components/screenshot"

describe("Screenshot", () => {
  test("serves the image from under the /docs base path", () => {
    const html = renderToStaticMarkup(<Screenshot src="/screenshots/x/y.png" alt="Popup" width={380} />)
    expect(html).toContain('src="/docs/screenshots/x/y.png"')
    expect(html).toContain('alt="Popup"')
    expect(html).toContain('width="380"')
    expect(html).not.toContain('loading="eager"')
  })
})
