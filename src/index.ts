import { Hono } from "hono"
import { cors } from "hono/cors"

interface Env {
  ANTHROPIC_API_KEY: string
  PROXY_API_KEY: string
  CF_ACCOUNT_ID: string
  CF_GATEWAY_ID: string
}

type Variables = {
  env: Env
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.use("*", cors())

// API Key authentication middleware (skip for health check)
app.use("*", async (c, next) => {
  if (c.req.path === "/") {
    return next()
  }

  const apiKey = c.req.header("X-API-Key") || c.req.header("Authorization")?.replace("Bearer ", "")
  if (!apiKey || apiKey !== c.env.PROXY_API_KEY) {
    return c.json({ error: { type: "authentication_error", message: "Invalid or missing API key" } }, 401)
  }
  await next()
})

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "opencode-claude-proxy",
    version: "2.0.0",
    runtime: "cloudflare-workers",
    endpoints: ["/v1/messages", "/messages"]
  })
})

// Message handler
const handleMessages = async (c: { req: { json: () => Promise<any> }; env: Env; json: (data: any, status?: number) => Response }) => {
  try {
    const body = await c.req.json()
    const stream = body.stream ?? true

    // Build the AI Gateway URL
    const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${c.env.CF_ACCOUNT_ID}/${c.env.CF_GATEWAY_ID}/anthropic/v1/messages`

    // Forward the request to Anthropic via AI Gateway
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": c.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      return c.json({
        type: "error",
        error: {
          type: "api_error",
          message: `Anthropic API error: ${response.status} - ${errorText}`
        }
      }, response.status as 400 | 401 | 403 | 404 | 500)
    }

    if (stream) {
      // Stream the response back as SSE
      return new Response(response.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      })
    } else {
      // Return JSON response
      const data = await response.json()
      return c.json(data)
    }
  } catch (error) {
    return c.json({
      type: "error",
      error: {
        type: "api_error",
        message: error instanceof Error ? error.message : "Unknown error"
      }
    }, 500)
  }
}

app.post("/v1/messages", handleMessages)
app.post("/messages", handleMessages)

export default app
