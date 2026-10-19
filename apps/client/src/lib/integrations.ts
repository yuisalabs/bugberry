import type { TrackerConfig, TrackerProvider } from "@bugberry/shared"

export interface IntegrationFields {
  owner: string
  repo: string
  labels: string
  baseUrl: string
  projectId: string
  taskListId: string
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

function positiveInteger(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const number = Number(trimmed)
  return number >= 1 ? number : null
}

/** Mirrors the server's checks so mistakes show up before saving. */
export function validateIntegration(
  provider: TrackerProvider,
  fields: IntegrationFields,
): { ok: true; config: TrackerConfig } | { ok: false; error: string } {
  if (provider === "github") {
    const owner = fields.owner.trim()
    const repo = fields.repo.trim()
    if (!OWNER.test(owner)) return { ok: false, error: "The GitHub owner is invalid" }
    if (!REPO.test(repo)) return { ok: false, error: "The repo name is invalid" }
    const labels = [
      ...new Set(
        fields.labels
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
      ),
    ]
    if (labels.length > 10 || labels.some((label) => label.length > 50)) {
      return { ok: false, error: "Use at most 10 labels of up to 50 characters each" }
    }
    return { ok: true, config: { owner, repo, labels } }
  }

  let url: URL
  try {
    url = new URL(fields.baseUrl.trim())
  } catch {
    return { ok: false, error: "The ActiveCollab address is invalid" }
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
  if (!secure || url.search || url.hash) return { ok: false, error: "The ActiveCollab address must start with https:// and have no query" }
  const projectId = positiveInteger(fields.projectId)
  const taskListId = positiveInteger(fields.taskListId)
  if (!projectId || !taskListId) return { ok: false, error: "Project ID and task list ID must be positive whole numbers" }
  return { ok: true, config: { baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, projectId, taskListId } }
}
