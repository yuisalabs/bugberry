import "../../assets/style.css"
import { createRoot } from "react-dom/client"
import { browser } from "wxt/browser"
import type { CameraTicketRequest } from "../../lib/messages"
import { CameraBubble } from "./App"

const token = new URLSearchParams(location.search).get("camera") ?? ""
const ask = (request: CameraTicketRequest) => browser.runtime.sendMessage(request)
const getUserMedia = (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints)
const postToPage = (message: unknown) => window.parent.postMessage(message, "*")
const root = document.getElementById("root")
if (root) createRoot(root).render(<CameraBubble token={token} ask={ask} getUserMedia={getUserMedia} postToPage={postToPage} />)
