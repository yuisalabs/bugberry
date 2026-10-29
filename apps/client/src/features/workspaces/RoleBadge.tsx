import type { WorkspaceRole } from "@bugberry/shared"
import { RiShieldUserLine, RiUserLine, RiVipCrown2Line } from "@remixicon/react"
import { Badge } from "../../components/ui/badge"
import { roleLabel } from "./workspace"

export function RoleBadge({ member }: { member: { role: WorkspaceRole; owner: boolean } }) {
  const label = roleLabel(member)
  const [Icon, colours] =
    label === "Owner"
      ? [RiVipCrown2Line, "bg-warning-subtle text-warning-subtle-foreground"]
      : label === "Admin"
        ? [RiShieldUserLine, "bg-primary-subtle text-primary"]
        : [RiUserLine, "bg-secondary text-secondary-foreground"]
  return (
    <Badge className={`w-fit justify-self-start px-2.5 py-0.5 text-sm ${colours}`}>
      <Icon aria-hidden className="size-3.5" />
      {label}
    </Badge>
  )
}
