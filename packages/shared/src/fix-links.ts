export type FixProvider = "github" | "gitlab" | "bitbucket" | "other"

export const MAX_FIX_URL_LENGTH = 2000
export const MAX_FIXES_PER_REPORT = 10
const MAX_LABEL = 60

function parsed(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** The link as stored, or null unless it is an http(s) URL within the length cap. */
export function cleanFixUrl(value: string): string | null {
  const url = parsed(value.trim())
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return null
  return url.href.length <= MAX_FIX_URL_LENGTH ? url.href : null
}

const cut = (text: string) => (text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text)

function providerOf(host: string): FixProvider {
  if (host.includes("github")) return "github"
  if (host.includes("gitlab")) return "gitlab"
  if (host.includes("bitbucket")) return "bitbucket"
  return "other"
}

/** "PR #42 · shop/web" for the forges people link fixes from; host and path for anything else. */
export function fixLinkLabel(value: string): { label: string; provider: FixProvider } {
  const url = parsed(value)
  if (!url) return { label: cut(value), provider: "other" }
  const provider = providerOf(url.hostname)
  const parts = url.pathname.split("/").filter(Boolean)
  const [owner, repo, kind, ref] = parts
  if (provider === "github" && owner && repo && ref) {
    if (kind === "pull") return { label: `PR #${ref} · ${owner}/${repo}`, provider }
    if (kind === "commit") return { label: `${ref.slice(0, 7)} · ${owner}/${repo}`, provider }
  }
  if (provider === "gitlab") {
    const dash = parts.indexOf("-")
    if (dash > 0 && parts[dash + 1] === "merge_requests" && parts[dash + 2]) {
      return { label: `MR !${parts[dash + 2]} · ${parts.slice(0, dash).join("/")}`, provider }
    }
  }
  if (provider === "bitbucket" && owner && repo && kind === "pull-requests" && ref) {
    return { label: `PR #${ref} · ${owner}/${repo}`, provider }
  }
  return { label: cut(`${url.host}${url.pathname.replace(/\/$/, "")}`), provider }
}
