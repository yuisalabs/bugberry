import { describe, expect, test } from "bun:test"
import { BRIDGE_HELLO, BRIDGE_OPEN_POPUP, BRIDGE_STATUS } from "@bugberry/shared"
import { type BridgeDeps, bridgeSenderOrigin, confirmNotes, createBridge, installPageBridge, pageRequest, switchServer } from "../../lib/server/bridge"
import type { ReportDraft } from "../../lib/shared/types"

const BUGBERRY = "https://bugberry.kantor.com"
const STRANGER = "https://evil.example"

function setup(current: string | null = "https://app.bugberry.dev", popup: () => Promise<void> = async () => {}) {
  const checked: string[] = []
  const opened: string[] = []
  let popups = 0
  let currentCalls = 0
  const deps: BridgeDeps = {
    isBugBerryServer: async (origin) => {
      checked.push(origin)
      return origin === BUGBERRY || origin === "https://app.bugberry.dev"
    },
    currentServer: async () => {
      currentCalls += 1
      return current
    },
    openConfirm: async (origin) => void opened.push(origin),
    openPopup: async () => {
      popups += 1
      await popup()
    },
    version: () => "1.2.3",
  }
  return { bridge: createBridge(deps), checked, opened, popups: () => popups, currentCalls: () => currentCalls }
}

describe("bridge hello", () => {
  test("a page that is not a BugBerry server gets no answer", async () => {
    const { bridge, currentCalls } = setup()
    expect(await bridge.hello(STRANGER)).toBeNull()
    expect(currentCalls()).toBe(0)
  })

  test("a BugBerry dashboard learns only whether the extension uses it, and its version", async () => {
    expect(await setup(BUGBERRY).bridge.hello(BUGBERRY)).toEqual({ active: true, version: "1.2.3" })
    const answer = await setup("https://app.bugberry.dev").bridge.hello(BUGBERRY)
    expect(answer).toEqual({ active: false, version: "1.2.3" })
    expect(Object.keys(answer ?? {})).toEqual(["active", "version"])
  })

  test("each origin is checked once, failures included", async () => {
    const { bridge, checked } = setup()
    for (let i = 0; i < 10; i++) {
      await bridge.hello(BUGBERRY)
      await bridge.hello(STRANGER)
    }
    expect(checked).toEqual([BUGBERRY, STRANGER])
  })
})

describe("bridge openPopup", () => {
  test("openPopup only for the active server after a click", async () => {
    expect(pageRequest({ type: BRIDGE_OPEN_POPUP }, false)).toBeNull()
    expect(pageRequest({ type: BRIDGE_OPEN_POPUP }, true)).toBe("open-popup")

    const active = setup(BUGBERRY)
    expect(await active.bridge.openPopup(BUGBERRY)).toBe(true)
    expect(active.popups()).toBe(1)

    const elsewhere = setup("https://app.bugberry.dev")
    expect(await elsewhere.bridge.openPopup(BUGBERRY)).toBe(false)
    expect(elsewhere.popups()).toBe(0)

    const stranger = setup(STRANGER)
    expect(await stranger.bridge.openPopup(STRANGER)).toBe(false)
    expect(stranger.popups()).toBe(0)

    const failing = setup(BUGBERRY, async () => {
      throw new Error("no window")
    })
    expect(await failing.bridge.openPopup(BUGBERRY)).toBe(false)
  })
})

describe("bridge useServer", () => {
  test("a page that is not a BugBerry server cannot open the confirmation", async () => {
    const { bridge, opened } = setup()
    expect(await bridge.useServer(STRANGER)).toBe(false)
    expect(opened).toEqual([])
  })

  test("a BugBerry dashboard opens the confirmation for its own origin", async () => {
    const { bridge, opened } = setup()
    expect(await bridge.useServer(BUGBERRY)).toBe(true)
    expect(opened).toEqual([BUGBERRY])
  })
})

describe("confirmNotes", () => {
  const draft = (status: ReportDraft["status"], serverUrl?: string) =>
    ({ id: crypto.randomUUID(), status, session: serverUrl === undefined ? null : { serverUrl } }) as unknown as ReportDraft

  test("names the server reports go to now", () => {
    expect(confirmNotes([], BUGBERRY, "https://app.bugberry.dev", "BugBerry cloud")).toEqual([
      "Right now reports go to BugBerry cloud.",
    ])
    expect(confirmNotes([], BUGBERRY, null, "")).toEqual([])
    expect(confirmNotes([], BUGBERRY, BUGBERRY, "x")).toEqual([])
  })

  test("counts unsent reports, leaving out ones still recording", () => {
    expect(confirmNotes([draft("editing")], BUGBERRY, null, "")).toEqual([
      "You have 1 unsent report. It will be sent to the new server.",
    ])
    expect(confirmNotes([draft("editing"), draft("failed"), draft("uploading"), draft("recording")], BUGBERRY, null, "")).toEqual([
      "You have 3 unsent reports. They will be sent to the new server.",
    ])
  })

  test("warns that an upload started on another server starts again", () => {
    expect(confirmNotes([draft("failed", "https://app.bugberry.dev")], BUGBERRY, null, "")).toEqual([
      "You have 1 unsent report. It will be sent to the new server.",
      "An interrupted upload will start again on the new server.",
    ])
    expect(confirmNotes([draft("failed", BUGBERRY)], BUGBERRY, null, "")).toEqual([
      "You have 1 unsent report. It will be sent to the new server.",
    ])
  })
})

describe("bridgeSenderOrigin", () => {
  const tab = { id: 4 }

  test("the origin comes from Chrome's sender, for this extension's top-frame content script only", () => {
    expect(bridgeSenderOrigin({ id: "ext", tab, frameId: 0, origin: BUGBERRY }, "ext")).toBe(BUGBERRY)
    expect(bridgeSenderOrigin({ id: "ext", tab, frameId: 0, url: `${BUGBERRY}/app?x=1` }, "ext")).toBe(BUGBERRY)
    expect(bridgeSenderOrigin({ id: "ext", tab, frameId: 2, origin: BUGBERRY }, "ext")).toBeNull()
    expect(bridgeSenderOrigin({ id: "ext", frameId: 0, origin: BUGBERRY }, "ext")).toBeNull()
    expect(bridgeSenderOrigin({ id: "other", tab, frameId: 0, origin: BUGBERRY }, "ext")).toBeNull()
    expect(bridgeSenderOrigin({ id: "ext", tab, frameId: 0 }, "ext")).toBeNull()
    expect(bridgeSenderOrigin({ id: "ext", tab, frameId: 0, origin: "null" }, "ext")).toBeNull()
  })
})

describe("pageRequest", () => {
  test("a hello is always passed on; a server switch only right after the person clicked", () => {
    expect(pageRequest({ type: "bugberry:hello" }, false)).toBe("hello")
    expect(pageRequest({ type: "bugberry:use-server" }, true)).toBe("use-server")
    expect(pageRequest({ type: "bugberry:use-server" }, false)).toBeNull()
    expect(pageRequest({ type: "other" }, true)).toBeNull()
    expect(pageRequest(null, true)).toBeNull()
  })
})

describe("switchServer", () => {
  function memory(drafts: ReportDraft[]) {
    const saved = new Map(drafts.map((draft) => [draft.id, draft]))
    return {
      saved,
      store: {
        list: async () => [...saved.values()],
        put: async (draft: ReportDraft) => void saved.set(draft.id, draft),
      },
    }
  }
  const withSession = (id: string, serverUrl?: string) =>
    ({ id, status: "failed", session: { reportId: "r", ...(serverUrl ? { serverUrl } : {}) } }) as unknown as ReportDraft

  test("uploads started before servers were remembered are tied to the previous server", async () => {
    const { saved, store } = memory([withSession("legacy"), withSession("known", BUGBERRY), { id: "none", session: null } as unknown as ReportDraft])
    const stored: string[] = []
    await switchServer(BUGBERRY, "https://app.bugberry.dev", store, async (value) => void stored.push(value.serverUrl))
    expect(saved.get("legacy")?.session?.serverUrl).toBe("https://app.bugberry.dev")
    expect(saved.get("known")?.session?.serverUrl).toBe(BUGBERRY)
    expect(stored).toEqual([BUGBERRY])
  })

  test("with no previous server, such uploads start again", async () => {
    const { saved, store } = memory([withSession("legacy")])
    await switchServer(BUGBERRY, null, store, async () => {})
    expect(saved.get("legacy")?.session).toBeNull()
  })
})

describe("installPageBridge", () => {
  const ORIGIN = "https://bugberry.kantor.com"

  function page(alive: () => boolean, send: (message: unknown) => Promise<unknown>) {
    const listeners = new Set<(event: MessageEvent) => void>()
    const posted: unknown[] = []
    const fakeWindow = {
      addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => void listeners.add(listener),
      removeEventListener: (_type: "message", listener: (event: MessageEvent) => void) => void listeners.delete(listener),
      postMessage: (message: unknown) => void posted.push(message),
    }
    installPageBridge({ window: fakeWindow, origin: ORIGIN, userActive: () => false, alive, send })
    const dispatch = (data: unknown) => {
      for (const listener of [...listeners]) listener({ source: fakeWindow, origin: ORIGIN, data } as unknown as MessageEvent)
    }
    return { listeners, posted, dispatch }
  }

  test("answers a hello with the background's reply", async () => {
    const { posted, dispatch } = page(() => true, async () => ({ active: true, version: "1.2.3" }))
    dispatch({ type: BRIDGE_HELLO })
    await Bun.sleep(0)
    expect(posted).toEqual([{ type: BRIDGE_STATUS, active: true, version: "1.2.3" }])
  })

  // Chrome leaves the old script in open tabs when the extension reloads; sending from it throws at once.
  test("left behind by a reload, it stops listening instead of throwing", () => {
    let sent = 0
    const { listeners, posted, dispatch } = page(
      () => false,
      () => {
        sent += 1
        throw new Error("Extension context invalidated.")
      },
    )
    expect(() => dispatch({ type: BRIDGE_HELLO })).not.toThrow()
    expect(sent).toBe(0)
    expect(listeners.size).toBe(0)
    expect(posted).toEqual([])
  })
})
