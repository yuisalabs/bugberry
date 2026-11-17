import type { LabelColor } from "@bugberry/shared"

// The theme's semantic tokens cover five hues; labels need nine, so these use Tailwind's palette, 800 on 100 in light
// and 300 on a 15% tint in dark.
const CLASSES: Record<LabelColor, string> = {
  gray: "bg-zinc-100 text-zinc-800 dark:bg-zinc-500/15 dark:text-zinc-300",
  red: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
  green: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300",
}

export function labelColorClass(color: LabelColor): string {
  return CLASSES[color]
}

/** The swatch beside a color's name in menus. */
export const LABEL_SWATCHES: Record<LabelColor, string> = {
  gray: "bg-zinc-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
}
