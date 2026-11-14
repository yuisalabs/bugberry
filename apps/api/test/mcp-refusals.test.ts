import { describe, expect, test } from "bun:test"
import { createRefusals } from "../src/mcp/refusals"

function clock() {
  let at = 1_000_000
  return { now: () => at, pass: (ms: number) => (at += ms) }
}

describe("createRefusals", () => {
  test("a token that failed sign-in is refused from memory for ten seconds", () => {
    const time = clock()
    const refusals = createRefusals({ now: time.now })
    expect(refusals.recall("fdb_revoked", "203.0.113.1")).toBeNull()
    refusals.unauthorized("fdb_revoked", "203.0.113.1")
    expect(refusals.recall("fdb_revoked", "203.0.113.1")).toBe(401)
    expect(refusals.recall("fdb_other", "203.0.113.1")).toBeNull()
    time.pass(9_999)
    expect(refusals.recall("fdb_revoked", "203.0.113.1")).toBe(401)
    time.pass(1)
    expect(refusals.recall("fdb_revoked", "203.0.113.1")).toBeNull()
  })

  test("a person past their calls a minute is refused from memory for five seconds", () => {
    const time = clock()
    const refusals = createRefusals({ now: time.now })
    refusals.limited("fdb_busy")
    expect(refusals.recall("fdb_busy", "203.0.113.1")).toBe(429)
    time.pass(5_000)
    expect(refusals.recall("fdb_busy", "203.0.113.1")).toBeNull()
  })

  test("past its failed sign-ins a minute, an address is refused whatever token it sends", () => {
    const time = clock()
    const refusals = createRefusals({ now: time.now, failedSignInsPerIp: 3 })
    for (const token of ["fdb_a", "fdb_b", "fdb_c"]) refusals.unauthorized(token, "203.0.113.1")
    expect(refusals.recall("fdb_new", "203.0.113.1")).toBeNull()
    refusals.unauthorized("fdb_d", "203.0.113.1")
    expect(refusals.recall("fdb_new", "203.0.113.1")).toBe(429)
    expect(refusals.recall("fdb_new", "203.0.113.2")).toBeNull()
    // The minute runs from the address's first failure.
    time.pass(60_000)
    expect(refusals.recall("fdb_new", "203.0.113.1")).toBeNull()
  })

  test("failed OAuth tokens are not added up per address, since many people's AI apps call from the same ones", () => {
    const refusals = createRefusals({ failedSignInsPerIp: 1 })
    for (const token of ["eyJhbGciOiJFZERTQSJ9.one.sig", "eyJhbGciOiJFZERTQSJ9.two.sig", "eyJhbGciOiJFZERTQSJ9.three.sig"]) {
      refusals.unauthorized(token, "203.0.113.1")
    }
    expect(refusals.recall("eyJhbGciOiJFZERTQSJ9.new.sig", "203.0.113.1")).toBeNull()
    // Each one is still remembered by itself.
    expect(refusals.recall("eyJhbGciOiJFZERTQSJ9.one.sig", "203.0.113.1")).toBe(401)
  })

  test("failures without a known address are not added up, so they cannot shut everyone out", () => {
    const refusals = createRefusals({ failedSignInsPerIp: 1 })
    for (const token of ["fdb_a", "fdb_b", "fdb_c"]) refusals.unauthorized(token, "unknown")
    expect(refusals.recall("fdb_new", "unknown")).toBeNull()
  })

  test("a refusal from before the clock was set back is forgotten, so it cannot outlive its seconds", () => {
    const time = clock()
    const refusals = createRefusals({ now: time.now, failedSignInsPerIp: 1 })
    refusals.unauthorized("fdb_a", "203.0.113.1")
    refusals.unauthorized("fdb_b", "203.0.113.1")
    expect(refusals.recall("fdb_a", "203.0.113.1")).toBe(429)
    time.pass(-3_600_000)
    expect(refusals.recall("fdb_a", "203.0.113.1")).toBeNull()
  })

  test("it remembers a bounded number of tokens, the oldest going first", () => {
    const refusals = createRefusals({ maxKeys: 2 })
    for (const token of ["fdb_a", "fdb_b", "fdb_c"]) refusals.limited(token)
    expect(["fdb_a", "fdb_b", "fdb_c"].map((token) => refusals.recall(token, "unknown"))).toEqual([null, 429, 429])
  })
})
