import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

const userMessage = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] })

/** Ready-made requests a person can pick in their AI app instead of writing one. */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "debug-report",
    {
      title: "Debug a BugBerry report",
      description: "Find the root cause of a bug report in the open codebase and propose a fix.",
      argsSchema: { report: z.string().describe("A BugBerry link or a number like BB-123.") },
    },
    ({ report }) =>
      userMessage(
        [
          `Debug the BugBerry report ${report}.`,
          "",
          `1. Call getReport for ${report}, then getTimeline and getCodeHotspots.`,
          '2. If the report has failed requests, call getNetworkRequests with failedOnly=true; if it has errors, call getConsoleLogs with levels=["error"].',
          "3. Search this codebase for the files and lines getCodeHotspots names, and for the failing endpoints.",
          "4. Explain the root cause in a few sentences and propose a fix as a code change.",
          "5. Offer to post a short summary on the report with addComment, and only post it after I say yes.",
        ].join("\n"),
      ),
  )

  server.registerPrompt(
    "triage-reports",
    {
      title: "Triage open reports",
      description: "Sort open reports by impact and suggest a priority and an owner for each.",
      argsSchema: { project: z.string().optional().describe("Optional project id or slug.") },
    },
    ({ project }) =>
      userMessage(
        [
          `Triage the open BugBerry reports${project ? ` in project ${project}` : ""}.`,
          "",
          `1. Call searchReports status=["open"]${project ? ` project="${project}"` : ""}, and getReport for any that need a closer look.`,
          "2. Group them by impact: broken flows and errors first, cosmetic issues last.",
          "3. For each, suggest a priority and an assignee from listMembers, with one line on why.",
          "4. Do not change anything until I agree; then apply what I approve with updateReport.",
        ].join("\n"),
      ),
  )

  server.registerPrompt(
    "summarize-report",
    {
      title: "Summarize a report in plain language",
      description: "A short summary of a bug report for people who don't write code.",
      argsSchema: { report: z.string().describe("A BugBerry link or a number like BB-123.") },
    },
    ({ report }) =>
      userMessage(
        [
          `Summarize the BugBerry report ${report} for a non-developer.`,
          "",
          "Use getReport, getUserActions and getFrustrationSignals. In plain words and under 120 words: what the person was trying to do,",
          "what went wrong, and how bad it is for them. No code, file names or HTTP status codes.",
        ].join("\n"),
      ),
  )
}
