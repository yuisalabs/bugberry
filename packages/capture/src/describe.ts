import { MAX_MASKED_VALUE_CHARS, MAX_TARGET_TEXT_CHARS } from "./limits"

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"])
/** Elements whose text is user input or code, never a label. */
const NON_LABEL_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"])
const EDITABLE = '[contenteditable]:not([contenteditable="false"])'
/** Enough raw text to fill a label after whitespace is collapsed. */
const TEXT_SCAN_CHARS = MAX_TARGET_TEXT_CHARS * 4

/**
 * Marks an area whose text never reaches a report. `data-bugberry-mask` is the name to use; pages marked with
 * the older `data-fdebag-mask` stay masked too.
 */
export const MASK_SELECTOR = "[data-bugberry-mask], [data-fdebag-mask]"

/** True for password inputs and anything inside an element marked `data-bugberry-mask`. */
export function isMasked(element: Element): boolean {
  if (element.closest(MASK_SELECTOR)) return true
  return element.tagName === "INPUT" && (element as HTMLInputElement).type === "password"
}

function isEditable(element: Element): boolean {
  return element.matches(EDITABLE)
}

/**
 * Visible label text, skipping masked areas, editable regions, form fields and scripts anywhere
 * below the element. Stops as soon as there is enough text, so clicking `<body>` stays cheap.
 */
function labelText(element: Element): string {
  let text = ""
  const visit = (node: Node) => {
    for (let child = node.firstChild; child && text.length < TEXT_SCAN_CHARS; child = child.nextSibling) {
      if (child.nodeType === 3) {
        text += ` ${child.nodeValue ?? ""}`
      } else if (child.nodeType === 1) {
        const childElement = child as Element
        if (NON_LABEL_TAGS.has(childElement.tagName)) continue
        if (childElement.matches(MASK_SELECTOR) || isEditable(childElement)) continue
        visit(childElement)
      }
    }
  }
  visit(element)
  return text.slice(0, TEXT_SCAN_CHARS).replace(/\s+/g, " ").trim()
}

/** A short, value-free label such as `button#buy.btn.primary "Buy now"`. */
export function describeElement(element: Element): string {
  let label = element.tagName.toLowerCase()
  if (element.id) label += `#${element.id}`
  for (const className of Array.from(element.classList).slice(0, 2)) label += `.${className}`
  const testId = element.getAttribute("data-testid")
  const name = element.getAttribute("name")
  if (testId) label += `[data-testid="${testId}"]`
  else if (name) label += `[name="${name}"]`

  if (!FIELD_TAGS.has(element.tagName) && !isMasked(element) && !element.closest(EDITABLE)) {
    const text = labelText(element)
    if (text) {
      const short = text.length > MAX_TARGET_TEXT_CHARS ? `${text.slice(0, MAX_TARGET_TEXT_CHARS)}…` : text
      label += ` "${short}"`
    }
  }
  return label
}

/** The value to record for a form field: never the real text. */
export function fieldValue(element: Element): string | undefined {
  if (isMasked(element)) return undefined
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement
    if (input.type === "checkbox" || input.type === "radio") return input.checked ? "checked" : "unchecked"
  }
  const value = String((element as HTMLInputElement).value ?? "")
  return "•".repeat(Math.min(value.length, MAX_MASKED_VALUE_CHARS))
}
