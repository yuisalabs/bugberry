import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { mcp } from "@better-auth/mcp"
import { emailOTP, jwt } from "better-auth/plugins"
import type { Config } from "../config"
import type { Db } from "../db/client"
import {
  account,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  session,
  user,
  verification,
} from "../db/schema"
import { createRateLimiter } from "../lib/rate-limit"
import { otpEmail } from "../email/otp-email"
import { createEmailSender, type EmailSender } from "../email/sender"
import { githubUserInfo, gitlabUserInfo } from "./identity"
import { provisionNewUser } from "../workspaces/provision"
import { MCP_SCOPES, mcpResource } from "./mcp-oauth"
import { isEmailAllowed } from "./policy"

type GithubUserInfo = NonNullable<NonNullable<Parameters<typeof betterAuth>[0]["socialProviders"]>["github"]> extends infer P
  ? P extends { getUserInfo?: infer F } ? NonNullable<F> : never
  : never
type GitlabUserInfo = NonNullable<NonNullable<Parameters<typeof betterAuth>[0]["socialProviders"]>["gitlab"]> extends infer P
  ? P extends { getUserInfo?: infer F } ? NonNullable<F> : never
  : never

const OTP_SECONDS = 600
/** An hour: revoking an AI app takes effect at the latest when its last access token expires. */
const ACCESS_TOKEN_SECONDS = 60 * 60
const CODES_PER_ADDRESS = 5

export function createAuth(config: Config, db: Db, options: { email?: EmailSender } = {}) {
  const domainMessage = `Use an email address from: ${config.allowedEmailDomains.join(", ")}`
  const sender = options.email ?? (config.email ? createEmailSender(config.email) : null)
  const gitlabUrl = config.gitlab?.url ?? ""
  const codesPerAddress = createRateLimiter({ limit: CODES_PER_ADDRESS, windowMs: OTP_SECONDS * 1000 })

  return betterAuth({
    baseURL: config.appUrl,
    basePath: "/api/auth",
    secret: config.authSecret,
    trustedOrigins: [config.appUrl],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user,
        session,
        account,
        verification,
        jwks,
        oauthClient,
        oauthResource,
        oauthClientResource,
        oauthRefreshToken,
        oauthAccessToken,
        oauthConsent,
        oauthClientAssertion,
      },
    }),
    socialProviders: {
      ...(config.google && {
        google: {
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          prompt: "select_account" as const,
        },
      }),
      ...(config.github && {
        github: {
          clientId: config.github.clientId,
          clientSecret: config.github.clientSecret,
          // Better Auth types `data` as its own GitHub profile shape; ours is that profile with a string id.
          getUserInfo: async (token: { accessToken?: string }) =>
            (await githubUserInfo(token, config.allowedEmailDomains)) as Awaited<ReturnType<GithubUserInfo>>,
        },
      }),
      ...(config.gitlab && {
        gitlab: {
          clientId: config.gitlab.clientId,
          clientSecret: config.gitlab.clientSecret,
          issuer: config.gitlab.url,
          scope: ["openid", "email", "profile"],
          getUserInfo: async (token: { accessToken?: string }) =>
            (await gitlabUserInfo(token, gitlabUrl)) as Awaited<ReturnType<GitlabUserInfo>>,
        },
      }),
    },
    // One person, one account: a verified email reaches the same user by any sign-in method.
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google", "github", "gitlab", "email-otp"] },
    },
    // Per IP, on top of the per-address limit below; Better Auth enables it in production.
    rateLimit: {
      customRules: {
        "/email-otp/send-verification-otp": { window: OTP_SECONDS, max: 20 },
        "/sign-in/email-otp": { window: OTP_SECONDS, max: 30 },
      },
    },
    hooks: {
      // Refused requests stop here, before Better Auth stores a new code: a stored code would replace the
      // one already emailed (locking the person out) and give an attacker five fresh guesses. The answer
      // is the same success either way, so the form cannot tell who may sign in.
      before: createAuthMiddleware(async (ctx) => {
        // Name and photo change through /api/me, which checks them; Better Auth's own route would take any image URL.
        if (ctx.path === "/update-user") throw new APIError("FORBIDDEN", { message: "Change your profile in Account settings" })
        if (ctx.path !== "/email-otp/send-verification-otp") return
        const body = (ctx.body ?? {}) as { email?: unknown; type?: unknown }
        if (typeof body.email !== "string") return
        const email = body.email.trim().toLowerCase()
        const allowed =
          body.type === "sign-in" && isEmailAllowed(email, config.allowedEmailDomains) && codesPerAddress.consume(email)
        if (!allowed) return ctx.json({ success: true })
      }),
    },
    plugins: [
      // OAuth 2.1 for the MCP server: AI apps register themselves, people approve them on /oauth/consent,
      // and access tokens are JWTs bound to the MCP resource. jwt() signs them and publishes the keys.
      jwt(),
      mcp({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        resource: mcpResource(config),
        scopes: [...MCP_SCOPES],
        clientRegistrationDefaultScopes: [...MCP_SCOPES],
        clientRegistrationAllowedScopes: [...MCP_SCOPES],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // Desktop apps (Claude Code, Cursor) redirect to http://localhost; web apps (Claude.ai) to https.
        clientRegistrationDefaultApplicationType: "infer",
        accessTokenExpiresIn: ACCESS_TOKEN_SECONDS,
      }),
      ...(sender
        ? [
          emailOTP({
            otpLength: 6,
            expiresIn: OTP_SECONDS,
            allowedAttempts: 5,
            // Who may get a code is decided in hooks.before, before a code is even stored.
            async sendVerificationOTP({ email, otp, type }) {
              if (type !== "sign-in") return
              const mail = otpEmail(otp, OTP_SECONDS / 60)
              await sender.send({ to: email, ...mail })
            },
          }),
        ]
        : []),
    ],
    user: {
      // Rejects a provider identity before any user/account row is written.
      validateUserInfo: ({ user: info }) => {
        if (!info.email || !isEmailAllowed(info.email, config.allowedEmailDomains)) {
          return { error: "email_not_allowed", errorDescription: domainMessage }
        }
        if (info.emailVerified !== true) {
          return { error: "email_not_verified", errorDescription: "Your email address is not verified" }
        }
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Second line of defence.
          before: async (data, ctx) => {
            if (!isEmailAllowed(data.email, config.allowedEmailDomains)) {
              throw new APIError("FORBIDDEN", { message: domainMessage })
            }
            // Email-code sign-ups arrive without a name; the address's local part beats a blank one.
            const name = (data.name?.trim() || data.email.split("@")[0] || data.email).slice(0, 80)
            // A photo comes from a sign-in provider or a checked upload, never from what a sign-up form sends.
            const image = ctx?.path === "/sign-in/email-otp" ? null : data.image
            return { data: { ...data, name, image } }
          },
          // Everyone starts in a workspace: their own, unless an invitation is waiting for them.
          after: async (created) => {
            await provisionNewUser(db, created)
          },
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
