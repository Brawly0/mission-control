import { myPcArgs } from '@shared/projectLook'
import type { LaunchOptions } from '../types'
import type { useToast } from '../toast'
import { errorMessage } from '../util'

/** Starters offered under the Ask my PC box on Home. */
export const MY_PC_SUGGESTIONS = ['Why is my PC slow?', 'Free up disk space', 'Which apps need updates?', 'What starts with Windows?']

/**
 * Opens a Claude chat in the My PC advisor workspace (setting it up the first time), sending
 * `prompt` right away when there is one.
 */
export async function askMyPc(
  c: { launch: (opts: LaunchOptions) => unknown; toast: ReturnType<typeof useToast>; refreshProjects: () => Promise<void> },
  prompt?: string
): Promise<void> {
  try {
    const { path, dirs } = await window.mc.myPc()
    const ask = prompt?.trim()
    await c.launch({ kind: 'claude', cwd: path, projectName: 'My PC', projectPath: path, title: ask ? `My PC · ${ask.slice(0, 40)}` : 'My PC', args: myPcArgs(ask, dirs) })
    void c.refreshProjects()
  } catch (e) {
    c.toast('error', 'Could not open My PC', errorMessage(e))
  }
}
