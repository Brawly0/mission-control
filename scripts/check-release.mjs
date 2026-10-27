// Runs native gates against the exact packaged application before publishing.
// --dev exercises the first-run/runtime gates against the development build.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { appendFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dev = process.argv.includes('--dev')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
mkdirSync(join(root, 'out'), { recursive: true })
const output = mkdtempSync(join(root, 'out', 'release-check-'))
const exe = join(root, dev ? 'node_modules/electron/dist/electron.exe' : 'release/win-unpacked/Mission Control.exe')
const env = { ...process.env }
for (const key of Object.keys(env)) if (key.startsWith('MC_SMOKE') || key.toLowerCase() === 'path') delete env[key]
delete env.CODEX_HOME
delete env.CLAUDE_CONFIG_DIR
const home = join(output, 'home')
mkdirSync(home)
mkdirSync(join(output, 'roaming')); mkdirSync(join(output, 'local'))
const system = process.env.SystemRoot || 'C:\\Windows'
Object.assign(env, { USERPROFILE: home, APPDATA: join(output, 'roaming'), LOCALAPPDATA: join(output, 'local'),
  PATH: [join(system, 'System32'), join(system, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'), MC_SMOKE_CLEAN: '1' })

async function run(name, options) {
  const dir = join(output, name); mkdirSync(dir)
  const log = join(dir, 'smoke.log')
  const child = spawn(exe, dev ? ['.'] : [], { cwd: root, windowsHide: true, env: { ...env, ...options,
    MC_SMOKE: join(dir, 'ui.png'), MC_SMOKE_LOG: log, MC_SMOKE_PROFILE: join(dir, 'profile') }, stdio: ['ignore', 'pipe', 'pipe'] })
  const captured = []
  child.stdout?.on('data', data => { captured.push(data); appendFileSync(join(dir, 'process.log'), data) })
  child.stderr?.on('data', data => { captured.push(data); appendFileSync(join(dir, 'process.log'), data) })
  await new Promise((done, reject) => {
    const timer = setTimeout(() => {
      if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      reject(new Error(`${name} timed out; see ${dir}`))
    }, 90_000)
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('exit', code => {
      clearTimeout(timer)
      writeFileSync(join(dir, 'process.log'), Buffer.concat(captured))
      const text = existsSync(log) ? readFileSync(log, 'utf8') : ''
      if (code !== 0 || !text.includes('PASS') || text.includes('FAILED')) reject(new Error(`${name} failed (exit ${code}):\n${text}`))
      else { console.log(text.trim()); done() }
    })
  })
}

await run('first-run', { MC_SMOKE_READINESS: 'first-run' })
const git = spawnSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true }).stdout?.trim().split(/\r?\n/)[0]
if (!git) throw new Error('Git is required for the release shutdown-race check')
let gitRoot = dirname(git)
for (let i = 0; i < 4 && !existsSync(join(gitRoot, 'usr', 'bin', 'sh.exe')); i++) gitRoot = dirname(gitRoot)
if (!existsSync(join(gitRoot, 'usr', 'bin', 'sh.exe'))) throw new Error('Git for Windows shell is required for the commit-race fixture')
await run('runtime', { MC_SMOKE_READINESS: 'runtime', MC_SMOKE_GIT: git,
  PATH: [env.PATH, dirname(git), join(gitRoot, 'bin'), join(gitRoot, 'usr', 'bin')].join(';') })
if (!dev) {
  const installer = join(root, 'release', `Mission Control Setup ${version}.exe`)
  const bytes = readFileSync(installer)
  const hash = createHash('sha512').update(bytes).digest('base64')
  const manifest = readFileSync(join(root, 'release/latest.yml'), 'utf8')
  if (!manifest.includes(`version: ${version}`) || !manifest.includes(hash) || !manifest.includes(`size: ${bytes.length}`)) throw new Error('Update manifest does not match installer')
  const asset = `Mission-Control-Setup-${version}.exe`
  const testVersion = version.replace(/\d+$/, n => String(Number(n) + 1))
  const feed = manifest.replace(`version: ${version}`, `version: ${testVersion}`)
  const server = createServer((req, res) => {
    const file = decodeURIComponent((req.url || '').split('?')[0]).slice(1)
    if (file === 'latest.yml') { res.writeHead(200, { 'Content-Type': 'text/yaml' }); res.end(feed) }
    else if (file === asset || file === asset + '.blockmap') {
      const path = file.endsWith('.blockmap') ? installer + '.blockmap' : installer
      res.writeHead(200, { 'Content-Length': statSync(path).size }); createReadStream(path).pipe(res)
    } else { res.writeHead(404); res.end() }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  try {
    await run('update', { MC_SMOKE_UPDATE: '1', MC_SMOKE_UPDATE_FEED: `http://127.0.0.1:${server.address().port}/` })
    if (!readFileSync(join(output, 'update', 'smoke.log'), 'utf8').includes('"state":"ready"')) throw new Error('Updater did not finish downloading the actual installer')
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)) }
  writeFileSync(join(output, 'checksums.txt'), `SHA512 ${hash}\nInstaller bytes ${bytes.length}\n`)
}
console.log(`Release gates: PASS. Evidence: ${output}`)
