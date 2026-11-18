import { cn } from "cn"
import { Children, createContext, isValidElement, useContext, type ComponentProps, type ReactNode } from "react"
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
  const visit = (parent: TreeNode) => {
    const inline = inlineParents.has(parent.type)
    parent.children = parent.children?.map((child) => {
      if (child.type !== "html") {
        visit(child)
        return child
      }
      const text = { type: "text", value: child.value ?? "" }
      return inline ? text : { type: "paragraph", children: [text] }
    })
  }
  return visit
}

/**
 * An image inside a link would become a second link inside the first. Its alt,
 * or its URL when the alt is empty, becomes plain text in the outer link's
 * label instead, so the label check below sees it.
 */
function imagesInLinksAsText() {
  const visit = (parent: TreeNode, inLink: boolean) => {
    parent.children = parent.children?.map((child) => {
      if (inLink && (child.type === "image" || child.type === "imageReference")) return { type: "text", value: child.alt || child.url || "" }
      visit(child, inLink || child.type === "link" || child.type === "linkReference")
      return child
    })
  }
  return (tree: TreeNode) => visit(tree, false)
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

/**
 * A label that looks like a URL but points at another host than the link is
 * how phishing reads "bank.com" while going elsewhere, so such a label is
 * replaced by the real target.
 */
const isHonest = (children: ReactNode, href: string, rewrite: (text: string) => string) => {
  // Spaces and invisible format characters (zero-width space, word joiner) would otherwise let "​https://bank.com" skip the check.
  const label = textOf(children, rewrite).replace(/[\s\p{Cf}]/gu, "")
  if (!/^(https?:\/\/|www\.)/i.test(label)) return true
  const labelHost = hostOf(label)
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
  return <ExternalLink href={href}>{isHonest(children, href, literalText) ? <Label>{children}</Label> : href}</ExternalLink>
}

// Loading an image would fetch a URL chosen by whoever wrote the text, so it is offered as a link instead.
function ImageOverride({ src, alt }: { src?: string | Blob; alt?: string }) {
  const { literalText = unchanged } = useContext(TextHooksContext)
  if (typeof src !== "string" || !src) return <>{literalText(alt ?? "")}</>
  const label = literalText(alt || src)
  return <ExternalLink href={src}>{isHonest(label, src, unchanged) ? label : src}</ExternalLink>
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
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground" {...props} />
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
  li: ({ node, children, ...props }) => (
    <li {...props}>
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

const remarkPlugins = [remarkGfm, htmlAsText, imagesInLinksAsText, remarkBreaks]

export function Markdown({ children, look, className, renderText, literalText }: MarkdownProps) {
  return (
    <div className={cn("space-y-3 break-words text-foreground", className)}>
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
  )
}
