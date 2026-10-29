import { describe, expect, test } from "bun:test"
import { plausibleJoinValue } from "../src/features/workspaces/join-value"

describe("plausibleJoinValue", () => {
  test("only a whole code or a link is worth a lookup", () => {
    expect(plausibleJoinValue("7KX")).toBe(false)
    expect(plausibleJoinValue("7KX-29")).toBe(false)
    expect(plausibleJoinValue("7KX-29QF")).toBe(true)
    expect(plausibleJoinValue(" 7kx 29qf ")).toBe(true)
    expect(plausibleJoinValue("https://bugberry.kantor.com/invite/abc_DEF")).toBe(true)
    expect(plausibleJoinValue("https://bugberry.kantor.com/join/7KX-29QF")).toBe(true)
    expect(plausibleJoinValue("hello world")).toBe(false)
    expect(plausibleJoinValue("")).toBe(false)
  })
})
