import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { indonesianCopy } from "../../../scripts/indonesian-copy"

test("the dashboard speaks English", () => {
  expect(indonesianCopy([fileURLToPath(new URL("../src", import.meta.url)), fileURLToPath(new URL("../index.html", import.meta.url))])).toEqual([])
})
