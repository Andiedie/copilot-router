import { Hono } from "hono"
import { config } from "./config"
import { bearerAuth } from "./auth/middleware"
import { proxyHandler } from "./proxy"
import { adminApp } from "./admin/routes"

const app = new Hono()

app.get("/", (c) =>
  c.json({
    name: "copilot-router",
    version: "0.1.0",
  }),
)

app.get("/admin/", (c) => c.html(Bun.file(new URL('./admin/ui/index.html', import.meta.url)).text()))
app.route("/admin", adminApp)

app.use("*", bearerAuth)
app.all("/v1/*", proxyHandler)
app.all("/*", proxyHandler)

Bun.serve({
  port: config.port,
  fetch: app.fetch,
  idleTimeout: 0,
})

console.log(`copilot-router listening on http://localhost:${config.port}`)
