/** "250 MB", "1.5 GB", "0.4 MB": a file or storage size for people to read. */
export function sizeLabel(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${Number((mb / 1024).toFixed(1))} GB`
  return `${mb >= 10 ? Math.round(mb) : Number(mb.toFixed(1))} MB`
}
