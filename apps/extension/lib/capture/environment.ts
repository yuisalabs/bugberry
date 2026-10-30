import type { CaptureEnvironment } from "@bugberry/capture"

type Raw = Record<string, unknown>

const MAX_TEXT = 100
/** Brands in the order we name the browser; "Not A(Brand"-style decoys are ignored. */
const BRANDS: Array<[brand: string, name: string]> = [
  ["Google Chrome", "Chrome"],
  ["Microsoft Edge", "Edge"],
  ["Opera", "Opera"],
  ["Brave", "Brave"],
  ["Chromium", "Chromium"],
]

const record = (value: unknown): Raw | null => (typeof value === "object" && value !== null ? (value as Raw) : null)
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_TEXT) : undefined
const amount = (value: unknown, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined

function browserVersion(uaData: Raw): string | undefined {
  const list = Array.isArray(uaData.fullVersionList) ? uaData.fullVersionList.map(record) : []
  for (const [brand, name] of BRANDS) {
    const version = text(list.find((entry) => entry?.brand === brand)?.version)
    if (version) return `${name} ${version}`
  }
  return undefined
}

function osVersion(uaData: Raw): string | undefined {
  const platform = text(uaData.platform)
  const version = text(uaData.platformVersion)
  if (!platform) return undefined
  if (platform === "Windows") {
    const major = Number(version?.split(".")[0])
    // Windows 11 reports platformVersion 13 and up.
    return Number.isFinite(major) && major >= 13 ? "Windows 11" : "Windows 10"
  }
  if (platform === "macOS" && version) return `macOS ${version.split(".").slice(0, 2).join(".")}`
  return version ? `${platform} ${version}` : platform
}

/** The reporter's environment as the page described it; the page is not trusted, so every field is checked. */
export function environmentFrom(raw: unknown): CaptureEnvironment | undefined {
  const value = record(raw)
  if (!value) return undefined
  const environment: CaptureEnvironment = {}
  const language = text(value.language)
  if (language) environment.language = language
  const timeZone = text(value.timeZone)
  if (timeZone) environment.timeZone = timeZone
  const pixelRatio = amount(value.pixelRatio, 8)
  if (pixelRatio !== undefined && pixelRatio >= 0.5) environment.pixelRatio = pixelRatio

  const connection = record(value.connection)
  if (connection) {
    const effectiveType = text(connection.effectiveType)
    const downlinkMbps = amount(connection.downlink, 100_000)
    const rttMs = amount(connection.rtt, 60_000)
    const described = {
      ...(effectiveType ? { effectiveType } : {}),
      ...(downlinkMbps !== undefined ? { downlinkMbps } : {}),
      ...(rttMs !== undefined ? { rttMs } : {}),
    }
    if (Object.keys(described).length > 0) environment.connection = described
  }

  const uaData = record(value.uaData)
  if (uaData) {
    const browser = browserVersion(uaData)
    if (browser) environment.browserVersion = browser
    const os = osVersion(uaData)
    if (os) environment.osVersion = os
  }
  return Object.keys(environment).length > 0 ? environment : undefined
}
