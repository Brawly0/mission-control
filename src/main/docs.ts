import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { DocFile } from '../shared/types'

const DOC_NAMES = ['CLAUDE.md', 'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CHANGELOG.md']

/** A project's docs: the well-known files at its root plus the Markdown in docs/, docs/briefings/ and .claude/. */
export async function listDocs(projectPath: string): Promise<DocFile[]> {
  const docs: DocFile[] = []
  for (const name of DOC_NAMES) {
    const p = join(projectPath, name)
    try {
      if ((await fs.stat(p)).isFile()) docs.push({ name, path: p })
    } catch {
      /* not present */
    }
  }
  // docs/briefings/ holds session briefings (saved automatically when a chat runs out of room).
  for (const dir of ['docs', 'docs/briefings', '.claude']) {
    try {
      const entries = await fs.readdir(join(projectPath, dir), { withFileTypes: true })
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          docs.push({ name: `${dir}/${e.name}`, path: join(projectPath, dir, e.name) })
        }
      }
    } catch {
      /* folder missing */
    }
  }
  return docs
}
