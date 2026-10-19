import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { describeElement, fieldValue, isMasked } from "../src/describe"

let win: Window
let doc: Document

beforeEach(() => {
  win = new Window({ url: "https://app.kantor.test/" })
  doc = win.document as unknown as Document
  doc.body.innerHTML = `
    <button id="buy" class="btn primary extra">  Buy   now </button>
    <a data-testid="help-link">Help with a very long label that keeps going and going</a>
    <input id="email" name="email" value="ana@kantor.test">
    <input id="pw" type="password" value="hunter2">
    <input id="agree" type="checkbox" checked>
    <section data-bugberry-mask><button id="card">Card 4111 1111</button><input id="cvc" value="123"></section>
  `
})

afterEach(async () => {
  await win.happyDOM.close()
})

const byId = (id: string) => doc.getElementById(id) as Element

describe("the older mask attribute", () => {
  test("data-fdebag-mask still hides an area, as data-bugberry-mask does", () => {
    doc.body.innerHTML = `<div data-fdebag-mask><button id="old">4111 1111</button></div>`
    expect(isMasked(byId("old"))).toBe(true)
  })
})

describe("describeElement", () => {
  test("uses tag, id, first two classes and visible text", () => {
    expect(describeElement(byId("buy"))).toBe('button#buy.btn.primary "Buy now"')
  })

  test("uses data-testid and shortens long text", () => {
    const link = doc.querySelector("a") as Element
    expect(describeElement(link)).toBe('a[data-testid="help-link"] "Help with a very long label that keeps g…"')
  })

  test("never includes form field values or text inside masked areas", () => {
    expect(describeElement(byId("email"))).toBe('input#email[name="email"]')
    expect(describeElement(byId("card"))).toBe("button#card")
  })
})

describe("fieldValue", () => {
  test("masks ordinary values character by character", () => {
    expect(fieldValue(byId("email"))).toBe("•".repeat("ana@kantor.test".length))
  })

  test("records nothing for passwords and masked areas", () => {
    expect(isMasked(byId("pw"))).toBe(true)
    expect(fieldValue(byId("pw"))).toBeUndefined()
    expect(fieldValue(byId("cvc"))).toBeUndefined()
  })

  test("reports checkbox state", () => {
    expect(fieldValue(byId("agree"))).toBe("checked")
  })
})

describe("describeElement text sources", () => {
  test("text inside masked descendants never appears in an ancestor's label", () => {
    doc.body.innerHTML = `<div id="card"><span data-bugberry-mask>4111 1111 1111 1111</span> pay</div>`
    expect(describeElement(byId("card"))).toBe('div#card "pay"')
  })

  test("editable content, textareas and scripts are not used as label text", () => {
    doc.body.innerHTML = `
      <div contenteditable="true" id="editor"><p id="para">my private message</p></div>
      <form id="f"><textarea>secret typed</textarea><script>var apiKey = 1</script><button>Go</button></form>
    `
    expect(describeElement(byId("para"))).toBe("p#para")
    expect(describeElement(byId("editor"))).toBe("div#editor")
    expect(describeElement(byId("f"))).toBe('form#f "Go"')
  })
})
