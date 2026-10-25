export type AiErrorCode = "key_rejected" | "quota" | "model_not_found" | "unreachable" | "unusable_answer" | "busy" | "provider_error"

/** A write-up that failed, by what the reporter can do about it. `detail` is the provider's own message. */
export class AiWriteError extends Error {
  override name = "AiWriteError"
  constructor(
    readonly code: AiErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

/** What the reporter reads: what happened and who can fix it, the team's admin or the reporter. */
export function aiErrorText(error: AiWriteError, ctx: { path: "team" | "personal"; model: string }): string {
  switch (error.code) {
    case "key_rejected":
      return ctx.path === "team"
        ? "The AI key was rejected. Update it in Settings → AI (ask your admin)."
        : "The AI key was rejected. Update it in the extension's settings."
    case "quota":
      return "Your AI provider says the quota is used up."
    case "model_not_found":
      return `The model "${ctx.model}" wasn't found at this provider.`
    case "unreachable":
      return "The AI server didn't answer. Try again."
    case "unusable_answer":
      return "The AI's answer couldn't be used. Try again."
    case "busy":
      return "The AI provider is busy. Try again in a moment."
    case "provider_error":
      return `The AI provider returned an error: ${(error.detail ?? "unknown").slice(0, 200)}.`
  }
}
