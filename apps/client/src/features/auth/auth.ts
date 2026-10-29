import { safeNext } from "../../lib/urls"

export interface AuthDeps {
  fetch(url: string, init: RequestInit): Promise<Response>
  assign(url: string): void
}

const browserDeps: AuthDeps = {
  fetch: (url, init) => fetch(url, init),
  assign: (url) => window.location.assign(url),
}

const JSON_HEADERS = { "content-type": "application/json" }

export type SocialProvider = "github" | "gitlab" | "google"

const PROVIDER_NAMES: Record<SocialProvider, string> = { github: "GitHub", gitlab: "GitLab", google: "Google" }

/** Starts sign-in with a provider through Better Auth; failures come back to /login as `?error=…`. */
export async function signInWithProvider(
  provider: SocialProvider,
  next: unknown,
  deps: AuthDeps = browserDeps,
): Promise<void> {
  const target = safeNext(next)
  const errorCallbackURL = target === "/app" ? "/login" : `/login?next=${encodeURIComponent(target)}`
  const response = await deps.fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ provider, callbackURL: target, errorCallbackURL }),
  })
  const body = (await response.json().catch(() => null)) as { url?: unknown; message?: unknown } | null
  if (!response.ok || typeof body?.url !== "string") {
    throw new Error(typeof body?.message === "string" ? body.message : `${PROVIDER_NAMES[provider]} sign-in could not start`)
  }
  deps.assign(body.url)
}

/** Emails a sign-in code. The answer is the same whether or not the address may sign in. */
export async function sendLoginCode(email: string, deps: AuthDeps = browserDeps): Promise<void> {
  let response: Response
  try {
    response = await deps.fetch("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, type: "sign-in" }),
    })
  } catch {
    throw new Error("BugBerry can't be reached. Check your connection and try again.")
  }
  if (response.status === 429) throw new Error("Too many codes requested. Wait a few minutes and try again.")
  if (!response.ok) throw new Error("The code could not be sent. Try again.")
}

/** Signs in with an emailed code, then continues to where the person was going. */
export async function verifyLoginCode(email: string, code: string, next: unknown, deps: AuthDeps = browserDeps): Promise<void> {
  let response: Response
  try {
    response = await deps.fetch("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, otp: code }),
    })
  } catch {
    throw new Error("BugBerry can't be reached. Check your connection and try again.")
  }
  if (response.status === 429) throw new Error("Too many attempts. Wait a few minutes and try again.")
  if (!response.ok) throw new Error("That code is wrong or has expired. Request a new one.")
  deps.assign(safeNext(next))
}

export async function signOut(deps: AuthDeps = browserDeps): Promise<void> {
  let response: Response
  try {
    response = await deps.fetch("/api/auth/sign-out", { method: "POST", headers: JSON_HEADERS, body: "{}" })
  } catch {
    throw new Error("Couldn't sign out: BugBerry can't be reached. Try again.")
  }
  // Treating a refusal as success would send the person to /login while the session stays alive.
  if (!response.ok) throw new Error("Couldn't sign out. Try again.")
}
