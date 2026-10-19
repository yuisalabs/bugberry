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
export const MAX_URL_CHARS = 2048
