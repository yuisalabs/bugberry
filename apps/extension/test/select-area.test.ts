import { describe, expect, test } from "bun:test"
import { areaPickFrom, cropBox, pickArea } from "../lib/select-area"

function pointer(type: string, x: number, y: number) {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 }))
}

const overlay = () => document.querySelector("[data-bugberry-area]")

describe("pickArea", () => {
  test("a drag gives its box, and the overlay is gone before the answer", async () => {
    const picked = pickArea()
    expect(overlay()).not.toBeNull()
    pointer("pointerdown", 10, 20)
    pointer("pointermove", 60, 40)
    pointer("pointerup", 110, 70)
    expect(await picked).toEqual({ kind: "area", rect: { x: 10, y: 20, width: 100, height: 50 }, pixelRatio: window.devicePixelRatio })
    expect(overlay()).toBeNull()
  })

  test("dragging up and left gives the same box", async () => {
    const picked = pickArea()
    pointer("pointerdown", 110, 70)
    pointer("pointerup", 10, 20)
    expect(await picked).toMatchObject({ kind: "area", rect: { x: 10, y: 20, width: 100, height: 50 } })
  })

  test("Esc cancels", async () => {
    const picked = pickArea()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(await picked).toEqual({ kind: "cancel" })
    expect(overlay()).toBeNull()
  })

  test("while dragging, the box's size shows next to the cursor", async () => {
    // The overlay's shadow root is closed in the page; opened here so the test can read it.
    const attach = HTMLElement.prototype.attachShadow
    let shadow = null as ShadowRoot | null
    HTMLElement.prototype.attachShadow = function (init) {
      shadow = attach.call(this, { ...init, mode: "open" })
      return shadow
    }
    try {
      const picked = pickArea()
      pointer("pointerdown", 10, 20)
      pointer("pointermove", 330.4, 200)
      expect(shadow?.textContent).toContain("320 × 180")
      pointer("pointerup", 330, 200)
      await picked
    } finally {
      HTMLElement.prototype.attachShadow = attach
    }
  })

  test("a click without a drag takes the visible area", async () => {
    const picked = pickArea()
    pointer("pointerdown", 50, 50)
    pointer("pointerup", 52, 51)
    expect(await picked).toEqual({ kind: "visible" })
  })
})

describe("cropBox", () => {
  test("turns CSS pixels into device pixels", () => {
    expect(cropBox({ x: 10, y: 20, width: 100, height: 50 }, 2, { width: 2880, height: 1800 })).toEqual({
      x: 20,
      y: 40,
      width: 200,
      height: 100,
    })
  })

  test("keeps the box inside the image", () => {
    expect(cropBox({ x: 1400, y: 880, width: 100, height: 50 }, 2, { width: 2880, height: 1800 })).toEqual({
      x: 2800,
      y: 1760,
      width: 80,
      height: 40,
    })
  })
})

test("areaPickFrom accepts only a well-formed answer from the page", () => {
  expect(areaPickFrom({ kind: "area", rect: { x: "1" } })).toBeNull()
  expect(areaPickFrom({ kind: "area", rect: { x: 1, y: 2, width: 3, height: 4 }, pixelRatio: 2 })).toEqual({
    kind: "area",
    rect: { x: 1, y: 2, width: 3, height: 4 },
    pixelRatio: 2,
  })
  expect(areaPickFrom({ kind: "area", rect: { x: 1, y: 2, width: 0, height: 4 }, pixelRatio: 2 })).toBeNull()
  expect(areaPickFrom({ kind: "visible" })).toEqual({ kind: "visible" })
  expect(areaPickFrom({ kind: "cancel" })).toEqual({ kind: "cancel" })
  expect(areaPickFrom("junk")).toBeNull()
})

describe("pickArea edges", () => {
  test("a second overlay isn't stacked on the first: one drag, one screenshot", async () => {
    const first = pickArea()
    expect(await pickArea()).toEqual({ kind: "cancel" })
    expect(document.querySelectorAll("[data-bugberry-area]")).toHaveLength(1)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await first
  })

  test("only the left button drags; a right click does nothing", async () => {
    const picked = pickArea()
    window.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, button: 2 }))
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 200, clientY: 200, button: 2 }))
    const menu = new MouseEvent("contextmenu", { cancelable: true })
    window.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    expect(overlay()).not.toBeNull()
    pointer("pointerdown", 10, 20)
    pointer("pointerup", 110, 70)
    expect(await picked).toMatchObject({ kind: "area", rect: { width: 100, height: 50 } })
  })

  test("a drag the browser takes over (touch, pen) cancels", async () => {
    const picked = pickArea()
    pointer("pointerdown", 10, 20)
    window.dispatchEvent(new MouseEvent("pointercancel"))
    expect(await picked).toEqual({ kind: "cancel" })
  })
})

test("the click that ends a drag doesn't reach the page", async () => {
  let pageClicks = 0
  const onPageClick = () => {
    pageClicks += 1
  }
  document.body.addEventListener("click", onPageClick)
  const picked = pickArea()
  pointer("pointerdown", 10, 20)
  pointer("pointerup", 110, 70)
  document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  await picked
  document.body.removeEventListener("click", onPageClick)
  expect(pageClicks).toBe(0)
})

describe("pickArea after it ends", () => {
  test("after Esc the reporter's next click reaches the page", async () => {
    // Past the previous test's drag, whose own click guard lasts 300 ms.
    await new Promise((resolve) => setTimeout(resolve, 350))
    let pageClicks = 0
    const onPageClick = () => {
      pageClicks += 1
    }
    const picked = pickArea()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await picked
    document.body.addEventListener("click", onPageClick)
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    document.body.removeEventListener("click", onPageClick)
    expect(pageClicks).toBe(1)
  })

  test("a page can't block Select area by planting the overlay's marker", async () => {
    const fake = document.createElement("div")
    fake.setAttribute("data-bugberry-area", "")
    document.body.append(fake)
    const picked = pickArea()
    // The real overlay still opens next to the fake one, and the drag works.
    expect(document.querySelectorAll("[data-bugberry-area]")).toHaveLength(2)
    pointer("pointerdown", 10, 20)
    pointer("pointerup", 110, 70)
    expect(await picked).toMatchObject({ kind: "area" })
    fake.remove()
  })

  test("a second press while the first answer is on its way gives no second overlay", async () => {
    const first = pickArea()
    pointer("pointerdown", 10, 20)
    pointer("pointerup", 110, 70)
    // The first overlay is gone but hasn't answered yet (two painted frames).
    expect(await pickArea()).toEqual({ kind: "cancel" })
    expect(await first).toMatchObject({ kind: "area" })
  })
})
