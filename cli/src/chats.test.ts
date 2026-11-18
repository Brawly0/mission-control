import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { chatDigest, claudeProjectKey, listProjectChats, readChatTail } from './chats'

let temp: string, root: string
function fixture(tool: string, file: string, cwd: string, destination = file): string {
  const path = join(temp, tool, destination)
  mkdirSync(dirname(path), { recursive: true })
  const text = readFileSync(resolve('cli/src/fixtures', tool, file), 'utf8').replaceAll('__ROOT__', JSON.stringify(cwd).slice(1, -1))
  writeFileSync(path, text)
  return path
}
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'mc-chats-')); root = join(temp, 'repo')
  vi.stubEnv('MC_CLAUDE_HOME', join(temp, 'claude')); vi.stubEnv('MC_CODEX_HOME', join(temp, 'codex'))
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(temp, { recursive: true, force: true }) })
describe('project chats', () => {
  it('derives Claude keys', () => { expect(claudeProjectKey('C:\\Users\\x\\my_proj')).toBe('C--Users-x-my-proj') })
  it('matches root and subfolders, skips neighboring projects and corrupt lines', async () => {
    fixture('claude', 'projects/project/session.jsonl', root, `projects/${claudeProjectKey(root)}/session.jsonl`)
    // A neighbour whose key starts with this project's key is opened but rejected by its cwd.
    fixture('claude', 'projects/project/session.jsonl', root + '-other', `projects/${claudeProjectKey(root + '-other')}/session.jsonl`)
    // Another project's folder is never opened.
    fixture('claude', 'projects/project/session.jsonl', root, 'projects/unrelated/session.jsonl')
    fixture('codex', 'sessions/2026/11/18/rollout-one.jsonl', join(root, 'child'))
    const chats = await listProjectChats(root)
    expect(chats).toHaveLength(2)
    expect(chats[0].updatedAt).toBeGreaterThanOrEqual(chats[1].updatedAt)
    const claude = chats.find(c => c.tool === 'claude')!
    expect(claude.title).toBe('Project chat reader')
    expect((await readChatTail(claude)).map(m => m.text)).toEqual(['Build the chat reader', 'Reader implemented', 'Thanks'])
    expect((await readChatTail(chats.find(c => c.tool === 'codex')!)).map(m => m.text)).toEqual(['Test the chat reader', 'Tests passed'])
    expect(await chatDigest(root)).toContain('[Claude] Project chat reader')
    expect((await chatDigest(root, { maxChars: 50 })).length).toBe(50)
    expect(await listProjectChats(root, 1)).toHaveLength(1)
  })
  it('matches case according to platform', async () => {
    fixture('claude', 'projects/project/session.jsonl', root.toUpperCase(), `projects/${claudeProjectKey(root)}/session.jsonl`)
    expect(await listProjectChats(root)).toHaveLength(process.platform === 'win32' ? 1 : 0)
  })
  it('reads bounded tails of large logs and discards partial records', async () => {
    const file = fixture('claude', 'projects/project/session.jsonl', root, `projects/${claudeProjectKey(root)}/session.jsonl`)
    appendFileSync(file, '\n' + JSON.stringify({ type: 'user', message: { content: 'x'.repeat(2 * 1024 * 1024) } }) + '\n{broken}\n' + JSON.stringify({ type: 'assistant', message: { content: 'Last reply' } }) + '\n')
    const chat = (await listProjectChats(root))[0]
    expect((await readChatTail(chat)).map(m => m.text)).toEqual(['Last reply'])
    expect(await readChatTail(chat, 0)).toEqual([])
  })
  it('tolerates missing homes and files', async () => {
    expect(await listProjectChats(root)).toEqual([])
    expect(await chatDigest(root)).toBe('')
    expect(await readChatTail({ tool: 'claude', id: 'x', title: '', updatedAt: 0, file: join(temp, 'missing') })).toEqual([])
  })
})
