import { genericOAuth } from "better-auth/plugins"
import type { OidcConfig } from "../../config"

/** Fixed, so the callback an admin registers at the IdP is always `{APP_URL}/api/auth/callback/oidc`. */
export const OIDC_PROVIDER_ID = "oidc"

/** The Better Auth plugin for the server's one identity provider. */
export function oidcPlugin(oidc: OidcConfig, _startupTimeoutMs?: number) {
  return genericOAuth({
    config: [
      {
        providerId: OIDC_PROVIDER_ID,
        name: oidc.name ?? "SSO",
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
        scopes: ["openid", "email", "profile"],
        pkce: true,
        // Signing out of BugBerry must not sign the person out of everything else at their company.
        disableProviderLogout: true,
        // An IdP without signing keys would have its id tokens read unchecked.
        requireIdTokenVerification: true,
      },
    ],
  })
}
