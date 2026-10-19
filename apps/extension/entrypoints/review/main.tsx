import "../../assets/style.css"
import { createRoot } from "react-dom/client"
import { App } from "./App"

const params = new URLSearchParams(location.search)
// Over a page the frame must stay see-through, so the page shows dimmed behind the modal. The theme paints the
// body with its background colour, so both the root and the body are cleared.
if (params.get("embedded") === "1") {
  document.documentElement.style.background = "transparent"
  document.body.style.background = "transparent"
}
const root = document.getElementById("root")
if (root) createRoot(root).render(<App draftId={params.get("draft") ?? ""} embedded={params.get("embedded") === "1"} />)
