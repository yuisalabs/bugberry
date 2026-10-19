import { describe, expect, test } from "bun:test"
import { loginErrorMessage, validateLoginSearch } from "../src/lib/login"

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
