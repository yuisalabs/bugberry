import { RiRobot2Line, RiSparkling2Line } from "@remixicon/react"
import { AiWritingSettings } from "./AiWritingSettings"
import { BrandedHeader } from "../../components/BrandedHeader"
import { SettingsTabs } from "../../components/SettingsTabs"
import { McpAgents } from "./McpAgents"

/** `/app/settings/ai`: AI agents through MCP, and Write with AI (the workspace's own key and templates) at #write. */
export function AiAgentsPage() {
  return (
    <section className="flex flex-col gap-8">
      <BrandedHeader title="AI" description="Draft reports with your own AI key, and let AI apps like Claude Code or Cursor read and work on them." />
      <SettingsTabs
        label="AI settings"
        sections={[
          // MCP stays first: the top bar's AI Agents link and every older link mean it. Write with AI is #write.
          { id: "agents", label: "AI agents (MCP)", icon: RiRobot2Line, panel: <McpAgents /> },
          { id: "write", label: "Write with AI", icon: RiSparkling2Line, panel: <AiWritingSettings /> },
        ]}
      />
    </section>
  )
}
