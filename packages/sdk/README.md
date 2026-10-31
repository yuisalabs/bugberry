# @bugberry/sdk

Add your app's own logs and state to [BugBerry](https://bugberry.yuisalabs.com) bug reports.

```sh
npm install @bugberry/sdk
```

```ts
import { bugberry } from "@bugberry/sdk"

bugberry.metadata(() => ({ userId: store.user.id, flags: store.flags }))

bugberry.log("Checkout started", { orderId: 8812 })
bugberry.info("Coupon applied", { code: "SPRING" })
bugberry.warn("Retrying payment", { attempt: 2 })
bugberry.error("Payment declined", { code: "card_declined" })
```

Without the BugBerry extension in the browser, these calls do nothing: no network, no errors, at most 50 entries kept in memory.

MIT licensed.
