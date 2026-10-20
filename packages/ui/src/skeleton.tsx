import { cn } from "cn"

/** A placeholder in the shape of content that is still loading. Hidden from screen readers; announce the loading elsewhere. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-secondary motion-reduce:animate-none", className)}
      {...props}
    />
  )
}
