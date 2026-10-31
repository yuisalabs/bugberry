import { describe, expect, test } from "bun:test"
import { pickCustomFields } from "../../lib/recording/custom-fields"

const ok = (fields: Record<string, unknown>) => ({ fields, error: null, droppedKeys: 0 })
const none = { fields: null, error: null, droppedKeys: 0 }
const failed = { fields: null, error: "callback threw: boom", droppedKeys: 0 }
const page = (id: string, metadata: { fields: Record<string, unknown> | null; error: string | null; droppedKeys: number }, url: string) => ({ documentId: id, events: [], incomplete: [], metadata, url })

describe("pickCustomFields", () => {
  test("rule 1: the final page's fields win, with no url", () => {
    expect(pickCustomFields({ metadata: ok({ step: 3 }) }, [page("p1", ok({ step: 1 }), "https://shop.test/a")], 90)).toEqual({ ...ok({ step: 3 }), url: null, t: 90 })
  })
  test("rule 2: no SDK on the final page falls back to the latest earlier page that had fields", () => {
    const earlier = [page("p1", ok({ step: 1 }), "https://shop.test/a"), page("p2", ok({ step: 2 }), "https://shop.test/b"), page("p3", none, "https://shop.test/c")]
    expect(pickCustomFields({ metadata: none }, earlier, 90)).toEqual({ ...ok({ step: 2 }), url: "https://shop.test/b", t: 90 })
  })
  test("rule 3: a failed final page keeps the earlier fields and reports its own error", () => {
    expect(pickCustomFields({ metadata: failed }, [page("p1", ok({ step: 1 }), "https://shop.test/a")], 90)).toEqual({ fields: { step: 1 }, error: "callback threw: boom", droppedKeys: 0, url: "https://shop.test/a", t: 90 })
  })
  test("a failed final page with nothing earlier still reports the error", () => {
    expect(pickCustomFields({ metadata: failed }, [], 90)).toEqual({ ...failed, url: null, t: 90 })
  })
  test("rule 4: nothing anywhere gives undefined", () => {
    expect(pickCustomFields({ metadata: none }, [page("p1", none, "https://shop.test/a")], 90)).toBeUndefined()
    expect(pickCustomFields(null, [], 90)).toBeUndefined()
  })
  test("a final page that could not be read falls back to an earlier page", () => {
    expect(pickCustomFields(null, [page("p1", ok({ step: 1 }), "https://shop.test/a")], 90)).toEqual({ ...ok({ step: 1 }), url: "https://shop.test/a", t: 90 })
  })
  test("an earlier page stored by an older version, without metadata, is skipped", () => {
    expect(pickCustomFields({ metadata: none }, [{ documentId: "old", events: [], incomplete: [] }], 90)).toBeUndefined()
  })
})
