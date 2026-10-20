// Publishes the current package.json version to Brawly0/mission-control-releases, which installed
// copies auto-update from.
//
// Usage:  node scripts/release.mjs "What changed in this version"
//
// Steps: create the draft release first (electron-builder otherwise races itself and can create two
// drafts), build and upload into it, check that the installer, blockmap and latest.yml are all there,
// then publish it as the latest release. Uses the GitHub CLI's login (`gh auth token`) for this run only.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REPO = 'Brawly0/mission-control-releases'
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${version}`
const notes = process.argv[2] ?? `Mission Control ${version}.`

// gh is a real executable, so no shell: arguments with spaces (titles, notes) arrive intact.
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 32 * 1024 * 1024 })

const existing = JSON.parse(gh('api', `repos/${REPO}/releases`, '--paginate')).filter((r) => r.tag_name === tag)
if (existing.some((r) => !r.draft)) {
  console.error(`${tag} is already published. Bump "version" in package.json first.`)
  process.exit(1)
}
for (const r of existing) gh('api', '--method', 'DELETE', `repos/${REPO}/releases/${r.id}`)

console.log(`Creating draft ${tag}…`)
gh('release', 'create', tag, '-R', REPO, '--draft', '--title', `Mission Control ${version}`, '--notes', notes)

console.log('Building and uploading…')
const token = gh('auth', 'token').trim()
execFileSync('npm', ['run', 'release'], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, GH_TOKEN: token } })

const drafts = JSON.parse(gh('api', `repos/${REPO}/releases`, '--paginate')).filter((r) => r.tag_name === tag && r.draft)
if (drafts.length !== 1) {
  console.error(`Expected one draft for ${tag}, found ${drafts.length}. Fix it on GitHub before publishing.`)
  process.exit(1)
}
const names = drafts[0].assets.map((a) => a.name)
const needed = ['latest.yml', `Mission-Control-Setup-${version}.exe`, `Mission-Control-Setup-${version}.exe.blockmap`]
const missing = needed.filter((n) => !names.includes(n))
if (missing.length) {
  console.error(`Draft is missing: ${missing.join(', ')}. Not publishing.`)
  process.exit(1)
}

gh('api', '--method', 'PATCH', `repos/${REPO}/releases/${drafts[0].id}`, '-F', 'draft=false', '-f', 'make_latest=true')
console.log(`Published ${tag}: https://github.com/${REPO}/releases/tag/${tag}`)
