import { describe, expect, test } from "bun:test"
import { currentCoordinates, locationForSend, toggleCity } from "../../lib/review/location"

/** A geolocation that answers once with a position or an error code (1 = denied, 3 = timeout). */
function geolocation(answer: { latitude: number; longitude: number } | { code: number }) {
  const asked: PositionOptions[] = []
  return {
    asked,
    getCurrentPosition(success: PositionCallback, failure?: PositionErrorCallback | null, options?: PositionOptions) {
      if (options) asked.push(options)
      if ("code" in answer) failure?.({ code: answer.code, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
      else success({ coords: answer, timestamp: 0 } as unknown as GeolocationPosition)
    },
  }
}

describe("currentCoordinates", () => {
  test("rounds to two decimals, about a kilometre", async () => {
    const geo = geolocation({ latitude: -6.208763, longitude: 106.845599 })
    expect(await currentCoordinates(geo)).toEqual({ latitude: -6.21, longitude: 106.85 })
    expect(geo.asked[0]).toMatchObject({ timeout: 10_000 })
  })

  test("a refusal is denied; a timeout or another failure is nothing", async () => {
    expect(await currentCoordinates(geolocation({ code: 1 }))).toBe("denied")
    expect(await currentCoordinates(geolocation({ code: 3 }))).toBeNull()
    expect(await currentCoordinates(geolocation({ code: 2 }))).toBeNull()
  })
})

describe("toggleCity", () => {
  test("turning it on asks the browser once and stays on when allowed", async () => {
    let asks = 0
    const result = await toggleCity(true, async () => {
      asks += 1
      return { latitude: 1, longitude: 2 }
    })
    expect(result).toEqual({ includeCity: true, note: null })
    expect(asks).toBe(1)
  })

  test("a denied location sends the report without a city", async () => {
    expect(await toggleCity(true, async () => "denied")).toEqual({
      includeCity: false,
      note: "Location permission was denied",
    })
  })

  test("turning it off asks nothing", async () => {
    expect(await toggleCity(false, async () => Promise.reject(new Error("asked")))).toEqual({ includeCity: false, note: null })
  })
})

describe("locationForSend", () => {
  test("a denied location sends the report without a city and turns the switch off", async () => {
    expect(await locationForSend(true, async () => "denied")).toEqual({
      location: null,
      includeCity: false,
      note: "Location permission was denied",
    })
  })

  test("a position is sent; a timeout sends no city but keeps the switch", async () => {
    expect(await locationForSend(true, async () => ({ latitude: 1, longitude: 2 }))).toEqual({
      location: { latitude: 1, longitude: 2 },
      includeCity: true,
      note: null,
    })
    expect(await locationForSend(true, async () => null)).toEqual({ location: null, includeCity: true, note: null })
  })

  test("with the switch off, nothing is asked", async () => {
    expect(await locationForSend(false, async () => Promise.reject(new Error("asked")))).toEqual({
      location: null,
      includeCity: false,
      note: null,
    })
  })
})
