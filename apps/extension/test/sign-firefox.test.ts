import { describe, expect, test } from "bun:test"
import { missingKeys, PREPARE_COMMANDS, signArgs } from "../scripts/sign-firefox"

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
      ".output/bugberry-0.2.0-review-sources.zip",
    ])
  })

  test("names the API keys that are missing", () => {
    expect(missingKeys({})).toEqual(["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"])
    expect(missingKeys({ WEB_EXT_API_KEY: "user:1:2", WEB_EXT_API_SECRET: "  " })).toEqual(["WEB_EXT_API_SECRET"])
    expect(missingKeys({ WEB_EXT_API_KEY: "user:1:2", WEB_EXT_API_SECRET: "s3cret" })).toEqual([])
  })
})

test("the sources zip uploaded is the reviewed one, made after WXT's (which would carry the private key)", () => {
  expect(PREPARE_COMMANDS).toEqual([
    ["bun", "run", "zip:firefox"],
    ["bun", "run", "zip:sources"],
  ])
})
