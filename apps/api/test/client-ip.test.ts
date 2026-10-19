import { describe, expect, test } from "bun:test"
import { clientIpSource } from "../src/modules/share"

describe("clientIpSource", () => {
  test("names where rate limits read the client IP from, for the startup log", () => {
    expect(clientIpSource(0)).toMatch(/TRUST_PROXY=true/)
    expect(clientIpSource(1)).toMatch(/X-Forwarded-For.*1 trusted proxy hop/)
    expect(clientIpSource(2)).toMatch(/2 trusted proxy hops/)
  })
})
