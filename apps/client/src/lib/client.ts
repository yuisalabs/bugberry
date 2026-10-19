import { createApi } from "./api"

/** The dashboard's API client: same origin as the page, so the session cookie goes along. */
export const api = createApi()
