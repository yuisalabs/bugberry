/** The address's domain, lower-cased, or null when it has none. */
export function emailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase()
  const at = normalized.lastIndexOf("@")
  return at > 0 && at < normalized.length - 1 ? normalized.slice(at + 1) : null
}

/**
 * Providers anyone can sign up with. Their users share a domain but not a company, so "Internal"
 * (everyone at the reporter's domain) never applies to them. Add providers here as they turn up.
 */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.id",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "aol.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "yandex.com",
  "yandex.ru",
  "mail.com",
  "mail.ru",
  "zoho.com",
  "tutanota.com",
  "fastmail.com",
  "hey.com",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "naver.com",
  "daum.net",
  "web.de",
  "t-online.de",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "libero.it",
  "seznam.cz",
  "rediffmail.com",
  "hotmail.co.uk",
  "hotmail.co.id",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.it",
  "live.co.uk",
  "live.fr",
  "live.nl",
  "outlook.co.id",
  "outlook.fr",
  "outlook.de",
  "outlook.jp",
  "yahoo.co.jp",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.com.sg",
  "yahoo.com.au",
  "ymail.co.id",
  "icloud.co",
  // Public inboxes: anyone can read their mail, so anyone could sign up "at" them.
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "temp-mail.org",
  "yopmail.com",
  "sharklasers.com",
  "trashmail.com",
  "getnada.com",
])

/** True when "Internal" can apply: the address has a domain that belongs to an organisation. */
export function canUseInternal(email: string): boolean {
  const domain = emailDomain(email)
  return domain !== null && !FREE_EMAIL_DOMAINS.has(domain)
}

/** The access levels a report can have; "internal" only when it can reach a company domain. */
export function visibilityChoices(internalAllowed: boolean): Array<"workspace" | "internal" | "public"> {
  return internalAllowed ? ["workspace", "internal", "public"] : ["workspace", "public"]
}

/** The access levels a reporter with this address can choose. */
export function visibilityOptions(email: string): Array<"workspace" | "internal" | "public"> {
  return visibilityChoices(canUseInternal(email))
}
