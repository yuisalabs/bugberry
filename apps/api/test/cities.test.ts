import { describe, expect, test } from "bun:test"
import { nearestCity } from "../src/modules/reports/cities"

describe("nearestCity", () => {
  test("names the closest city with its country", () => {
    expect(nearestCity(-6.21, 106.85)).toBe("Jakarta, Indonesia")
    expect(nearestCity(51.51, -0.13)).toBe("London, United Kingdom")
  })

  test("nothing within 100 km, such as the open sea, gives null", () => {
    expect(nearestCity(0, -140)).toBeNull()
  })

  test("a list can be given instead of the bundled one", () => {
    const cities = [
      { name: "Bandung", country: "Indonesia", latitude: -6.92, longitude: 107.61 },
      { name: "Bogor", country: "Indonesia", latitude: -6.6, longitude: 106.8 },
    ]
    expect(nearestCity(-6.9, 107.6, cities)).toBe("Bandung, Indonesia")
  })
})
