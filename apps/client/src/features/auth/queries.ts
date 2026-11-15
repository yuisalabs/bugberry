import { queryOptions } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"
import { fetchOAuthClient } from "./oauth"

/** Which sign-in methods the server enables (GET /api/auth-methods). */
export type SignInMethod = "google" | "github" | "gitlab" | "oidc" | "email"

/** Public settings the dashboard reads before anyone signs in. */
export interface ClientConfig {
  extensionInstallUrl: string | null
  maxUploadMb: number
  /** False on self-hosted servers: the marketing pages go to sign-in there. */
  publicSite: boolean
  /** True on a company server: joining a workspace by email domain happens by itself at first sign-in. */
  autoJoin: boolean
}

export interface AuthMethods {
  github: boolean
  gitlab: boolean
  google: boolean
  emailOtp: boolean
  /** The company's identity provider and the name for its button; null when the server has none. */
  oidc: { name: string | null } | null
}

// Eden widens this public route's type with Response; the server only ever answers this object.
export const authMethods = async (): Promise<AuthMethods> => (await unwrap(eden.api["auth-methods"].get())) as AuthMethods
export const clientConfig = async (): Promise<ClientConfig> => (await unwrap(eden.api["client-config"].get())) as ClientConfig

export const authQueries = {
  clientConfig: () => queryOptions({ queryKey: qk.clientConfig, queryFn: () => clientConfig(), staleTime: Infinity }),
  authMethods: () => queryOptions({ queryKey: qk.authMethods, queryFn: () => authMethods(), staleTime: Infinity }),
  oauthClient: (clientId: string) => queryOptions({ queryKey: qk.oauthClient(clientId), queryFn: () => fetchOAuthClient(clientId) }),
}
