import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

type Handler = { handle(request: Request): Promise<Response> }

/** An MCP client talking to the app in-process, with the given auth headers. */
export async function mcpClient(app: Handler, headers: Record<string, string>): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
    fetch: (url, init) => app.handle(new Request(url, init)),
    requestInit: { headers },
  })
  const client = new Client({ name: "bugberry-test", version: "1.0.0" })
  await client.connect(transport)
  return client
}

export interface ToolOutcome {
  text: string
  structured: unknown
  isError: boolean
  images: Array<{ mimeType: string; data: string }>
}

/** Calls a tool and flattens its result for assertions. */
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: args })
  const content = (result.content ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  return {
    text: content
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n"),
    structured: result.structuredContent,
    isError: result.isError === true,
    images: content
      .filter((item) => item.type === "image")
      .map((item) => ({ mimeType: item.mimeType ?? "", data: item.data ?? "" })),
  }
}
