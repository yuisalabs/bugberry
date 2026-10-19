import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { indonesianCopy } from "../../../scripts/indonesian-copy"

test("the server's messages are English", () => {
  expect(indonesianCopy([fileURLToPath(new URL("../src", import.meta.url))])).toEqual([])
})
