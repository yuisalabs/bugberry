import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { indonesianCopy } from "../../../scripts/indonesian-copy"

test("the extension speaks English", () => {
  const dirs = ["../entrypoints", "../lib", "../wxt.config.ts"].map((path) => fileURLToPath(new URL(path, import.meta.url)))
  expect(indonesianCopy(dirs)).toEqual([])
})
