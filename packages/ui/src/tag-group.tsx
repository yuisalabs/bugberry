"use client"

import { RiCloseLine } from "@remixicon/react"
import { Button } from "react-aria-components/Button"
import type { TagGroupProps, TagListProps, TagProps } from "react-aria-components/TagGroup"
import {
  Tag as PrimitiveTag,
  TagGroup as PrimitiveTagGroup,
  TagList as PrimitiveTagList,
} from "react-aria-components/TagGroup"
import { cn } from "cn"
import { cx } from "./primitive"

export function TagGroup({ className, ...props }: TagGroupProps) {
  return (
    <PrimitiveTagGroup
      data-slot="control"
      className={cn("flex flex-col gap-y-1 *:data-[slot=label]:font-medium", className)}
      {...props}
    />
  )
}

export function TagList<T extends object>({ className, ...props }: TagListProps<T>) {
  return <PrimitiveTagList className={cx("flex flex-wrap gap-1", className)} {...props} />
}

export function Tag({ children, className, ...props }: TagProps) {
  const textValue = typeof children === "string" ? children : undefined

  return (
    <PrimitiveTag
      textValue={textValue}
      // BugBerry's chips: the primary colour on its subtle tint, as on the Members page's invite field.
      className={cx(
        "bg-primary-subtle text-primary-subtle-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        "inline-flex items-center gap-x-1 py-0.5 font-medium text-sm/6 forced-colors:outline",
        "*:[svg]:size-3 *:[svg]:shrink-0",
        "cursor-default rounded-md ps-2.5 pe-1.5",
        "selected:bg-primary selected:text-primary-foreground",
        "disabled:opacity-50 disabled:forced-colors:text-[GrayText]",
        props.href && "cursor-pointer hover:inset-ring-muted-foreground",
        className
      )}
      {...props}
    >
      {({ allowsRemoving }) => (
        <>
          {children}
          {allowsRemoving && (
            <Button slot="remove" className="grid size-5 place-content-center rounded outline-hidden hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring">
              <RiCloseLine className="size-3.5" />
            </Button>
          )}
        </>
      )}
    </PrimitiveTag>
  )
}
