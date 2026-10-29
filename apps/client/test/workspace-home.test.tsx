import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { workspaceQueries } from "../src/features/workspaces/queries"
import { WorkspaceHome, WorkspaceHomeView } from "../src/features/workspaces/WorkspaceHome"

describe("WorkspaceHomeView", () => {
  test("someone without a workspace sees how to join one", () => {
    render(<WorkspaceHomeView join={<p>join options</p>} onCreate={mock()} />)
    expect(screen.getByRole("heading", { name: "You're not in a workspace yet" })).toBeTruthy()
    expect(screen.getByText("join options")).toBeTruthy()
  })

  test("Create workspace opens the modal", () => {
    const onCreate = mock()
    render(<WorkspaceHomeView join={null} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }))
    expect(onCreate).toHaveBeenCalledWith()
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull()
  })
})

describe("WorkspaceHome", () => {
  test("Create workspace is handed to the shell, so the modal outlives this page", () => {
    const client = new QueryClient()
    client.setQueryData(workspaceQueries.myInvitations().queryKey, [])
    client.setQueryData(workspaceQueries.domainWorkspaces().queryKey, [])
    const onCreateWorkspace = mock()
    render(
      <QueryClientProvider client={client}>
        <WorkspaceHome onCreateWorkspace={onCreateWorkspace} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole("textbox", { name: "Invite link or code" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }))
    expect(onCreateWorkspace).toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
