import { type DebuggerView, isFailedRequest, isMaskedValue, type ViewAction, type ViewActionType } from "@bugberry/debugger-view"
import type { CaptureType } from "@bugberry/shared"

/** What `describeElement` (packages/capture) put in an action's target label. */
export interface TargetLabel {
  tag: string
  id: string | null
  classes: string[]
  testId: string | null
  name: string | null
  text: string | null
  truncated: boolean
}

export interface Locator {
  code: string
  todo: string | null
}

const NAME = `[^.#\\[\\s"]+`
const LABEL = new RegExp(`^([a-z][a-z0-9-]*)(?:#(${NAME}))?((?:\\.${NAME})*)(?:\\[(data-testid|name)="([^"]*)"\\])?(?: "([^"]*)")?$`)
const AMBIGUOUS = "check this locator, it may match several elements"
/** A name `#id` or `.class` can be written with, unescaped. */
const PLAIN_CSS_NAME = /^-?[A-Za-z_][\w-]*$/

/**
 * The label read back into its parts. Null when a value holds `.`, `#`, `[`, `"` or a space: the label carries
 * them unescaped, so where one value ends is a guess.
 */
export function parseTargetLabel(label: string): TargetLabel | null {
  const match = LABEL.exec(label)
  if (!match) return null
  const [, tag = "", id, classList = "", attribute, value, rawText] = match
  const truncated = rawText?.endsWith("…") ?? false
  const text = rawText === undefined ? null : truncated ? rawText.slice(0, -1) : rawText
  return {
    tag,
    id: id ?? null,
    classes: classList.split(".").filter(Boolean),
    testId: attribute === "data-testid" ? (value ?? "") : null,
    name: attribute === "name" ? (value ?? "") : null,
    text: text === "" ? null : text,
    truncated,
  }
}

const LINE_BREAKS = /[\r\n\u2028\u2029]+/g
const ESCAPED_BREAKS: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\u2028": "\\u2028", "\u2029": "\\u2029" }
/** Captured text goes into `//` comments; a line break there would turn the rest of it into code. */
const oneLine = (value: string) => value.replace(LINE_BREAKS, " ")
const quote = (value: string) => JSON.stringify(value)
const singleQuote = (value: string) =>
  `'${value.replace(/[\\'\r\n\u2028\u2029]/g, (char) => ESCAPED_BREAKS[char] ?? `\\${char}`)}'`
const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/[\r\n\u2028\u2029]/g, (char) => ESCAPED_BREAKS[char] ?? char)
const regexPrefix = (value: string) => `/^${escapeRegex(value)}/`

/** A Playwright locator for the label, the most specific part first; null when the label can't be read. */
export function locatorFor(label: string): Locator | null {
  const parsed = parseTargetLabel(label)
  if (!parsed) return null
  const { tag, id, classes, testId, name, text, truncated } = parsed
  if (testId !== null) return { code: `page.getByTestId(${quote(testId)})`, todo: null }
  if (id !== null) {
    const selector = PLAIN_CSS_NAME.test(id) ? `#${id}` : `[id="${id}"]`
    return { code: `page.locator(${quote(selector)})`, todo: null }
  }
  if (name !== null) return { code: `page.locator(${singleQuote(`${tag}[name="${name}"]`)})`, todo: null }
  if (text !== null) {
    const role = tag === "button" ? "button" : tag === "a" ? "link" : null
    if (role) return { code: `page.getByRole(${quote(role)}, { name: ${truncated ? regexPrefix(text) : quote(text)} })`, todo: null }
    return { code: `page.getByText(${quote(text)}, { exact: ${!truncated} })`, todo: null }
  }
  const plainClasses = classes.filter((className) => PLAIN_CSS_NAME.test(className))
  return { code: `page.locator(${quote([tag, ...plainClasses].join("."))})`, todo: AMBIGUOUS }
}

export interface ReproMeta {
  number: number
  title: string
  url: string
  pageUrl: string
  captureType: CaptureType
}

export interface ReproScript {
  filename: string
  script: string
  warnings: string[]
}

/** MAX_MASKED_VALUE_CHARS in packages/capture: a value this long may have been longer. */
const MASK_CAP = 50
const MAX_ASSERTIONS = 5
const ERROR_KEY_CHARS = 120
const REPLAYED: ReadonlySet<ViewActionType> = new Set(["click", "rage-click", "input", "submit", "navigate"])
const CAUSES_NAVIGATION: ReadonlySet<ViewActionType> = new Set(["click", "rage-click", "submit"])
const REDACTED = "[redacted]"
/** What the browser and the capture put before an uncaught error; Playwright's pageerror has neither. */
const UNCAUGHT_PREFIX = /^(?:Uncaught (?:\(in promise\) )?|Unhandled rejection: )/
const SETTLE = "await page.waitForTimeout(1000) // errors from the last step can arrive after it"

const COLLECTORS = [
  "const errors: string[] = []",
  'page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`))',
  'page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })',
  "const failed: string[] = []",
  'page.on("response", (response) => { if (response.status() >= 400) failed.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`) })',
  'page.on("requestfailed", (request) => failed.push(`${request.method()} ${new URL(request.url()).pathname} failed`))',
]
const NOTHING_TO_ASSERT =
  '// TODO: no errors or failed requests were captured. Add a check for what should have happened, for example: await expect(page.getByText("Order placed")).toBeVisible()'

export function scriptFilename(number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "")
  return slug ? `bb-${number}-${slug}.spec.ts` : `bb-${number}.spec.ts`
}

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

interface Step {
  line: string
  /** Set on a fill, so a later input on the same field replaces it. */
  field?: string
  /** Set on a click, so a rage click that follows doesn't press it all over again. */
  clicked?: string
  todoValue?: boolean
  ambiguous?: boolean
  skipped?: boolean
}

/** The keys that occur most, first come first among equals. */
function topKeys<T>(entries: Array<{ key: string; item: T }>): Array<{ key: string; item: T }> {
  const groups = new Map<string, { key: string; item: T; count: number; order: number }>()
  entries.forEach(({ key, item }, order) => {
    const group = groups.get(key)
    if (group) group.count += 1
    else groups.set(key, { key, item, count: 1, order })
  })
  return [...groups.values()].sort((a, b) => b.count - a.count || a.order - b.order).slice(0, MAX_ASSERTIONS)
}

function gotoLine(url: string): string {
  const note = url.includes(REDACTED) ? " // TODO: BugBerry redacted a value in this URL, put the real one back" : ""
  return `await page.goto(${quote(url)})${note}`
}

/** The page's address after a navigation the previous step caused; any query, since captured ones may be redacted. */
function urlCheck(url: string): string | null {
  const parsed = parsedUrl(url)
  if (!parsed) return null
  return `await expect(page).toHaveURL(/^${escapeRegex(`${parsed.origin}${parsed.pathname}`)}(?:[?#].*)?$/)`
}

function elementStep(action: ViewAction, call: (locator: string) => string, comment: string | null, extra: Partial<Step> = {}): Step | null {
  if (!action.target) return null
  const locator = locatorFor(action.target)
  if (!locator) return { line: `// TODO: step skipped, BugBerry could not read this element: ${oneLine(action.target)}`, skipped: true }
  const notes = [comment, locator.todo ? `TODO: ${locator.todo}` : null].filter(Boolean).join(". ")
  return { line: `${call(locator.code)}${notes ? ` // ${notes}` : ""}`, ambiguous: locator.todo !== null, ...extra }
}

function inputStep(action: ViewAction): Step | null {
  const field = { field: action.target ?? "" }
  if (action.value === "checked") return elementStep(action, (locator) => `await ${locator}.check()`, null, field)
  if (action.value === "unchecked") return elementStep(action, (locator) => `await ${locator}.uncheck()`, null, field)
  const length = action.value?.length ?? 0
  const comment =
    action.value === null
      ? "value hidden by data-bugberry-mask"
      : isMaskedValue(action.value)
        ? length >= MASK_CAP
          ? `typed ${MASK_CAP}+ characters`
          : `typed ${length} character${length === 1 ? "" : "s"}`
        : null
  const method = parseTargetLabel(action.target ?? "")?.tag === "select" ? "selectOption" : "fill"
  return elementStep(action, (locator) => `await ${locator}.${method}("TODO")`, comment, { ...field, todoValue: true })
}

function navigationStep(action: ViewAction, previous: ViewActionType | null): Step | null {
  const url = action.url ?? action.target
  if (!url) return null
  switch (action.via) {
    case "reload":
      return { line: "await page.reload()" }
    case "back-forward":
      return { line: "await page.goBack() // or goForward(): the capture doesn't say which" }
    case "load":
      if (!previous || !CAUSES_NAVIGATION.has(previous)) return { line: gotoLine(url) }
      break
  }
  const check = urlCheck(url)
  return check ? { line: check } : null
}

function stepFor(action: ViewAction, previous: ViewActionType | null, last: Step | undefined): Step | null {
  switch (action.type) {
    case "click":
      return elementStep(action, (locator) => `await ${locator}.click()`, null, { clicked: action.target ?? "" })
    case "rage-click": {
      const presses = Number.parseInt(action.value ?? "", 10) || 3
      // Presses that fired click are already steps; only a disabled element's presses are missing.
      if (action.target && last?.clicked === action.target) {
        return { line: `// rage click: ${oneLine(action.target)} pressed ${presses} times, as the clicks above`, clicked: action.target }
      }
      return elementStep(action, (locator) => `await ${locator}.click({ clickCount: ${presses} })`, `rage click: pressed ${presses} times`)
    }
    case "input":
      return inputStep(action)
    case "submit":
      return { line: `// form submitted: ${oneLine(action.target ?? "a form")}` }
    case "navigate":
      return navigationStep(action, previous)
    default:
      return null
  }
}

/**
 * A Playwright test that replays the report's actions and fails while its errors and failed requests come back.
 * Null when there is nothing to replay. Typed values are never in a report, so they come out as TODOs.
 */
export function reproductionScript(view: DebuggerView, meta: ReproMeta): ReproScript | null {
  const actions = view.events.filter((event): event is ViewAction => event.kind === "action" && REPLAYED.has(event.type))
  if (actions.length === 0) return null

  const firstPage = view.events.find((event) => event.kind === "page")
  const first = actions[0]
  // Every page load is both a page event and a navigate action; the first one is the goto at the top.
  const opening = first?.type === "navigate" && first.url && (!firstPage || first.url === firstPage.url) ? first : null
  const start = firstPage?.url ?? opening?.url ?? meta.pageUrl

  const steps: Step[] = []
  let previous: ViewActionType | null = opening ? "navigate" : null
  for (const action of actions) {
    if (action === opening) continue
    const step = stepFor(action, previous, steps.at(-1))
    previous = action.type
    if (!step) continue
    if (step.field !== undefined && steps.at(-1)?.field === step.field) steps.pop()
    steps.push(step)
  }

  const origin = parsedUrl(start)?.origin ?? null
  const errorKeys = topKeys(
    view.events.flatMap((event) => {
      // An error thrown by another origin's script (analytics, an extension) isn't this page's bug.
      const foreign = event.kind === "error" && event.source !== null && (parsedUrl(event.source)?.origin ?? origin) !== origin
      const text = event.kind === "error" && !foreign ? event.message : event.kind === "console" && event.level === "error" ? event.text : null
      const key = text?.split(LINE_BREAKS)[0]?.replace(UNCAUGHT_PREFIX, "").trim().slice(0, ERROR_KEY_CHARS)
      return key ? [{ key, item: null }] : []
    }),
  )
  const requestKeys = topKeys(
    view.events.flatMap((event) => {
      if (event.kind !== "network" || !isFailedRequest(event)) return []
      const url = parsedUrl(event.url)
      if (!url || origin === null || url.origin !== origin) return []
      const outcome = event.status !== null && event.status >= 400 ? String(event.status) : "failed"
      return [{ key: `${oneLine(event.method)} ${url.pathname}`, item: { method: event.method, path: url.pathname, outcome } }]
    }),
  )
  const waits = [
    ...requestKeys.map(
      ({ item }) =>
        `await page.waitForResponse((response) => response.request().method() === ${quote(item.method)} && new URL(response.url()).pathname === ${quote(item.path)}, { timeout: 10_000 }).catch(() => {})`,
    ),
    ...(errorKeys.length + requestKeys.length > 0 ? [SETTLE] : []),
  ]
  const assertions = [
    ...errorKeys.flatMap(({ key }) => [`// In the report: ${oneLine(key)}`, `expect(errors.filter((text) => text.includes(${quote(key)}))).toEqual([])`]),
    ...requestKeys.flatMap(({ key, item }) => [
      `// In the report: ${key} → ${item.outcome}`,
      `expect(failed.filter((line) => line.startsWith(${quote(`${key} `)}))).toEqual([])`,
    ]),
  ]

  const count = (flag: "todoValue" | "ambiguous" | "skipped") => steps.filter((step) => step[flag]).length
  const values = count("todoValue")
  const ambiguous = count("ambiguous")
  const skipped = count("skipped")
  const sdkErrors = view.events.filter((event) => event.kind === "sdk" && event.level === "error").length
  const warnings = [
    values > 0 ? `Fill in the ${values} value(s) marked TODO: BugBerry never stores what people type.` : null,
    "This page may need a signed-in user: add your login setup (storageState) if it does.",
    ambiguous > 0 ? `Check the ${ambiguous} locator(s) marked TODO: they may match several elements.` : null,
    skipped > 0 ? `${skipped} step(s) were skipped because their element label could not be read.` : null,
    sdkErrors > 0
      ? `The report has ${sdkErrors} error-level SDK log line(s) (bugberry.error) that this script does not check. See getConsoleLogs sources=["sdk"].`
      : null,
    meta.captureType === "video" ? "Steps from other tabs, or from before the capture's buffer started, may be missing." : null,
  ].filter((warning): warning is string => warning !== null)

  const filename = scriptFilename(meta.number, meta.title)
  const title = meta.title.replace(/\s+/g, " ").trim()
  const body = [
    ...COLLECTORS,
    "",
    gotoLine(start),
    ...steps.map((step) => step.line),
    "",
    ...waits,
    ...(assertions.length > 0 ? assertions : [NOTHING_TO_ASSERT]),
  ]
  const script = [
    `// Save as ${filename}`,
    `// Reproduces BB-${meta.number} "${title}" – ${oneLine(meta.url)}`,
    "// Generated by BugBerry. Fails while the bug is there; passes once it's fixed.",
    "// Before running:",
    ...warnings.map((warning) => `//  - ${warning}`),
    'import { test, expect } from "@playwright/test"',
    "",
    `test(${quote(`BB-${meta.number}: ${title}`)}, async ({ page }) => {`,
    ...body.map((line) => (line ? `  ${line}` : "")),
    "})",
    "",
  ].join("\n")
  return { filename, script, warnings }
}
