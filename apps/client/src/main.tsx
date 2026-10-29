import "./styles.css"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toast } from "@bugberry/ui/toast"
import { createQueryClient } from "./lib/query/client"
import { sessionEndTarget } from "./features/auth/session-end"
import { createAppRouter } from "./router"

const queryClient = createQueryClient(() => {
  // A session that ends mid-use shows the 401 page; an internal share link goes straight to sign-in.
  const target = sessionEndTarget(queryClient, router.state.location)
  if (target) void router.navigate(target)
})
const router = createAppRouter(queryClient)

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toast position="bottom-center" />
      </QueryClientProvider>
    </StrictMode>,
  )
}
