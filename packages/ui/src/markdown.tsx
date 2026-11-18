import { cn } from "cn"
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

const remarkPlugins = [remarkGfm, htmlAsText, remarkBreaks]

export function Markdown({ children, look, className }: MarkdownProps) {
  return (
    <div className={cn("space-y-3 break-words text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={look === "description" ? descriptionComponents : commentComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
