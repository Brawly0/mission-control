// Run with: node cli/src/ui.pty-smoke.mjs
// Real PTY smoke without model calls, worktrees, commits, or user configuration writes.
import { build } from 'vite'
import { spawn } from '@lydell/node-pty'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const dir = await mkdtemp(join(here, '.pty-smoke-'))
const file = join(dir, 'fixture.mjs')
const entry = join(dir, 'fixture.ts')
const source = `
import { Live, startSession, promptBox, card, say } from ${JSON.stringify(join(here, 'ui.ts').replaceAll('\\', '/'))};
startSession();
let live = new Live('SMOKE-RUNNING');
live.start('claude', 'build'); live.start('codex', 'build');
process.on('SIGINT', () => { live.stop(); say('ABORT'); process.exit(0); });
let tick = 0;
const timer = setInterval(() => live.event('claude', { kind: 'tool', text: 'Read file' + (++tick) + '.ts' }), 100);
await new Promise(r => setTimeout(r, 1800));
clearInterval(timer);
live.finish('claude', true, 1800); live.finish('codex', true, 1800); live.stop();
card('Done', [['SMOKE-DONE']]);
const answer = await promptBox('SMOKE-PROMPT', 'SMOKE-HINT', line => line.startsWith('/') ? [{ value: '/help', label: '/help', help: 'SMOKE-MENU' }] : []);
if (answer !== 'x'.repeat(160) + ' END') throw new Error('Input mismatch: ' + JSON.stringify(answer));
say('SMOKE-ANSWER:OK');
live = new Live('SMOKE-SECOND'); live.start('claude', 'build');
`
const delay = ms => new Promise(r => setTimeout(r, ms))
let terminal
let output = ''
let exited
async function until(text) {
  const deadline = Date.now() + 15000
  while (!output.includes(text)) {
    if (exited !== undefined || Date.now() > deadline) throw new Error(`Missing ${text}; exit=${exited}; tail=${JSON.stringify(output.slice(-700))}`)
    await delay(50)
  }
}
try {
  await writeFile(entry, source)
  const result = await build({
    configFile: false, logLevel: 'silent',
    build: { ssr: entry, write: false, target: 'node22', rollupOptions: { output: { format: 'es' } } }
  })
  await writeFile(file, result.output[0].code)
  terminal = spawn(process.execPath, [file], { name: 'xterm-256color', cols: 100, rows: 30, cwd: here, env: { ...process.env, TERM: 'xterm-256color' } })
  terminal.onData(data => { output += data; if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R') })
  terminal.onExit(e => { exited = e.exitCode })
  await until('SMOKE-RUNNING')
  for (const [cols, rows] of [[60, 18], [24, 5], [120, 40], [80, 2], [100, 30]]) { terminal.resize(cols, rows); await delay(120) }
  await until('SMOKE-PROMPT')
  assert.ok(output.includes('SMOKE-DONE'))
  terminal.write('/')
  await until('SMOKE-MENU')
  for (const [cols, rows] of [[30, 5], [110, 32]]) { terminal.resize(cols, rows); await delay(120) }
  // Clear the slash command, type a wrapped request, edit after another resize.
  terminal.write('\x15' + 'x'.repeat(160))
  await delay(120)
  terminal.resize(45, 8)
  await delay(120)
  terminal.write(' END\r')
  await until('SMOKE-ANSWER:OK')
  await until('SMOKE-SECOND')
  terminal.resize(20, 3)
  await delay(120)
  terminal.write('\x03')
  await until('ABORT')
  const deadline = Date.now() + 5000
  while (exited === undefined && Date.now() < deadline) await delay(50)
  assert.equal(exited, 0)
  assert.ok(output.lastIndexOf('\x1b[?25h') > output.lastIndexOf('\x1b[?25l'))
  console.log('PASS: real PTY live resize, finish, card, prompt/menu resize, wrapped edit/submit, Ctrl+C, cursor restoration')
} finally {
  if (terminal && exited === undefined) terminal.kill()
  await unlink(file).catch(() => {})
  await unlink(entry).catch(() => {})
  await rmdir(dir)
}
// ConPTY's helper can retain an IPC handle after its terminal has exited.
process.exit(0)
