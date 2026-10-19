/** Up to two initials for an avatar without a picture, e.g. "Ervalsa Dwi Nanda" → "ED". */
export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  )
}
