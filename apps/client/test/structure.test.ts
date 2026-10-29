import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("../src", import.meta.url))

const INLINE_KEY = /queryKey:\s*\[|(?:setQueryData|getQueryData)\(\s*\[/
const OLD_DATA_LAYER = /from\s+"(?:\.\.?\/)+lib\/(?:api|client|queries)"/

/** Whether a file still writes a query key inline or reaches the old data layer; keys live in lib/query/keys.ts. */
function breaksRules(file: string, text: string): boolean {
  if (file === "lib/query/keys.ts") return false
  // Inside lib/ the old files are imported as "./api", "./client", "./queries"; their own path is the same rule.
  const oldLayer = file.startsWith("lib/") && !file.startsWith("lib/query/") ? /from\s+"\.\/(?:api|client|queries)"/ : OLD_DATA_LAYER
  return INLINE_KEY.test(text) || oldLayer.test(text) || file === "lib/api.ts" || file === "lib/client.ts" || file === "lib/queries.ts"
}

/** Files still on the old layer; each feature task removes its own. Empty when the refactor is done. */
const PENDING = new Set<string>([
  "components/AppShell.tsx",
  "components/CreateWorkspaceDialog.tsx",
  "components/InviteDialog.tsx",
  "components/JoinWorkspaceDialog.tsx",
  "components/MediaViewer.tsx",
  "components/MobileReportFilters.tsx",
  "components/ReportCard.tsx",
  "components/ReportComments.tsx",
  "components/ReportFilters.tsx",
  "components/ReportTable.tsx",
  "components/ReportView.tsx",
  "components/ReportsBrowser.tsx",
  "components/ReportsView.tsx",
  "components/VideoOverlay.tsx",
  "components/comments/ActivityLine.tsx",
  "components/comments/CommentItem.tsx",
  "components/comments/CommentThread.tsx",
  "components/comments/CommentsSection.tsx",
  "components/comments/ReactionBar.tsx",
  "components/debugger/DebuggerPanel.tsx",
  "components/debugger/DebuggerTabs.tsx",
  "components/debugger/InfoTab.tsx",
  "components/report/CopyLinkButton.tsx",
  "components/report/MoreMenu.tsx",
  "components/report/ReportFields.tsx",
  "components/report/ReportMeta.tsx",
  "components/report/TrackerButton.tsx",
  "components/report/useReportTrackers.ts",
  "features/auth/admin-guard.ts",
  "lib/api.ts",
  "lib/client.ts",
  "lib/comment-feed.ts",
  "lib/invite.ts",
  "lib/more-menu.ts",
  "lib/queries.ts",
  "lib/report-feed.ts",
  "lib/report-page.ts",
  "lib/tracker-links.ts",
  "lib/usage.ts",
  "lib/workspace-slug.ts",
  "lib/workspace.ts",
  "pages/DemoPage.tsx",
  "pages/InvitePage.tsx",
  "pages/JoinPage.tsx",
  "pages/ReportPage.tsx",
  "pages/SharePage.tsx",
  "pages/settings/MembersPage.tsx",
  "pages/settings/WorkspaceSettingsPage.tsx",
])

async function violators(): Promise<string[]> {
  const found: string[] = []
  for (const path of new Bun.Glob("**/*.{ts,tsx}").scanSync(SRC)) {
    const file = path.replaceAll("\\", "/")
    if (breaksRules(file, await Bun.file(`${SRC}/${file}`).text())) found.push(file)
  }
  return found.sort()
}

describe("structure", () => {
  test("query keys and data access go through lib/query and the features", async () => {
    expect((await violators()).filter((path) => !PENDING.has(path))).toEqual([])
  })

  test("PENDING lists only files that still break the rules", async () => {
    const found = await violators()
    expect([...PENDING].filter((path) => !found.includes(path))).toEqual([])
  })

  test("the rules catch what they are for", () => {
    expect(breaksRules("features/x/Page.tsx", 'useQuery({ queryKey: ["me"], queryFn })')).toBe(true)
    expect(breaksRules("features/x/Page.tsx", "queryClient.setQueryData([\"me\"], next)")).toBe(true)
    expect(breaksRules("features/x/Page.tsx", 'import { api } from "../../lib/client"')).toBe(true)
    expect(breaksRules("components/X.tsx", 'import { queries } from "../lib/queries"')).toBe(true)
    expect(breaksRules("lib/workspace.ts", 'import { api } from "./client"')).toBe(true)
    expect(breaksRules("features/x/Page.tsx", "useQuery(xQueries.me())")).toBe(false)
    expect(breaksRules("features/x/Page.tsx", 'import { xQueries } from "./queries"')).toBe(false)
    expect(breaksRules("features/x/Page.tsx", 'import { yQueries } from "../y/queries"')).toBe(false)
    expect(breaksRules("lib/query/client.ts", 'import { ApiError } from "./unwrap"')).toBe(false)
    expect(breaksRules("lib/query/keys.ts", 'me: ["me"] as const, queryKey: ["x"]')).toBe(false)
  })
})
