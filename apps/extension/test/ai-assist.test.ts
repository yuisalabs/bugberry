import { describe, expect, mock, test } from "bun:test"
import type { Material } from "@bugberry/ai-write"
import { aiPath, writeWithAi } from "../lib/ai-assist"
import { ApiError, type AiSetup } from "../lib/api"

const setup = (configured: boolean): AiSetup => ({
  team: { configured },
  sendResponseBodies: false,
  defaultTemplateId: "t1",
  projectDefaults: [],
  templates: [{ id: "t1", name: "Steps", skeleton: "## Steps", instructions: "", updatedAt: new Date(0) }],
  role: "member",
})

const material: Material = { page: { url: "https://a.test/", title: null }, device: { browser: "Chrome", os: "Linux" }, lines: [], omitted: 0 }
const input = { material, template: { id: "t1", skeleton: "## Steps", instructions: "" }, hint: { title: "pay", description: "" }, includeResponseBodies: true }

describe("aiPath", () => {
  test("a personal key wins over the team key", () => {
    expect(aiPath(true, setup(true))).toBe("personal")
    expect(aiPath(true, null)).toBe("personal")
    expect(aiPath(false, setup(true))).toBe("team")
    expect(aiPath(false, setup(false))).toBeNull()
    expect(aiPath(false, null)).toBeNull()
  })
})

describe("writeWithAi", () => {
  test("the team path posts templateId, material and hint to the API", async () => {
    const aiWrite = mock(async () => ({ title: "T", description: "D" }))
    const result = await writeWithAi({ path: "team", api: { aiWrite }, sendMessage: mock(), workspaceId: "w1" }, input)
    expect(result).toEqual({ title: "T", description: "D" })
    expect(aiWrite).toHaveBeenCalledWith("w1", { templateId: "t1", material, hint: { title: "pay", description: "" } })
  })

  test("the team path shows the server's message when it fails", async () => {
    const aiWrite = mock(async () => Promise.reject(new ApiError(502, "ai_quota", "Your AI provider says the quota is used up.")))
    await expect(writeWithAi({ path: "team", api: { aiWrite }, sendMessage: mock(), workspaceId: "w1" }, input)).rejects.toThrow(
      "Your AI provider says the quota is used up.",
    )
  })

  test("the personal path asks the background and turns its error into a thrown message", async () => {
    const sendMessage = mock(async () => ({ ok: true, title: "T", description: "D" }))
    expect(await writeWithAi({ path: "personal", api: { aiWrite: mock() }, sendMessage, workspaceId: "w1" }, input)).toEqual({ title: "T", description: "D" })
    expect(sendMessage).toHaveBeenCalledWith({
      type: "bugberry:ai-write",
      material,
      template: { skeleton: "## Steps", instructions: "" },
      hint: { title: "pay", description: "" },
      includeResponseBodies: true,
    })
    const failing = mock(async () => ({ ok: false, error: "No personal AI key is set." }))
    await expect(writeWithAi({ path: "personal", api: { aiWrite: mock() }, sendMessage: failing, workspaceId: "w1" }, input)).rejects.toThrow(
      "No personal AI key is set.",
    )
    const silent = mock(async () => undefined)
    await expect(writeWithAi({ path: "personal", api: { aiWrite: mock() }, sendMessage: silent, workspaceId: "w1" }, input)).rejects.toThrow(
      "The extension didn't answer. Try again.",
    )
  })
})
