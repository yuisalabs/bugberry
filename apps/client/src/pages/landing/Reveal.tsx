import type { ElementType, HTMLAttributes, ReactNode } from "react"
import { type RevealOptions, useReveal } from "./useReveal"

/** Any element that comes in once (see useReveal); `as` picks the tag, other props pass through. */
export function Reveal({
  as: Tag = "div",
  variant,
  delay,
  immediate,
  children,
  ...props
}: RevealOptions & HTMLAttributes<HTMLElement> & { as?: ElementType; href?: string; children: ReactNode }) {
  const reveal = useReveal({ variant, delay, immediate })
  return (
    <Tag {...props} {...reveal}>
      {children}
    </Tag>
  )
}
