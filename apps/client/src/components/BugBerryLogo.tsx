/**
 * The hand-drawn BugBerry logo: the icon with the name (public/assets/bugberry_logo_small.webp), or the icon
 * alone (bugberry_icon_small.webp). Both are small copies of the originals next to them. `className` sets the
 * size; by default the logo is 28 px tall.
 */
export function BugBerryLogo({ className = "", withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  // The image sits in its own inline box: a flex column (the landing footer) stretches the box, not the image.
  return (
    <span className="inline-flex">
      {withWordmark ? (
        <img src="/assets/bugberry_logo_small.webp" alt="BugBerry" className={`w-auto ${className || "h-7"}`} />
      ) : (
        <img src="/assets/bugberry_icon_small.webp" alt="BugBerry" className={`object-contain ${className || "size-7"}`} />
      )}
    </span>
  )
}
