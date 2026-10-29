export interface LoginSearch {
  next?: string
  error?: string
  error_description?: string
}

const optionalString = (value: unknown) => (typeof value === "string" && value ? value : undefined)

export function validateLoginSearch(search: Record<string, unknown>): LoginSearch {
  return {
    next: optionalString(search.next),
    error: optionalString(search.error),
    error_description: optionalString(search.error_description),
  }
}

/** The server's exact wording for a rejected domain (see createAuth); other URL text is ignored. */
const DOMAIN_LIST = /^Use an email address from: ([a-z0-9.-]+(?:, [a-z0-9.-]+)*)$/

/** Better Auth sends OAuth failures back as `/login?error=<code>&error_description=<text>`. */
export function loginErrorMessage(code: string | undefined, description: string | undefined): string | null {
  if (!code) return null
  switch (code) {
    case "email_not_allowed": {
      const domains = description?.match(DOMAIN_LIST)?.[1]
      return domains
        ? `This email can't sign in. Use an address from ${domains}.`
        : "This email can't sign in. Use your work address."
    }
    case "domain_not_allowed":
      return "Your email domain is no longer allowed. Ask your BugBerry admin."
    case "email_not_verified":
      return "Verify your email address with your sign-in provider first."
    case "access_denied":
      return "Sign-in was cancelled."
    default:
      return "Sign-in failed. Try again."
  }
}
