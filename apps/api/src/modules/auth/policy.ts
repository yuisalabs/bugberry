import { emailDomain } from "@bugberry/shared"

export { emailDomain }

/**
 * An empty list lets every address in. Otherwise exact domain match only: subdomains and look-alike
 * domains are rejected.
 */
export function isEmailAllowed(email: string, allowedDomains: readonly string[]): boolean {
  const domain = emailDomain(email)
  return domain !== null && (allowedDomains.length === 0 || allowedDomains.includes(domain))
}
