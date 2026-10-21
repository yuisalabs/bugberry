import { describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { CommentsSection } from "../src/components/comments/CommentsSection"
import { ReportVideoContext } from "../src/components/report/video-context"
import type { CommentThread } from "../src/lib/api"
import { activityFixture, commentFixture, threadFixture } from "./fixtures"

const ana = { id: "u1", name: "Ana", image: null }
const budi = { id: "u2", name: "Budi", image: null }
const people = [
  { id: "u1", name: "Ana", email: "ana@kantor.test" },
  { id: "u2", name: "Budi", email: "budi@kantor.test" },
]

const threads: CommentThread[] = [
  threadFixture({
    id: "c2",
    body: "Saya cek",
    author: budi,
    createdAt: new Date("2026-10-16T09:00:00Z"),
    replies: [commentFixture({ id: "r1", parentId: "c2", body: "Thanks", author: ana, createdAt: new Date("2026-10-16T09:10:00Z") })],
  }),
  threadFixture({ id: "c1", body: "<b>bukan html</b>\nbaris kedua", author: ana, createdAt: new Date("2026-10-16T08:00:00Z") }),
]

type Props = ComponentProps<typeof CommentsSection>
const setup = (overrides: Partial<Props> = {}) => {
  const props: Props = {
    threads,
    activity: null,
    people,
    me: { id: "u1", role: "member", name: "Ana", image: null },
    busy: false,
    showActivity: false,
    onShowActivity: mock(),
    onAdd: mock(async () => {}),
    onEdit: mock(async () => {}),
    onDelete: mock(),
    onReact: mock(),
    ...overrides,
  }
  return { props, ...render(<CommentsSection {...props} />) }
}
const commentEl = (id: string) => document.getElementById(`comment-${id}`) as HTMLElement
const openActions = (id: string) => fireEvent.click(within(commentEl(id)).getByRole("button", { name: "Comment actions" }))

describe("the comments section", () => {
  test("shows comments as plain text with their authors, newest thread first, replies under it", () => {
    setup()
    expect(document.querySelector("b")).toBeNull()
    expect(screen.getByText(/<b>bukan html<\/b>/)).toBeTruthy()
    const ids = [...document.querySelectorAll("[id^=comment-]")].map((element) => element.id)
    expect(ids).toEqual(["comment-c2", "comment-r1", "comment-c1"])
    expect(within(commentEl("c2")).getByText("Budi")).toBeTruthy()
  })

  test("the heading counts comments and replies", () => {
    setup()
    expect(screen.getByRole("heading", { name: /Comments/ }).textContent).toContain("3")
  })

  test("the box sits above the feed; it adds a trimmed comment and clears; empty text cannot be sent", async () => {
    const { props } = setup()
    const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
    expect(box.compareDocumentPosition(commentEl("c2")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const send = screen.getByRole("button", { name: "Post comment" }) as HTMLButtonElement
    fireEvent.change(box, { target: { value: "   " } })
    expect(send.disabled).toBe(true)
    fireEvent.change(box, { target: { value: "  Sudah diperbaiki  " } })
    fireEvent.click(send)
    expect(props.onAdd).toHaveBeenCalledWith("Sudah diperbaiki", undefined)
    await waitFor(() => expect(box.value).toBe(""))
  })

  test("Enter sends the comment; Ctrl or Cmd + Enter adds a new line; the box says so", () => {
    const { props } = setup()
    const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
    expect(screen.getByText("Ctrl + Enter for a new line")).toBeTruthy()
    fireEvent.change(box, { target: { value: "Baris satu" } })
    box.setSelectionRange(box.value.length, box.value.length)
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true })
    expect(box.value).toBe("Baris satu\n")
    fireEvent.change(box, { target: { value: "Baris satu\nbaris dua" } })
    box.setSelectionRange(box.value.length, box.value.length)
    fireEvent.keyDown(box, { key: "Enter", metaKey: true })
    expect(box.value).toBe("Baris satu\nbaris dua\n")
    expect(props.onAdd).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: "Enter" })
    expect(props.onAdd).toHaveBeenCalledWith("Baris satu\nbaris dua", undefined)
  })

  test("Enter does not send again while a comment is still saving", () => {
    const { props } = setup({ busy: true })
    const box = screen.getByRole("textbox", { name: "New comment" })
    fireEvent.change(box, { target: { value: "Dua kali" } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(props.onAdd).not.toHaveBeenCalled()
  })

  test("Enter on an empty box sends nothing, and Enter in a reply box sends the reply", () => {
    const { props } = setup()
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New comment" }), { key: "Enter" })
    expect(props.onAdd).not.toHaveBeenCalled()
    fireEvent.click(within(commentEl("c1")).getByRole("button", { name: "Reply" }))
    const reply = screen.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement
    fireEvent.change(reply, { target: { value: "Siap" } })
    fireEvent.keyDown(reply, { key: "Enter" })
    expect(props.onAdd).toHaveBeenCalledWith("Siap", "c1")
  })

  test("You, edited and via AI show on a comment", () => {
    setup({
      threads: [threadFixture({ id: "c9", author: ana, edited: true, viaAgent: "Claude Code" })],
    })
    const item = commentEl("c9")
    expect(within(item).getByText("You")).toBeTruthy()
    expect(within(item).getByText(/edited/)).toBeTruthy()
    expect(within(item).getByText("via AI")).toBeTruthy()
  })

  test("only the author can edit; the author or an admin can delete, from the ⋯ menu", async () => {
    const { props, unmount } = setup()
    openActions("c1")
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), { target: { value: "Updated" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(props.onEdit).toHaveBeenCalledWith("c1", "Updated")
    expect(within(commentEl("c2")).queryByRole("button", { name: "Comment actions" })).toBeNull()
    unmount()

    const admin = setup({ me: { id: "u9", role: "admin", name: "Admin", image: null } })
    openActions("c2")
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull()
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
    const dialog = screen.getByRole("alertdialog", { name: "Delete this comment?" })
    expect(admin.props.onDelete).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })))
    expect(admin.props.onDelete).toHaveBeenCalledWith("c2")
  })

  test("a comment that fails to save keeps the typed text and the open editor", async () => {
    const offline = async () => Promise.reject(new Error("offline"))
    setup({ onAdd: mock(offline), onEdit: mock(offline) })
    const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "Teks panjang yang sudah diketik" } })
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }))
    openActions("c1")
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), { target: { value: "Edited" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(box.value).toBe("Teks panjang yang sudah diketik")
    expect((screen.getByRole("textbox", { name: "Edit comment" }) as HTMLTextAreaElement).value).toBe("Edited")
  })

  test("Reply on a first comment answers it; Reply on a reply answers in the same thread, mentioning its author", () => {
    const { props } = setup({ me: { id: "u3", role: "member", name: "Citra", image: null } })
    fireEvent.click(within(commentEl("r1")).getByRole("button", { name: "Reply" }))
    const box = screen.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement
    expect(box.value).toBe("@Ana ")
    fireEvent.change(box, { target: { value: "@Ana makasih" } })
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }))
    expect(props.onAdd).toHaveBeenCalledWith("@[user:u1] makasih", "r1")
    fireEvent.click(within(commentEl("c1")).getByRole("button", { name: "Reply" }))
    const thread = commentEl("c1").closest("article") as HTMLElement
    expect((within(thread).getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe("")
  })

  test("reactions toggle, own ones are pressed, and the button names who reacted", () => {
    const { props } = setup({
      threads: [
        threadFixture({
          id: "c5",
          reactions: [
            { emoji: "👍", count: 2, people: [{ id: "u1", name: "Ana" }, { id: "u2", name: "Budi" }] },
            { emoji: "❤️", count: 1, people: [{ id: "u2", name: "Budi" }] },
          ],
        }),
      ],
    })
    const thumbs = within(commentEl("c5")).getByRole("button", { name: /👍/ })
    expect(thumbs.getAttribute("aria-pressed")).toBe("true")
    expect(thumbs.getAttribute("aria-label")).toContain("Ana and Budi")
    expect(within(commentEl("c5")).getByRole("button", { name: /❤️/ }).getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(thumbs)
    expect(props.onReact).toHaveBeenCalledWith("c5", "👍")
  })

  test("picking an emoji you already reacted with keeps your reaction", () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
    localStorage.setItem("bugberry.recentEmoji", JSON.stringify(["👍", "🎉"]))
    const { props } = setup({
      threads: [threadFixture({ id: "c6", reactions: [{ emoji: "👍", count: 1, people: [{ id: "u1", name: "Ana" }] }] })],
    })
    fireEvent.click(within(commentEl("c6")).getByRole("button", { name: "Add reaction" }))
    fireEvent.click(screen.getByRole("button", { name: "👍" }))
    expect(props.onReact).not.toHaveBeenCalled()
    fireEvent.click(within(commentEl("c6")).getByRole("button", { name: "Add reaction" }))
    fireEvent.click(screen.getByRole("button", { name: "🎉" }))
    expect(props.onReact).toHaveBeenCalledWith("c6", "🎉")
    localStorage.clear()
  })

  test("a deleted first comment shows as a placeholder with its replies", () => {
    setup({
      threads: [
        threadFixture({
          id: "c7",
          deleted: true,
          author: null,
          body: "",
          replies: [commentFixture({ id: "r7", parentId: "c7", author: budi, body: "Still here" })],
        }),
      ],
    })
    expect(within(commentEl("c7")).getByText("This comment was deleted")).toBeTruthy()
    expect(within(commentEl("c7")).queryByRole("button", { name: "Comment actions" })).toBeNull()
    expect(within(commentEl("r7")).getByText("Still here")).toBeTruthy()
  })

  test("Comments only hides activity; All activity shows it between threads", () => {
    const line = activityFixture({ id: "a1", at: new Date("2026-10-16T08:30:00Z"), actor: budi, viaAgent: "Claude Code" })
    const { props, unmount } = setup({ activity: [line] })
    expect(screen.queryByText(/changed status/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "All activity" }))
    expect(props.onShowActivity).toHaveBeenCalledWith(true)
    unmount()

    setup({ activity: [line], showActivity: true })
    const text = document.body.textContent ?? ""
    expect(text).toContain("Budi via Claude Code")
    expect(text.indexOf("changed status from Open to In progress")).toBeGreaterThan(text.indexOf("Saya cek"))
    expect(text.indexOf("changed status from Open to In progress")).toBeLessThan(text.indexOf("bukan html"))
  })

  test("a video time is a seek button only on a video report", () => {
    const timed = [threadFixture({ id: "c8", body: "The 500 starts right at 0:52" })]
    const { unmount } = setup({ threads: timed })
    expect(within(commentEl("c8")).queryByRole("button", { name: /0:52/ })).toBeNull()
    unmount()

    const seek = mock()
    render(
      <ReportVideoContext.Provider value={{ seek, durationMs: 116_000 }}>
        <CommentsSection
          threads={timed}
          activity={null}
          people={people}
          me={{ id: "u1", role: "member", name: "Ana", image: null }}
          busy={false}
          showActivity={false}
          onShowActivity={mock()}
          onAdd={mock(async () => {})}
          onEdit={mock(async () => {})}
          onDelete={mock()}
          onReact={mock()}
        />
      </ReportVideoContext.Provider>,
    )
    fireEvent.click(within(commentEl("c8")).getByRole("button", { name: /0:52/ }))
    expect(seek).toHaveBeenCalledWith(52_000)
  })

  describe("mentions", () => {
    const tagged = threadFixture({
      id: "c3",
      body: "@[user:u1] cek, @[user:gone] juga",
      author: budi,
      mentions: [{ id: "u1", name: "Ana" }],
    })

    test("typing @ suggests members, and sending stores the mention", () => {
      const { props } = setup({ threads: [], me: { id: "u3", role: "member", name: "Citra", image: null } })
      const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
      expect(box.placeholder).toBe("Comment or @ to mention")
      fireEvent.change(box, { target: { value: "cek @ana" } })
      const list = screen.getByRole("listbox", { name: "Mention someone" })
      expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual(["Anaana@kantor.test"])
      fireEvent.keyDown(box, { key: "Enter" })
      expect(box.value).toBe("cek @Ana ")
      fireEvent.change(box, { target: { value: "cek @Ana tolong @" } })
      fireEvent.keyDown(box, { key: "ArrowDown" })
      fireEvent.keyDown(box, { key: "Tab" })
      expect(box.value).toBe("cek @Ana tolong @Budi ")
      fireEvent.click(screen.getByRole("button", { name: "Post comment" }))
      expect(props.onAdd).toHaveBeenCalledWith("cek @[user:u1] tolong @[user:u2]", undefined)
    })

    test("the @ button starts a mention in the box", () => {
      setup({ threads: [], me: { id: "u3", role: "member", name: "Citra", image: null } })
      const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: "cek" } })
      fireEvent.click(screen.getByRole("button", { name: "Mention someone" }))
      expect(box.value).toBe("cek @")
      expect(screen.getAllByRole("option")).toHaveLength(2)
    })

    test("Escape closes the list and a click picks", () => {
      setup({ threads: [], me: { id: "u3", role: "member", name: "Citra", image: null } })
      const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: "@b" } })
      fireEvent.keyDown(box, { key: "Escape" })
      expect(screen.queryByRole("listbox")).toBeNull()
      fireEvent.change(box, { target: { value: "@bu @bu" } })
      fireEvent.mouseDown(screen.getByRole("option", { name: /Budi/ }))
      expect(box.value).toBe("@bu @Budi ")
    })

    test("you are not in your own list", () => {
      setup({ threads: [], me: { id: "u2", role: "member", name: "Budi", image: null } })
      const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: "@" } })
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Anaana@kantor.test"])
    })

    test("the comment box spans its row", () => {
      setup({ threads: [] })
      expect(screen.getByRole("textbox", { name: "New comment" }).className).toContain("w-full")
    })

    test("people who share a name are told apart and each gets their own mention", () => {
      const twins = [
        { id: "u5", name: "Budi", email: "budi.a@kantor.test" },
        { id: "u6", name: "Budi", email: "budi.b@kantor.test" },
      ]
      const { props } = setup({ threads: [], people: twins })
      const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: "@bu" } })
      fireEvent.keyDown(box, { key: "Enter" })
      fireEvent.change(box, { target: { value: `${box.value}dan @bu` } })
      fireEvent.keyDown(box, { key: "ArrowDown" })
      fireEvent.keyDown(box, { key: "Enter" })
      expect(box.value).toBe("@Budi (budi.a) dan @Budi (budi.b) ")
      fireEvent.click(screen.getByRole("button", { name: "Post comment" }))
      expect(props.onAdd).toHaveBeenCalledWith("@[user:u5] dan @[user:u6]", undefined)
    })

    test("a sent comment shows names, and someone no longer here as a former member", () => {
      setup({ threads: [tagged] })
      const item = commentEl("c3")
      expect(within(item).getByText("@Ana").className).toContain("bg-primary")
      expect(within(item).getByText("@former member")).toBeTruthy()
      expect(item.textContent).not.toContain("[user:")
    })

    test("editing shows names and saves the mention back", () => {
      const team = [...people, { id: "u4", name: "Citra", email: "citra@kantor.test" }]
      const { props } = setup({ threads: [tagged], people: team, me: { id: "u2", role: "member", name: "Budi", image: null } })
      openActions("c3")
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
      const box = screen.getByRole("textbox", { name: "Edit comment" }) as HTMLTextAreaElement
      expect(box.value).toBe("@Ana cek, @former member juga")
      fireEvent.change(box, { target: { value: "@Ana cek lagi @ci" } })
      fireEvent.keyDown(box, { key: "Enter" })
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
      expect(props.onEdit).toHaveBeenCalledWith("c3", "@[user:u1] cek lagi @[user:u4]")
    })
  })
})
