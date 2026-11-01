import { describe, expect, test } from "bun:test"
import { createStackBudget, withoutSdkFrame } from "../src/stack"

const V8 = "Error\n    at log (https://shop.test/vendor.js:10:5)\n    at pay (https://shop.test/checkout.js:40:3)"
const FIREFOX = "log@https://shop.test/vendor.js:10:5\npay@https://shop.test/checkout.js:40:3"

describe("withoutSdkFrame", () => {
  test("drops the first frame and keeps the header on V8 stacks", () => {
    expect(withoutSdkFrame(V8)).toBe("Error\n    at pay (https://shop.test/checkout.js:40:3)")
  })
  test("drops the first frame on Firefox stacks", () => {
    expect(withoutSdkFrame(FIREFOX)).toBe("pay@https://shop.test/checkout.js:40:3")
  })
  test("undefined, empty, or a header alone give undefined", () => {
    expect(withoutSdkFrame(undefined)).toBeUndefined()
    expect(withoutSdkFrame("")).toBeUndefined()
    expect(withoutSdkFrame("Error")).toBeUndefined()
  })
})

test("createStackBudget allows at most 100 stacks a second", () => {
  let t = 0
  const allow = createStackBudget(() => t, 100)
  const got = Array.from({ length: 101 }, () => allow())
  expect(got.slice(0, 100).every(Boolean)).toBe(true)
  expect(got[100]).toBe(false)
  t = 1000
  expect(allow()).toBe(true)
})
