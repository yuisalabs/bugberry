import { BASE_PATH } from "@/lib/base-path"

/**
 * A picture of the app, made by `bun run docs:screenshots`. `src` is under /screenshots, without the base path:
 * a plain `<img>` doesn't get it from Next. `width` is the display width; the PNGs are drawn at twice that.
 */
export function Screenshot({ src, alt, width }: { src: string; alt: string; width?: number }) {
  return (
    <img
      src={`${BASE_PATH}${src}`}
      alt={alt}
      width={width}
      loading="lazy"
      decoding="async"
      className="my-6 h-auto max-w-full rounded-lg border border-fd-border"
    />
  )
}
