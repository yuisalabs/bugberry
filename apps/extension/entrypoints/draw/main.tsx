import "../../assets/style.css"
import { createRoot } from "react-dom/client"
import { App } from "./App"

const session = new URLSearchParams(location.search).get("session") ?? ""
const root = document.getElementById("root")
if (root) createRoot(root).render(<App session={session} />)
