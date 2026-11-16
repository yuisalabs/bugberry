import { notFound } from "../../lib/errors"

/** One answer for every dead link (unknown, expired, revoked, used up, or its maker gone), so none can be told apart. */
export const requestUnavailable = () => notFound("request_unavailable", "This link doesn't take recordings.")
