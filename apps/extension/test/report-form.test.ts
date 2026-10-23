import { describe, expect, test } from "bun:test"
import { formProblem, pickEditorWorkspace, projectAfterLoad } from "../lib/report-form"
import type { ReportForm } from "../lib/upload"

const form: ReportForm = { workspaceId: "w1", projectId: "p1", title: "Pay button fails", description: "", priority: "none", visibility: "internal" }

describe("formProblem", () => {
  test("the title may stay empty: the server names the report", () => {
    expect(formProblem({ ...form, title: "   " })).toBeNull()
    expect(formProblem({ ...form, workspaceId: undefined })).toBe("Choose a workspace for this report")
    expect(formProblem({ ...form, projectId: "" })).toBeNull()
    expect(formProblem(form)).toBeNull()
  })
})

describe("projectAfterLoad", () => {
  const projects = [{ id: "p1", urlPatterns: ["app.kantor.test"] }]

  test("a project list that loads late still picks the matching project", () => {
    expect(projectAfterLoad("", projects, "https://app.kantor.test/pay")).toBe("p1")
  })

  test("never overrides a project already chosen, and leaves no match as No project", () => {
    expect(projectAfterLoad("p2", projects, "https://app.kantor.test/pay")).toBe("p2")
    expect(projectAfterLoad("", projects, "https://other.test/")).toBe("")
  })
})

describe("pickEditorWorkspace", () => {
  test("the last one used while still mine, else the first, else none", () => {
    const workspaces = [{ id: "w1" }, { id: "w2" }]
    expect(pickEditorWorkspace(workspaces, "w2")).toBe("w2")
    expect(pickEditorWorkspace(workspaces, "gone")).toBe("w1")
    expect(pickEditorWorkspace(workspaces, null)).toBe("w1")
    expect(pickEditorWorkspace([], "w1")).toBeNull()
    // The first choice the person is still in wins.
    expect(pickEditorWorkspace(workspaces, "gone", null, "w2")).toBe("w2")
    expect(pickEditorWorkspace(workspaces, undefined, "w2", "w1")).toBe("w2")
  })
})

describe("formProblem and workspaces", () => {
  test("a report never leaves without knowing its workspace", () => {
    const base = { projectId: "", title: "Bug", description: "", priority: "none" as const, visibility: "workspace" as const }
    expect(formProblem({ ...base, workspaceId: undefined })).toBe("Choose a workspace for this report")
    expect(formProblem({ ...base, workspaceId: "w1" })).toBeNull()
  })
})
