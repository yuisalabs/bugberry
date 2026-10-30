import "../../assets/style.css"
import { createRoot } from "react-dom/client"
import { clearEmbeddedBackground, promptParams } from "../../lib/prompts/prompt-page"
import { App } from "./App"

const { token, embedded } = promptParams(location.search)
clearEmbeddedBackground(embedded)
const root = document.getElementById("root")
if (root) createRoot(root).render(<App token={token} embedded={embedded} />)
