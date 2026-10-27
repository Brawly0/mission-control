import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewTask, Task } from '@shared/types'
import type { Agent, LaunchOptions } from '../types'
import type { useToast } from '../toast'
import { resumeArgs } from '../agentStatus'
import { errorMessage } from '../util'

interface TasksOptions {
  agents: Agent[]
  launch: (opts: LaunchOptions) => Promise<{ id: string; sessionId?: string } | null>
  toast: ReturnType<typeof useToast>
}

/** The task board's tasks and the actions that run them (interactive tasks open as agents). */
export function useTasks({ agents, launch, toast }: TasksOptions) {
  const [tasks, setTasks] = useState<Task[]>([])
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  useEffect(() => {
    window.mc.listTasks().then(setTasks)
    return window.mc.onTasksChanged(setTasks)
  }, [])

  const startTask = useCallback(
    async (task: Task) => {
      try {
        const res = await window.mc.startTask(task.id)
        if (res.interactive) {
          const { cwd, args, worktree } = res.interactive
          const info = await launch({ cwd, projectName: task.projectName, projectPath: task.projectPath, title: task.title.slice(0, 48), kind: task.tool ?? 'claude', args, worktree, stayInView: true })
          if (info) {
            await window.mc.setTaskRun(
              task.id,
              { agentId: info.id, sessionId: info.sessionId, startedAt: Date.now(), finishedAt: undefined, error: undefined, result: undefined, toolCalls: 0, events: [], activity: 'Running in an agent tab' },
              'running'
            )
          }
        } else {
          toast('info', 'Task started', task.title)
        }
      } catch (e) {
        toast('error', 'Could not start the task', errorMessage(e))
      }
    },
    [launch, toast]
  )

  // A recurring interactive task fired: open its agent.
  useEffect(() => {
    return window.mc.onLaunchTask(async (taskId) => {
      const task = (await window.mc.listTasks()).find((t) => t.id === taskId)
      if (task) startTask(task)
    })
  }, [startTask])

  const saveAsTemplate = useCallback(
    async (input: NewTask) => {
      try {
        const name = input.title || input.prompt.split('\n')[0].slice(0, 60)
        await window.mc.saveTemplate({
          name,
          title: input.title,
          prompt: input.prompt,
          projectPath: input.projectPath,
          projectName: input.projectName,
          mode: input.mode,
          tool: input.tool,
          permission: input.permission,
          useWorktree: input.useWorktree,
          budgetUsd: input.budgetUsd,
          model: input.model
        })
        toast('success', 'Saved as a template', `${name}. Add a schedule in Templates.`)
      } catch (e) {
        toast('error', 'Could not save the template', errorMessage(e))
      }
    },
    [toast]
  )

  const continueTask = useCallback(
    (task: Task) => {
      if (!task.run?.sessionId) return
      launch({
        cwd: task.worktree?.path ?? task.projectPath,
        projectName: task.projectName,
        projectPath: task.projectPath,
        title: task.title.slice(0, 48),
        kind: task.tool ?? 'claude',
        args: resumeArgs(task.tool ?? 'claude', task.run.sessionId),
        worktree: task.worktree
      })
    },
    [launch]
  )

  // An interactive task's agent closing ends its run; move it to Review.
  useEffect(() => {
    for (const t of tasksRef.current) {
      const agentId = t.run?.agentId
      if (t.column !== 'running' || !agentId) continue
      const agent = agents.find((a) => a.id === agentId)
      if (!agent || agent.exited) {
        window.mc.setTaskRun(t.id, { agentId: undefined, finishedAt: Date.now(), activity: 'Agent closed' }, 'review')
      }
    }
  }, [agents])

  return { tasks, tasksRef, startTask, saveAsTemplate, continueTask }
}
