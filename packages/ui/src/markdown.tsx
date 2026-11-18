import { cn } from "cn"
import { Children, Component, createContext, isValidElement, useContext, type ComponentProps, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"

export interface MarkdownProps {
  children: string
  /** "description": headings are headings, below the page title. "comment": headings are bold body text. */
  look: "description" | "comment"
  className?: string
  /** Replaces running text with the caller's own elements. Running text is every string outside code and link labels. */
  renderText?: (text: string) => React.ReactNode
  /** Rewrites text where renderText does not run: inline code, code blocks and link labels (an image's label included). */
  literalText?: (text: string) => string
}

interface TextHooks {
  renderText?: (text: string) => ReactNode
  literalText?: (text: string) => string
  /** Inside a link label, formatted text is rewritten like the label rather than replaced. */
  inLabel: boolean
}

const TextHooksContext = createContext<TextHooks>({ inLabel: false })

const mapStrings = <T,>(children: ReactNode, map: ((text: string) => T) | undefined) =>
  map ? Children.map(children, (child) => (typeof child === "string" ? map(child) : child)) : children

/** Strings go through renderText, or through literalText when they sit inside a link label. */
function RunningText({ children }: { children?: ReactNode }) {
  const { renderText, literalText, inLabel } = useContext(TextHooksContext)
  return <>{mapStrings(children, inLabel ? literalText : renderText)}</>
}

interface TreeNode {
  type: string
  value?: string
  alt?: string | null
  url?: string
  children?: TreeNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const maxNesting = 16
const nestingTypes = new Set(["blockquote", "list", "listItem"])

/** A node's text as it was typed, or its text values joined when the parser left no offsets. */
const typedText = (node: TreeNode, source: string) => {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start !== undefined && end !== undefined) return source.slice(start, end)
  const parts: string[] = []
  const stack = [node]
  while (stack.length > 0) {
    const next = stack.pop() as TreeNode
    if (next.value !== undefined) parts.push(next.value)
    if (next.children) for (let i = next.children.length - 1; i >= 0; i--) stack.push(next.children[i] as TreeNode)
  }
  return parts.join("")
}

/**
 * Quotes and lists nested past 16 levels become plain text. Deeper trees overflow the call stack in the
 * markdown-to-HTML step and in React itself under V8, and a body of a few thousand ">" is enough.
 * Walks with its own stack so the input it guards against cannot overflow it either.
 */
function capNesting() {
  return (tree: TreeNode, file: { value?: unknown }) => {
    const source = String(file.value ?? "")
    const stack: [TreeNode, number][] = [[tree, 0]]
    while (stack.length > 0) {
      const [parent, depth] = stack.pop() as [TreeNode, number]
      parent.children = parent.children?.map((child) => {
        if (!nestingTypes.has(child.type)) {
          stack.push([child, depth])
          return child
        }
        const level = depth + 1
        // A list is kept only when its items fit too, so no list is left holding paragraphs instead of items.
        if (level > maxNesting || (child.type === "list" && level === maxNesting)) {
          return { type: "paragraph", children: [{ type: "text", value: typedText(child, source) }] }
        }
        stack.push([child, level])
        return child
      })
    }
  }
}

/** Parents whose children are inline text, so raw HTML inside them is inline too. */
const inlineParents = new Set([
  "paragraph",
  "heading",
  "tableCell",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
])

/**
 * Turns raw HTML back into the text that was typed. react-markdown would print
 * it as bare text outside any paragraph, which loses its line breaks.
 */
function htmlAsText() {
  return (tree: TreeNode) => {
    const stack = [tree]
    while (stack.length > 0) {
      const parent = stack.pop() as TreeNode
      const inline = inlineParents.has(parent.type)
      parent.children = parent.children?.map((child) => {
        if (child.type !== "html") {
          stack.push(child)
          return child
        }
        const text = { type: "text", value: child.value ?? "" }
        return inline ? text : { type: "paragraph", children: [text] }
      })
    }
  }
}

/**
 * An image inside a link would become a second link inside the first. Its alt,
 * or its URL when the alt is empty, becomes plain text in the outer link's
 * label instead, so the label check below sees it.
 */
function imagesInLinksAsText() {
  return (tree: TreeNode) => {
    const stack: [TreeNode, boolean][] = [[tree, false]]
    while (stack.length > 0) {
      const [parent, inLink] = stack.pop() as [TreeNode, boolean]
      parent.children = parent.children?.map((child) => {
        if (inLink && (child.type === "image" || child.type === "imageReference")) return { type: "text", value: child.alt || child.url || "" }
        stack.push([child, inLink || child.type === "link" || child.type === "linkReference"])
        return child
      })
    }
  }
}

const allowedUrl = /^(https?:\/\/|mailto:)/i

/** Runs for every href and src; an empty result tells the components below to drop the link. */
const urlTransform = (url: string) => (allowedUrl.test(url) ? url : "")

/** The label's text as the reader will see it: each string rewritten the way the label's components rewrite it. */
const textOf = (node: ReactNode, rewrite: (text: string) => string): string => {
  if (typeof node === "string") return rewrite(node)
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map((child) => textOf(child, rewrite)).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children, rewrite)
  return ""
}

const hostOf = (url: string) => {
  try {
    return new URL(/^www\./i.test(url) ? `https://${url}` : url).hostname.toLowerCase()
  } catch {
    return null
  }
}

// Spaces, format characters and the blank-looking fillers, which would otherwise split or hide a URL in a label.
const invisible = /[\s\p{Cf}\u034F\u115F\u1160\u3164\uFFA0]/gu

/**
 * Whether a link may show its own label. A label naming another host than the
 * link is how phishing reads "bank.com" while going elsewhere, and an empty one
 * is an invisible link; both show the real target instead.
 */
const keepsLabel = (children: ReactNode, href: string, rewrite: (text: string) => string) => {
  const label = textOf(children, rewrite).replace(invisible, "")
  if (label === "") return false
  const at = label.search(/https?:\/\/|www\./i)
  if (at < 0) return true
  const labelHost = hostOf(label.slice(at))
  return labelHost !== null && labelHost === hostOf(href)
}

const unchanged = (text: string) => text

const ExternalLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer nofollow"
    className="text-primary underline underline-offset-2"
  >
    {children}
  </a>
)

/** A link's label, or its text alone when the target is not allowed. Strings in it are rewritten, never replaced. */
function Label({ children }: { children?: ReactNode }) {
  const hooks = useContext(TextHooksContext)
  return (
    <TextHooksContext.Provider value={{ ...hooks, inLabel: true }}>
      {mapStrings(children, hooks.literalText)}
    </TextHooksContext.Provider>
  )
}

function LinkOverride({ href, children }: { href?: string; children?: ReactNode }) {
  const { literalText = unchanged } = useContext(TextHooksContext)
  if (!href) return <Label>{children}</Label>
  return <ExternalLink href={href}>{keepsLabel(children, href, literalText) ? <Label>{children}</Label> : href}</ExternalLink>
}

// Loading an image would fetch a URL chosen by whoever wrote the text, so it is offered as a link instead.
function ImageOverride({ src, alt }: { src?: string | Blob; alt?: string }) {
  const { literalText = unchanged } = useContext(TextHooksContext)
  if (typeof src !== "string" || !src) return <>{literalText(alt ?? "")}</>
  const label = literalText(alt || src)
  return <ExternalLink href={src}>{keepsLabel(label, src, unchanged) ? label : src}</ExternalLink>
}

function CodeOverride({ className, children, ...props }: ComponentProps<"code">) {
  const { literalText } = useContext(TextHooksContext)
  return (
    <code className={cn("rounded-sm border border-border bg-muted px-1 font-mono text-[0.9em]", className)} {...props}>
      {mapStrings(children, literalText)}
    </code>
  )
}

const headingClass = "font-heading font-semibold tracking-tight text-foreground"

// The root's space-y reaches only its own children; this gives blocks inside items and quotes the same gap.
const nestedGap = "[&>*+*]:mt-3"

const shared: Components = {
  ul: ({ node, className, ...props }) => (
    <ul
      className={cn(
        "list-disc space-y-1 pl-6",
        className?.includes("contains-task-list") && "list-none pl-0",
        className
      )}
      {...props}
    />
  ),
  ol: ({ node, className, ...props }) => (
    <ol className={cn("list-decimal space-y-1 pl-6", className)} {...props} />
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote className={cn("border-l-2 border-border pl-3 text-muted-foreground", nestedGap)} {...props} />
  ),
  pre: ({ node, ...props }) => (
    <pre
      className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-sm [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  code: ({ node, ...props }) => <CodeOverride {...props} />,
  p: ({ node, children, ...props }) => (
    <p {...props}>
      <RunningText>{children}</RunningText>
    </p>
  ),
  li: ({ node, className, children, ...props }) => (
    <li className={cn(nestedGap, className)} {...props}>
      <RunningText>{children}</RunningText>
    </li>
  ),
  em: ({ node, children, ...props }) => (
    <em {...props}>
      <RunningText>{children}</RunningText>
    </em>
  ),
  strong: ({ node, children, ...props }) => (
    <strong {...props}>
      <RunningText>{children}</RunningText>
    </strong>
  ),
  del: ({ node, children, ...props }) => (
    <del {...props}>
      <RunningText>{children}</RunningText>
    </del>
  ),
  table: ({ node, ...props }) => (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({ node, children, ...props }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold" {...props}>
      <RunningText>{children}</RunningText>
    </th>
  ),
  td: ({ node, children, ...props }) => (
    <td className="border border-border px-2 py-1" {...props}>
      <RunningText>{children}</RunningText>
    </td>
  ),
  hr: ({ node, ...props }) => <hr className="border-border" {...props} />,
  a: ({ href, children }) => <LinkOverride href={href}>{children}</LinkOverride>,
  img: ({ src, alt }) => <ImageOverride src={src} alt={alt} />,
}

const descriptionComponents: Components = {
  ...shared,
  h1: ({ node, children, ...props }) => (
    <h2 className={cn(headingClass, "text-base")} {...props}>
      <RunningText>{children}</RunningText>
    </h2>
  ),
  h2: ({ node, children, ...props }) => (
    <h2 className={cn(headingClass, "text-base")} {...props}>
      <RunningText>{children}</RunningText>
    </h2>
  ),
  h3: ({ node, children, ...props }) => (
    <h3 className={cn(headingClass, "text-sm")} {...props}>
      <RunningText>{children}</RunningText>
    </h3>
  ),
  h4: ({ node, children, ...props }) => (
    <h4 className={cn(headingClass, "text-sm")} {...props}>
      <RunningText>{children}</RunningText>
    </h4>
  ),
  h5: ({ node, children, ...props }) => (
    <h4 className={cn(headingClass, "text-sm")} {...props}>
      <RunningText>{children}</RunningText>
    </h4>
  ),
  h6: ({ node, children, ...props }) => (
    <h4 className={cn(headingClass, "text-sm")} {...props}>
      <RunningText>{children}</RunningText>
    </h4>
  ),
}

const boldParagraph: Components["h1"] = ({ children }) => (
  <p>
    <strong>
      <RunningText>{children}</RunningText>
    </strong>
  </p>
)

const commentComponents: Components = {
  ...shared,
  h1: boldParagraph,
  h2: boldParagraph,
  h3: boldParagraph,
  h4: boldParagraph,
  h5: boldParagraph,
  h6: boldParagraph,
}

// remarkGfm's own parsing runs before any of these, so capNesting is the first step to see the tree.
const remarkPlugins = [capNesting, remarkGfm, htmlAsText, imagesInLinksAsText, remarkBreaks]

const rootClass = "space-y-3 overflow-x-auto break-words text-foreground"

/** Shows the fallback while rendering `text` throws; a new text gets a fresh try. */
class RenderFailure extends Component<{ text: string; fallback: ReactNode; children: ReactNode }, { failed: boolean; text: string }> {
  state = { failed: false, text: this.props.text }

  static getDerivedStateFromProps(props: { text: string }, state: { text: string }) {
    return props.text === state.text ? null : { failed: false, text: props.text }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function Markdown({ children, look, className, renderText, literalText }: MarkdownProps) {
  return (
    <RenderFailure text={children} fallback={<div className={cn(rootClass, "whitespace-pre-wrap", className)}>{children}</div>}>
      <div className={cn(rootClass, className)}>
        <TextHooksContext.Provider value={{ renderText, literalText, inLabel: false }}>
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            urlTransform={urlTransform}
            components={look === "description" ? descriptionComponents : commentComponents}
          >
            {children}
          </ReactMarkdown>
        </TextHooksContext.Provider>
      </div>
    </RenderFailure>
  )
}
