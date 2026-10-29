import { describe, expect, test } from "bun:test"
import { qk } from "../src/lib/query/keys"

// Every key as the code wrote it inline before qk: a different value would refresh other queries.
describe("qk keeps today's key values", () => {
  const filters = { q: "pay", status: ["open" as const], sort: "newest" as const }

  test("account and session", () => {
    expect(qk.me).toEqual(["me"])
    expect(qk.myLimits).toEqual(["my-limits"])
    expect(qk.clientConfig).toEqual(["client-config"])
    expect(qk.authMethods).toEqual(["auth-methods"])
    expect(qk.signInMethods).toEqual(["sign-in-methods"])
    expect(qk.mcpTokens).toEqual(["mcp-tokens"])
    expect(qk.oauthApps).toEqual(["oauth-apps"])
    expect(qk.oauthClient("c1")).toEqual(["oauth-client", "c1"])
    expect(qk.notifications).toEqual(["notifications"])
    expect(qk.onboarding.all).toEqual(["onboarding"])
    expect(qk.onboarding.of("w")).toEqual(["onboarding", "w"])
  })

  test("workspaces and joining", () => {
    expect(qk.workspaces).toEqual(["workspaces"])
    expect(qk.members("w")).toEqual(["members", "w"])
    expect(qk.invitations("w")).toEqual(["invitations", "w"])
    expect(qk.myInvitations).toEqual(["my-invitations"])
    expect(qk.invitation("t")).toEqual(["invitation", "t"])
    expect(qk.domainWorkspaces).toEqual(["domain-workspaces"])
    expect(qk.sharedInvite("ABC")).toEqual(["shared-invite", "ABC"])
    expect(qk.workspaceLimits.all).toEqual(["workspace-limits"])
    expect(qk.workspaceLimits.of("w")).toEqual(["workspace-limits", "w"])
    expect(qk.workspaceAccess("w")).toEqual(["workspace-access", "w"])
    expect(qk.joinRequests("w")).toEqual(["join-requests", "w"])
  })

  test("projects and integrations", () => {
    expect(qk.projects.all).toEqual(["projects"])
    expect(qk.projects.of("w")).toEqual(["projects", "w"])
    expect(qk.projects.overview("w")).toEqual(["projects", "w", "overview"])
    expect(qk.integrations("p")).toEqual(["integrations", "p"])
    expect(qk.connections("w")).toEqual(["connections", "w"])
    expect(qk.connectionOptions("w", "c", "labels", "bug", "")).toEqual(["connection-options", "w", "c", "labels", "bug", ""])
    expect(qk.ai("w")).toEqual(["ai", "w"])
  })

  test("reports", () => {
    expect(qk.reports.all).toEqual(["reports"])
    expect(qk.reports.feed("w", filters)).toEqual(["reports", "w", filters])
    expect(qk.reports.count("w")).toEqual(["reports", "w", "count", null])
    expect(qk.reports.count("w", "p")).toEqual(["reports", "w", "count", "p"])
    expect(qk.reports.statusCounts("w", filters)).toEqual(["reports", "w", "status-counts", { ...filters, status: undefined }])
    expect(qk.report("r")).toEqual(["report", "r"])
    expect(qk.share("s")).toEqual(["share", "s"])
    expect(qk.comments("r")).toEqual(["comments", "r"])
    expect(qk.activity("r")).toEqual(["activity", "r"])
    expect(qk.reportTrackers("r")).toEqual(["report-trackers", "r"])
    expect(qk.debugger("r")).toEqual(["debugger", "r"])
  })
})
