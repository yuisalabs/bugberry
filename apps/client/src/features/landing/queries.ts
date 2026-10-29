import type { DemoRequestInput } from "@bugberry/shared"
import { eden } from "../../lib/query/eden"
import { unwrap } from "../../lib/query/unwrap"

/** "Book your demo" on the public site. */
export const requestDemo = (input: DemoRequestInput) => unwrap(eden.api["demo-requests"].post(input))
