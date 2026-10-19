import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { CommentList } from "../src/components/CommentList"
import type { Comment } from "../src/lib/api"

const comments: Comment[] = [
  {
    id: "c1",
    body: "<b>bukan html</b>\nbaris kedua",
    createdAt: new Date("2026-10-16T08:00:00Z"),
    updatedAt: new Date("2026-10-16T08:00:00Z"),
    author: { id: "u1", name: "Ana", image: null },
    mentions: [],
    viaAgent: null,
  },
  {
    id: "c2",
    body: "Saya cek",
    createdAt: new Date("2026-10-16T09:00:00Z"),
    updatedAt: new Date("2026-10-16T09:00:00Z"),
    author: { id: "u2", name: "Budi", image: null },
    mentions: [],
    viaAgent: null,
  },
]

const handlers = () => ({ onAdd: mock(async () => {}), onEdit: mock(async () => {}), onDelete: mock() })

describe("CommentList", () => {
  test("shows comments as plain text with their authors", () => {
    render(<CommentList comments={comments} me={{ id: "u1", role: "member" }} busy={false} {...handlers()} />)
    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.getByText(/<b>bukan html<\/b>/)).toBeTruthy()
    expect(document.querySelector("b")).toBeNull()
  })

  test("adds a trimmed comment and clears the box; empty text cannot be sent", async () => {
    const props = handlers()
    render(<CommentList comments={[]} me={{ id: "u1", role: "member" }} busy={false} {...props} />)
    const send = screen.getByRole("button", { name: "Post comment" }) as HTMLButtonElement
    const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "   " } })
    expect(send.disabled).toBe(true)
    fireEvent.change(box, { target: { value: "  Sudah diperbaiki  " } })
    fireEvent.click(send)
    expect(props.onAdd).toHaveBeenCalledWith("Sudah diperbaiki")
    await waitFor(() => expect(box.value).toBe(""))
  })

  test("only the author can edit; the author or an admin can delete", () => {
    const props = handlers()
    const { unmount } = render(<CommentList comments={comments} me={{ id: "u1", role: "member" }} busy={false} {...props} />)
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), { target: { value: "Updated" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(props.onEdit).toHaveBeenCalledWith("c1", "Updated")
    unmount()

    const adminProps = handlers()
    window.confirm = () => true
    render(<CommentList comments={comments} me={{ id: "u9", role: "admin" }} busy={false} {...adminProps} />)
    expect(screen.queryAllByRole("button", { name: "Edit" })).toHaveLength(0)
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1] as HTMLElement)
    expect(adminProps.onDelete).toHaveBeenCalledWith("c2")
  })

  test("a comment that fails to save keeps the typed text and the open editor", async () => {
    const offline = async () => Promise.reject(new Error("offline"))
    const failing = { onAdd: mock(offline), onEdit: mock(offline), onDelete: mock() }
    render(<CommentList comments={comments} me={{ id: "u1", role: "member" }} busy={false} {...failing} />)
    const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "Teks panjang yang sudah diketik" } })
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), { target: { value: "Edited" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(failing.onEdit).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(box.value).toBe("Teks panjang yang sudah diketik")
    expect((screen.getByRole("textbox", { name: "Edit comment" }) as HTMLTextAreaElement).value).toBe("Edited")
  })

  describe("mentions", () => {
    const people = [
      { id: "u1", name: "Ana", email: "ana@kantor.test" },
      { id: "u2", name: "Budi", email: "budi@kantor.test" },
    ]
    const tagged: Comment = {
      id: "c3",
      body: "@[user:u1] cek, @[user:gone] juga",
      createdAt: new Date("2026-10-16T10:00:00Z"),
      updatedAt: new Date("2026-10-16T10:00:00Z"),
      author: { id: "u2", name: "Budi", image: null },
      mentions: [{ id: "u1", name: "Ana" }],
      viaAgent: null,
    }

    test("typing @ suggests members, and sending stores the mention", async () => {
      const props = handlers()
      render(<CommentList comments={[]} people={people} me={{ id: "u3", role: "member" }} busy={false} {...props} />)
      const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
      expect(box.placeholder).toBe("Write a comment or @ to mention")

      fireEvent.change(box, { target: { value: "cek @ana" } })
      const list = screen.getByRole("listbox", { name: "Mention someone" })
      expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual(["Anaana@kantor.test"])
      fireEvent.keyDown(box, { key: "Enter" })
      expect(box.value).toBe("cek @Ana ")
      expect(screen.queryByRole("listbox")).toBeNull()

      fireEvent.change(box, { target: { value: "cek @Ana tolong @" } })
      expect(screen.getAllByRole("option")).toHaveLength(2)
      fireEvent.keyDown(box, { key: "ArrowDown" })
      expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true")
      fireEvent.keyDown(box, { key: "Tab" })
      expect(box.value).toBe("cek @Ana tolong @Budi ")

      fireEvent.click(screen.getByRole("button", { name: "Post comment" }))
      expect(props.onAdd).toHaveBeenCalledWith("cek @[user:u1] tolong @[user:u2]")
    })

    test("Escape closes the list and a click picks", () => {
      render(<CommentList comments={[]} people={people} me={{ id: "u3", role: "member" }} busy={false} {...handlers()} />)
      const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: "@b" } })
      fireEvent.keyDown(box, { key: "Escape" })
      expect(screen.queryByRole("listbox")).toBeNull()
      fireEvent.change(box, { target: { value: "@bu" } })
      expect(screen.queryByRole("listbox")).toBeNull()
      fireEvent.change(box, { target: { value: "@bu @bu" } })
      fireEvent.mouseDown(screen.getByRole("option", { name: /Budi/ }))
      expect(box.value).toBe("@bu @Budi ")
    })

    test("you are not in your own list: mentioning yourself would notify nobody", () => {
      render(<CommentList comments={[]} people={people} me={{ id: "u2", role: "member" }} busy={false} {...handlers()} />)
      const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: "@" } })
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Anaana@kantor.test"])
      fireEvent.change(box, { target: { value: "@bud" } })
      expect(screen.queryByRole("listbox")).toBeNull()
    })

    test("the comment box spans the whole column", () => {
      render(<CommentList comments={[]} people={people} me={{ id: "u2", role: "member" }} busy={false} {...handlers()} />)
      expect(screen.getByRole("textbox", { name: "New comment" }).className).toContain("w-full")
    })

    test("people who share a name are told apart and each gets their own mention", () => {
      const props = handlers()
      const twins = [
        { id: "u5", name: "Budi", email: "budi.a@kantor.test" },
        { id: "u6", name: "Budi", email: "budi.b@kantor.test" },
      ]
      render(<CommentList comments={[]} people={twins} me={{ id: "u1", role: "member" }} busy={false} {...props} />)
      const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: "@bu" } })
      fireEvent.keyDown(box, { key: "Enter" })
      fireEvent.change(box, { target: { value: `${box.value}dan @bu` } })
      fireEvent.keyDown(box, { key: "ArrowDown" })
      fireEvent.keyDown(box, { key: "Enter" })
      expect(box.value).toBe("@Budi (budi.a) dan @Budi (budi.b) ")
      fireEvent.click(screen.getByRole("button", { name: "Post comment" }))
      expect(props.onAdd).toHaveBeenCalledWith("@[user:u5] dan @[user:u6]")
    })

    test("after Escape, a new @ opens the list again", () => {
      render(<CommentList comments={[]} people={people} me={{ id: "u3", role: "member" }} busy={false} {...handlers()} />)
      const box = screen.getByRole("textbox", { name: "New comment" }) as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: "@bu" } })
      fireEvent.keyDown(box, { key: "Escape" })
      expect(screen.queryByRole("listbox")).toBeNull()
      fireEvent.change(box, { target: { value: "" } })
      fireEvent.change(box, { target: { value: "@" } })
      expect(screen.getAllByRole("option")).toHaveLength(2)
    })

    test("a sent comment shows names, and someone no longer here as a former member", () => {
      render(<CommentList comments={[tagged]} people={people} me={{ id: "u1", role: "member" }} busy={false} {...handlers()} />)
      const item = document.getElementById("comment-c3") as HTMLElement
      expect(item).toBeTruthy()
      expect(within(item).getByText("@Ana").className).toContain("bg-primary")
      expect(within(item).getByText("@former member")).toBeTruthy()
      expect(item.textContent).not.toContain("[user:")
    })

    test("editing shows names and saves the mention back", () => {
      const props = handlers()
      const team = [...people, { id: "u4", name: "Citra", email: "citra@kantor.test" }]
      render(<CommentList comments={[tagged]} people={team} me={{ id: "u2", role: "member" }} busy={false} {...props} />)
      fireEvent.click(screen.getByRole("button", { name: "Edit" }))
      const box = screen.getByRole("textbox", { name: "Edit comment" }) as HTMLTextAreaElement
      expect(box.value).toBe("@Ana cek, @former member juga")
      fireEvent.change(box, { target: { value: "@Ana cek lagi @ci" } })
      fireEvent.keyDown(box, { key: "Enter" })
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
      expect(props.onEdit).toHaveBeenCalledWith("c3", "@[user:u1] cek lagi @[user:u4]")
    })
  })
})
