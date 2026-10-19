export interface Agent {
  /** PTY id from the main process. */
  id: string
  title: string
  cwd: string
  projectName: string
  kind: 'claude' | 'shell'
  exited: boolean
  exitCode?: number
  startedAt: number
}

export type AgentLayout = 'tabs' | 'grid'

export interface LaunchOptions {
  cwd: string
  projectName: string
  title: string
  kind?: 'claude' | 'shell'
  args?: string[]
}
