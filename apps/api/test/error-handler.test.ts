import { describe, expect, test } from "bun:test"
import { Elysia, t } from "elysia"
import { AppError } from "../src/lib/errors"
import { errorHandler } from "../src/plugins/error-handler"

const app = new Elysia()
  .use(errorHandler())
  .get("/conflict", () => {
    throw new AppError(409, "slug_taken", "Slug is already used by another project", { limit: 3 })
  })
  .post("/echo", ({ body }) => body, { body: t.Object({ name: t.String() }) })
  .get("/boom", () => {
    throw new Error("boom")
  })

const call = (path: string, init?: RequestInit) => app.handle(new Request(`http://localhost${path}`, init))

describe("error handler", () => {
  test("an AppError answers its status, code, message and extra fields", async () => {
    const response = await call("/conflict")
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ limit: 3, code: "slug_taken", message: "Slug is already used by another project" })
  })

  test("a malformed JSON body answers 400 bad_request", async () => {
    const response = await call("/echo", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: "bad_request", message: "Malformed request body" })
  })

  test("an unknown error answers 500 internal", async () => {
    const response = await call("/boom")
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ code: "internal", message: "Internal server error" })
  })

  test("an unknown route answers 404 not_found", async () => {
    const response = await call("/nowhere")
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: "not_found", message: "Route not found" })
  })
})
