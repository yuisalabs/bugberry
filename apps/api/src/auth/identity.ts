import { emailDomain } from "./policy"

/** Better Auth 1.7 takes the account id from `data.id` (the raw profile), never from `user`. */
export type ProviderUser = {
  name: string
  email: string
  image?: string
  emailVerified: boolean
}

export interface GithubEmail {
  email: string
  primary: boolean
  verified: boolean
}

/**
 * A verified address in an allowed domain first (many developers keep a personal primary and add the
 * work address), else the verified primary. Unverified addresses are never used.
 */
export function pickGithubEmail(
  emails: readonly GithubEmail[],
  allowedDomains: readonly string[],
): { email: string; verified: boolean } | null {
  const verified = emails.filter((entry) => entry.verified)
  const allowed = verified.find((entry) => {
    const domain = emailDomain(entry.email)
    return domain !== null && allowedDomains.includes(domain)
  })
  const chosen = allowed ?? verified.find((entry) => entry.primary)
  return chosen ? { email: chosen.email.toLowerCase(), verified: true } : null
}

async function getJson(fetcher: typeof fetch, url: string, accessToken: string): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "user-agent": "BugBerry" },
  })
  if (!response.ok) return null
  return response.json()
}

/** Better Auth's own GitHub lookup trusts the public profile email; this one only uses verified ones. */
export async function githubUserInfo(
  token: { accessToken?: string },
  allowedDomains: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<{ user: ProviderUser; data: { id: string } & Record<string, unknown> } | null> {
  if (!token.accessToken) return null
  const profile = (await getJson(fetcher, "https://api.github.com/user", token.accessToken)) as {
    id?: number | string
    login?: string
    name?: string | null
    avatar_url?: string | null
  } | null
  const emails = (await getJson(fetcher, "https://api.github.com/user/emails", token.accessToken)) as GithubEmail[] | null
  if (!profile?.id || !Array.isArray(emails)) return null
  // No verified address: report the primary as unverified, so sign-in says "verify your email" instead of
  // a generic failure. It is never used to sign in (validateUserInfo requires a verified email).
  const fallback = emails.find((entry) => entry.primary) ?? emails[0]
  const picked = pickGithubEmail(emails, allowedDomains) ?? (fallback ? { email: fallback.email.toLowerCase(), verified: false } : null)
  if (!picked) return null
  return {
    user: {
      name: profile.name || profile.login || picked.email,
      email: picked.email,
      ...(profile.avatar_url ? { image: profile.avatar_url } : {}),
      emailVerified: picked.verified,
    },
    data: { ...profile, id: String(profile.id) },
  }
}

/**
 * GitLab's REST user endpoint has no email_verified, so every user would look unverified; the OIDC
 * userinfo endpoint has it, on gitlab.com and on self-hosted instances alike.
 */
export async function gitlabUserInfo(
  token: { accessToken?: string },
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<{ user: ProviderUser; data: { id: string } & Record<string, unknown> } | null> {
  if (!token.accessToken) return null
  const claims = (await getJson(fetcher, `${baseUrl}/oauth/userinfo`, token.accessToken)) as {
    sub?: string | number
    name?: string
    nickname?: string
    email?: string
    email_verified?: boolean
    picture?: string
  } | null
  if (!claims?.sub || !claims.email) return null
  return {
    user: {
      name: claims.name || claims.nickname || claims.email,
      email: claims.email.toLowerCase(),
      ...(claims.picture ? { image: claims.picture } : {}),
      emailVerified: claims.email_verified === true,
    },
    data: { ...claims, id: String(claims.sub) },
  }
}
