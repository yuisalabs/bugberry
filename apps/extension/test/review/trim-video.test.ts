import { describe, expect, test } from "bun:test"
import { conversionTrim, lostTracks } from "../../lib/review/trim-video"

describe("conversionTrim", () => {
  test("hands mediabunny the range in seconds", () => {
    expect(conversionTrim({ startMs: 6_000, endMs: 35_500 })).toEqual({ start: 6, end: 35.5 })
  })
})

describe("lostTracks", () => {
  test("nothing lost is no problem", () => {
    expect(lostTracks([])).toBeNull()
  })

  test("a lost audio track is a problem too: the narration must not vanish without a word", () => {
    expect(lostTracks([{ type: "audio", reason: "no_encodable_target_codec" }])).toBe("audio: no_encodable_target_codec")
  })

  test("every lost track is named", () => {
    expect(lostTracks([
      { type: "video", reason: "undecodable_source_codec" },
      { type: "audio", reason: "undecodable_source_codec" },
    ])).toBe("video: undecodable_source_codec, audio: undecodable_source_codec")
  })
})
