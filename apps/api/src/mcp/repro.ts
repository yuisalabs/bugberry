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

const quote = (value: string) => JSON.stringify(value)
const singleQuote = (value: string) => `'${value.replace(/[\\']/g, (char) => `\\${char}`)}'`
const regexPrefix = (value: string) => `/^${value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/`

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
