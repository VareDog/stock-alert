import { handleApi } from "./api"
import { runCheck } from "./checker"
import type { Env } from "./notifier"

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, env, url.pathname)
    }
    // 其余路径由静态资源（public/index.html）接管
    return env.ASSETS.fetch(req)
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCheck(env, Date.now()))
  },
}
