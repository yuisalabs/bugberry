import { expect, test } from "bun:test"

test("the bar's page never scrolls: a scrollbar in the frame would push the bar about and flicker", async () => {
  const html = await Bun.file(new URL("../entrypoints/recorder-bar/index.html", import.meta.url)).text()
  expect(html).toMatch(/<html[^>]*overflow:\s*hidden/)
  expect(html).toMatch(/<body[^>]*overflow-hidden/)
})
