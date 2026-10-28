/** Errors thrown by route code; the app's onError turns them into `{ code, message }` responses. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra fields for the response body, beside code and message. */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "AppError"
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message)
export const unauthorized = (message = "Login required") => new AppError(401, "unauthorized", message)
export const forbidden = (message = "You are not allowed to do this") => new AppError(403, "forbidden", message)
export const notFound = (code = "not_found", message = "Not found") => new AppError(404, code, message)
export const conflict = (code: string, message: string) => new AppError(409, code, message)
export const gone = (code: string, message: string) => new AppError(410, code, message)
export const payloadTooLarge = (message = "File is too large") => new AppError(413, "file_too_large", message)
export const unprocessable = (code: string, message: string) => new AppError(422, code, message)
export const tooManyRequests = () => new AppError(429, "rate_limited", "Too many requests, try again later")
