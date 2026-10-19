const MAX_SLUG_LENGTH = 40

/** Lowercase ASCII words joined by single dashes, as the server's project slug pattern requires. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "")
}

export function parsePatterns(text: string): string[] {
  return [...new Set(text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0))]
}
