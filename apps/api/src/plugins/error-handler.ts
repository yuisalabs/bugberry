import { Elysia } from "elysia"
import { AppError } from "../lib/errors"

function errorResponse(status: number, body: { code: string; message: string; [field: string]: unknown }): Response {
  return Response.json(body, { status })
}

/** Every error as `{ code, message }`. Returns plain Responses: a typed `status()` here would leak into every route's Eden response type. */
export function errorHandler() {
  return new Elysia({ name: "bugberry.error-handler" }).onError({ as: "global" }, ({ code, error }) => {
    if (error instanceof AppError) {
      return errorResponse(error.status, { ...error.extra, code: error.code, message: error.message })
    }
    if (code === "VALIDATION") {
      return errorResponse(422, {
        code: "validation",
        message: "Invalid request",
        details: error.all.map((issue) => ({ path: issue.path, message: issue.message })),
      })
    }
    if (code === "PARSE") return errorResponse(400, { code: "bad_request", message: "Malformed request body" })
    if (code === "NOT_FOUND") return errorResponse(404, { code: "not_found", message: "Route not found" })
    console.error(error)
    return errorResponse(500, { code: "internal", message: "Internal server error" })
  })
}
