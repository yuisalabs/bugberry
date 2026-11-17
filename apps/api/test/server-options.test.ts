import { describe, expect, test } from "bun:test"
import { serveOptions } from "../src/server-options"
import { testConfig } from "./helpers"

describe("serveOptions", () => {
  test("lets request bodies reach the configured upload limit (Bun's default is 128 MiB)", () => {
    const config = testConfig({ port: 4321, maxUploadBytes: 200 * 1024 * 1024 })
    const options = serveOptions(config)
    expect(options.port).toBe(4321)
    expect(options.maxRequestBodySize).toBeGreaterThan(config.maxUploadBytes)
  })

  test("listens on HOST when it is set, and leaves Bun's default otherwise", () => {
    expect(serveOptions(testConfig({ host: "::" })).hostname).toBe("::")
    expect("hostname" in serveOptions(testConfig({}))).toBe(false)
  })
})
