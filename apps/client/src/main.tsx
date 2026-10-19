import "./styles.css"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toast } from "@bugberry/ui/toast"
import { createQueryClient } from "./lib/query-client"
import { createAppRouter } from "./router"

const queryClient = createQueryClient(() => {
  // A session that ends mid-use (or an internal share link) sends the person to login and back.
  const { pathname, href } = router.state.location
  if (pathname !== "/login") void router.navigate({ to: "/login", search: { next: href } })
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
