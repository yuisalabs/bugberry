import { cn } from "cn"
import { isValidElement, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"

export interface MarkdownProps {
  children: string
  /** "description": headings are headings, below the page title. "comment": headings are bold body text. */
  look: "description" | "comment"
  className?: string
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

const textOf = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
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
const honestLabel = (children: ReactNode, href: string): ReactNode => {
  // Spaces and invisible format characters (zero-width space, word joiner) would otherwise let "​https://bank.com" skip the check.
  const label = textOf(children).replace(/[\s\p{Cf}]/gu, "")
  if (!/^(https?:\/\/|www\.)/i.test(label)) return children
  const labelHost = hostOf(label)
  return labelHost !== null && labelHost === hostOf(href) ? children : href
}

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
  code: ({ node, ...props }) => (
    <code className="rounded-sm border border-border bg-muted px-1 font-mono text-[0.9em]" {...props} />
  ),
  table: ({ node, ...props }) => (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({ node, ...props }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold" {...props} />
  ),
  td: ({ node, ...props }) => <td className="border border-border px-2 py-1" {...props} />,
  hr: ({ node, ...props }) => <hr className="border-border" {...props} />,
  a: ({ href, children }) =>
    href ? <ExternalLink href={href}>{honestLabel(children, href)}</ExternalLink> : <>{children}</>,
  // Loading an image would fetch a URL chosen by whoever wrote the text, so it is offered as a link instead.
  img: ({ src, alt }) =>
    typeof src === "string" && src ? <ExternalLink href={src}>{honestLabel(alt || src, src)}</ExternalLink> : <>{alt}</>,
}

const descriptionComponents: Components = {
  ...shared,
  h1: ({ node, ...props }) => <h2 className={cn(headingClass, "text-base")} {...props} />,
  h2: ({ node, ...props }) => <h2 className={cn(headingClass, "text-base")} {...props} />,
  h3: ({ node, ...props }) => <h3 className={cn(headingClass, "text-sm")} {...props} />,
  h4: ({ node, ...props }) => <h4 className={cn(headingClass, "text-sm")} {...props} />,
  h5: ({ node, ...props }) => <h4 className={cn(headingClass, "text-sm")} {...props} />,
  h6: ({ node, ...props }) => <h4 className={cn(headingClass, "text-sm")} {...props} />,
}

const boldParagraph: Components["h1"] = ({ children }) => (
  <p>
    <strong>{children}</strong>
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

export function Markdown({ children, look, className }: MarkdownProps) {
  return (
    <div className={cn("space-y-3 break-words text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        urlTransform={urlTransform}
        components={look === "description" ? descriptionComponents : commentComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
