import { describe, expect, test } from "bun:test"
import { missingKeys, signArgs } from "../scripts/sign-firefox"

describe("sign-firefox", () => {
  test("signs the Firefox build on AMO's unlisted channel, with its sources", () => {
    expect(signArgs("0.2.0")).toEqual([
      "sign",
      "--channel",
      "unlisted",
      "--source-dir",
      ".output/firefox-mv3",
      "--artifacts-dir",
      ".output",
      "--upload-source-code",
      ".output/bugberryextension-0.2.0-sources.zip",
    ])
  })

  test("names the API keys that are missing", () => {
    expect(missingKeys({})).toEqual(["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"])
    expect(missingKeys({ WEB_EXT_API_KEY: "user:1:2", WEB_EXT_API_SECRET: "  " })).toEqual(["WEB_EXT_API_SECRET"])
    expect(missingKeys({ WEB_EXT_API_KEY: "user:1:2", WEB_EXT_API_SECRET: "s3cret" })).toEqual([])
  })
})
