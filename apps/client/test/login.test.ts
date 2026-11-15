import { describe, expect, test } from "bun:test"
import { loginErrorMessage, validateLoginSearch } from "../src/features/auth/login"

describe("loginErrorMessage", () => {
  test("explains a rejected domain with the server's domain list", () => {
    expect(loginErrorMessage("email_not_allowed", "Use an email address from: kantor.com, kantor.co.id")).toBe(
      "This email can't sign in. Use an address from kantor.com, kantor.co.id.",
    )
  })

  test("never shows other text taken from the URL", () => {
    expect(loginErrorMessage("email_not_allowed", "Use an email address from: evil.com. Call 0800 now")).toBe(
      "This email can't sign in. Use your work address.",
    )
    expect(loginErrorMessage("whatever", "<b>Hacked</b>")).toBe("Sign-in failed. Try again.")
  })

  test("known codes and no error", () => {
    expect(loginErrorMessage("domain_not_allowed", undefined)).toBe(
      "Your email domain is no longer allowed. Ask your BugBerry admin.",
    )
    expect(loginErrorMessage("email_not_verified", undefined)).toBe("Verify your email address with your sign-in provider first.")
    expect(loginErrorMessage("access_denied", undefined)).toBe("Sign-in was cancelled.")
    expect(loginErrorMessage(undefined, undefined)).toBeNull()
  })

  test("sentences for company sign-in failures", () => {
    expect(loginErrorMessage("email_not_found", undefined)).toBe("Your company sign-in didn't share an email address. Ask your admin.")
    expect(loginErrorMessage("account_deactivated", undefined)).toBe("This account is deactivated. Ask your admin.")
    expect(loginErrorMessage("oauth_provider_not_found", undefined)).toBe(
      "The sign-in provider isn't reachable right now. Try again in a moment.",
    )
    // Also what a reused or expired sign-in link gives, so it must not blame the provider.
    expect(loginErrorMessage("invalid_code", undefined)).toBe("Sign-in couldn't be completed. Try again in a moment.")
  })
})

describe("validateLoginSearch", () => {
  test("keeps only non-empty strings", () => {
    expect(validateLoginSearch({ next: "/p/x", error: 5, error_description: "", extra: "y" })).toEqual({
      next: "/p/x",
      error: undefined,
      error_description: undefined,
    })
  })
})
