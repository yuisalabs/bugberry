export const BUFFER_MAX_AGE_MS = 5 * 60 * 1000
export const BUFFER_MAX_EVENTS = 1000
export const MAX_BODY_CHARS = 10 * 1024
export const MAX_ARG_CHARS = 2 * 1024
export const MAX_STACK_CHARS = 4 * 1024
/** Responses that announce a larger content-length are not read. */
export const MAX_RESPONSE_READ_BYTES = 1024 * 1024
export const SCROLL_THROTTLE_MS = 1000
/** Presses on one element this close together count toward a rage click. */
export const RAGE_CLICK_GAP_MS = 1000
export const RAGE_CLICK_MIN_PRESSES = 3
export const MAX_TARGET_TEXT_CHARS = 40
export const MAX_MASKED_VALUE_CHARS = 50
export const MAX_CONSOLE_ARGS = 20
/** Page resources kept per page, so they never crowd out logs, errors and actions. */
export const MAX_RESOURCE_EVENTS = 300
/** The app's own SDK logs kept per page, so a logging loop never crowds out the rest. */
export const MAX_SDK_EVENTS = 300
/** JSON size of the app's custom fields; whole top-level keys past it are dropped and counted. */
export const MAX_METADATA_CHARS = 10 * 1024
export const MAX_METADATA_DEPTH = 8
export const MAX_URL_CHARS = 2048
