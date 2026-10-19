import { describe, expect, test } from "bun:test"
import { matchProject } from "../src"

const projects = [
  { id: "web", urlPatterns: ["*.kantor.com/*"] },
  { id: "admin", urlPatterns: ["https://app.kantor.com/admin/*"] },
  { id: "local", urlPatterns: ["127.0.0.1:4400"] },
  { id: "empty", urlPatterns: ["", "  "] },
]

describe("matchProject", () => {
  test("matches subdomain wildcards but not the bare or look-alike domain", () => {
    expect(matchProject(projects, "https://app.kantor.com/checkout?step=2")?.id).toBe("web")
    expect(matchProject(projects, "https://kantor.com/")).toBeNull()
    expect(matchProject(projects, "https://evilkantor.com/x")).toBeNull()
    expect(matchProject(projects, "https://evil.com/?next=app.kantor.com/x")).toBeNull()
  })

  test("prefers the most specific pattern", () => {
    expect(matchProject(projects, "https://app.kantor.com/admin/users")?.id).toBe("admin")
  })

  test("patterns with a scheme only match that scheme", () => {
    expect(matchProject(projects, "http://app.kantor.com/admin/users")?.id).toBe("web")
  })

  test("a pattern without a path covers the whole host, including its port", () => {
    expect(matchProject(projects, "http://127.0.0.1:4400/")?.id).toBe("local")
    expect(matchProject(projects, "http://127.0.0.1:4400/cart/1")?.id).toBe("local")
    expect(matchProject(projects, "http://127.0.0.1:5000/")).toBeNull()
  })

  test("host matching ignores case; invalid URLs match nothing", () => {
    expect(matchProject(projects, "https://APP.Kantor.com/")?.id).toBe("web")
    expect(matchProject(projects, "not a url")).toBeNull()
  })
})
