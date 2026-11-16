import { app } from 'electron'
import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { HookEvent } from '../shared/types'

/**
 * Receives Claude Code hook calls from the agents this app started.
 *
 * Each agent is launched with `claude --settings <file>`, where the file adds hooks that
 * POST the hook's JSON input to this server with curl. The user's own settings are untouched.
 * URLs carry a per-run secret so other local processes can't fake events.
 */

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'] as const
const TOOL_EVENTS = new Set(['PostToolUse'])

let server: Server | null = null
let port = 0
const token = randomBytes(16).toString('hex')

function hooksDir(): string {
  return join(app.getPath('userData'), 'hooks')
}

/**
 * Answers a prompt hook with text for Claude (Claude Code adds a UserPromptSubmit hook's
 * additionalContext to the prompt). Used by eco mode's coach; null adds nothing.
 */
export type PromptCoach = (sessionId: string | undefined) => Promise<string | null>

export async function startHookServer(onEvent: (e: HookEvent) => void, coach?: PromptCoach): Promise<void> {
  // Settings files from a previous run point at an old port and token.
  rmSync(hooksDir(), { recursive: true, force: true })
  mkdirSync(hooksDir(), { recursive: true })

  server = createServer((req, res) => {
    const match = req.url?.match(/^\/hook\/([\w-]+)\/([a-f0-9]+)$/)
    if (req.method !== 'POST' || !match || match[2] !== token) {
      res.writeHead(404).end()
      return
    }
    const agentId = match[1]
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      if (body.length < 1_000_000) body += chunk
    })
    req.on('end', async () => {
      let input: any = {}
      try {
        input = JSON.parse(body)
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
        return
      }
      let reply = '{}'
      if (coach && input.hook_event_name === 'UserPromptSubmit') {
        // The hook's curl gives up after 3 seconds; answer well before that, coached or not.
        const text = await Promise.race([coach(input.session_id).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 1500))])
        if (text) reply = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } })
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(reply)
      onEvent({
        agentId,
        event: String(input.hook_event_name ?? ''),
        lastReply: input.hook_event_name === 'Stop' && typeof input.last_assistant_message === 'string' ? input.last_assistant_message.slice(-24_000) : undefined,
        sessionId: typeof input.session_id === 'string' ? input.session_id : undefined,
        message: typeof input.message === 'string' ? input.message : undefined,
        notificationType: typeof input.notification_type === 'string' ? input.notification_type : undefined,
        source: typeof input.source === 'string' ? input.source : undefined,
        at: Date.now()
      })
    })
  })

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
}

/** Writes the per-agent settings file and returns its path, for `claude --settings`. */
export function hookSettingsFor(agentId: string): string {
  const url = `http://127.0.0.1:${port}/hook/${agentId}/${token}`
  // Quoted so the same command works whether Claude Code runs hooks through bash, cmd or PowerShell.
  const command = `curl.exe -s -m 3 -X POST -H "Content-Type: application/json" --data-binary "@-" "${url}"`
  const hook = { type: 'command', command, timeout: 5 }
  const hooks: Record<string, unknown[]> = {}
  for (const event of EVENTS) {
    hooks[event] = [TOOL_EVENTS.has(event) ? { matcher: '*', hooks: [hook] } : { hooks: [hook] }]
  }
  const file = join(hooksDir(), `${agentId}.json`)
  writeFileSync(file, JSON.stringify({ hooks }, null, 2), 'utf8')
  return file
}

export function removeHookSettings(agentId: string): void {
  rmSync(join(hooksDir(), `${agentId}.json`), { force: true })
}

export function stopHookServer(): void {
  server?.close()
  try {
    for (const f of readdirSync(hooksDir())) rmSync(join(hooksDir(), f), { force: true })
  } catch {
    /* already gone */
  }
}
