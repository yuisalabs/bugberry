import { describe, expect, test } from "bun:test"
import { commentParts, type Mentionable, mentionLabel, mentionQuery, suggestions, toEditable, toStored } from "../src/lib/mentions"

const ana: Mentionable = { id: "u1", name: "Ana", email: "ana@kantor.test" }
const budi: Mentionable = { id: "u2", name: "Budi Santoso", email: "budi@kantor.test" }
const banu: Mentionable = { id: "u3", name: "Banu", email: "abudi@kantor.test" }

describe("mentionQuery", () => {
  test("finds the @word being typed at the caret", () => {
    expect(mentionQuery("hi @bu", 6)).toEqual({ start: 3, query: "bu" })
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" })
    expect(mentionQuery("line\n@an.b-c", 12)).toEqual({ start: 5, query: "an.b-c" })
  })

  test("ignores emails, finished words and text after the caret", () => {
    expect(mentionQuery("mail@bu", 7)).toBeNull()
    expect(mentionQuery("hi @bu ", 7)).toBeNull()
    expect(mentionQuery("hi @bu", 2)).toBeNull()
  })
})

describe("suggestions", () => {
  test("matches names or emails, names starting with the query first", () => {
    expect(suggestions([ana, banu, budi], "bu")).toEqual([budi, banu])
    expect(suggestions([ana, banu, budi], "KANTOR")).toEqual([ana, banu, budi])
    expect(suggestions([ana, banu, budi], "")).toEqual([ana, banu, budi])
    expect(suggestions([ana, banu, budi], "", 2)).toEqual([ana, banu])
    expect(suggestions([ana, banu, budi], "zz")).toEqual([])
  })
})

describe("stored and editable text", () => {
  test("round trip with two people and a name containing a space", () => {
    const stored = toStored("@Budi Santoso dan @Ana, cek ya", [ana, budi])
    expect(stored).toBe("@[user:u2] dan @[user:u1], cek ya")
    const names = new Map([
      ["u1", "Ana"],
      ["u2", "Budi Santoso"],
    ])
    const editable = toEditable(stored, names)
    expect(editable.text).toBe("@Budi Santoso dan @Ana, cek ya")
    expect(editable.picked.map((person) => person.id).sort()).toEqual(["u1", "u2"])
    expect(toStored(editable.text, editable.picked)).toBe(stored)
  })

  test("only picked people become tokens, and a longer name wins", () => {
    const anaMaria = { id: "u4", name: "Ana Maria", email: "" }
    expect(toStored("@Ana Maria and @Ana", [ana, anaMaria])).toBe("@[user:u4] and @[user:u1]")
    expect(toStored("@Anabel and @Citra", [ana])).toBe("@Anabel and @Citra")
  })
})

describe("people who share a name", () => {
  const budiA = { id: "u5", name: "Budi", email: "budi.a@kantor.test" }
  const budiB = { id: "u6", name: "Budi", email: "budi.b@kantor.test" }
  const people = [budiA, budiB, ana]

  test("get labels that tell them apart, and each mention keeps its person", () => {
    expect(mentionLabel(budiA, people)).toBe("Budi (budi.a)")
    expect(mentionLabel(ana, people)).toBe("Ana")
    const picked = [budiA, budiB].map((person) => ({ ...person, label: mentionLabel(person, people) }))
    expect(toStored("@Budi (budi.b) dan @Budi (budi.a)", picked)).toBe("@[user:u6] dan @[user:u5]")
  })

  test("keep their labels when a comment is edited", () => {
    const names = new Map([
      ["u5", "Budi"],
      ["u6", "Budi"],
    ])
    const editable = toEditable("@[user:u6] dan @[user:u5]", names, people)
    expect(editable.text).toBe("@Budi (budi.b) dan @Budi (budi.a)")
    expect(toStored(editable.text, editable.picked)).toBe("@[user:u6] dan @[user:u5]")
  })
})

describe("commentParts", () => {
  test("splits text and mentions, unknown ids are null", () => {
    expect(commentParts("hi @[user:u1] and @[user:x]!", new Map([["u1", "Ana"]]))).toEqual([
      { text: "hi " },
      { mention: { id: "u1", name: "Ana" } },
      { text: " and " },
      { mention: null },
      { text: "!" },
    ])
    expect(commentParts("plain", new Map())).toEqual([{ text: "plain" }])
  })
})
