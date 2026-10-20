import { createContext, useContext } from 'react'
import {
  BookOpen, Bot, Brain, Briefcase, Camera, ChartCandlestick, Code, Cpu, Database, Film, FlaskConical, Folder, Gamepad2, Gavel,
  Globe, GraduationCap, HardDrive, House, Music, Network, NotebookPen, Palette, PenLine, Rocket, Server, Shield, Smartphone,
  Sparkles, Swords, Terminal, TrendingUp, Wrench, type LucideIcon
} from 'lucide-react'
import type { Project } from '@shared/types'
import { worktreeParent, type ProjectIcon } from '@shared/projectLook'

export const ICONS: Record<ProjectIcon, LucideIcon> = {
  Folder, Gamepad2, Swords, ChartCandlestick, TrendingUp, NotebookPen, Bot, Brain, Sparkles, GraduationCap, Network, Globe,
  Code, Terminal, Server, Database, Smartphone, Cpu, Gavel, Briefcase, BookOpen, PenLine, Palette, Film, Music, Camera,
  FlaskConical, Wrench, Rocket, Shield, HardDrive, House
}

export interface Look {
  icon: ProjectIcon
  hue: number
  name: string
}

/** Finds a project's icon and color from its path (worktrees count as their project) or its name. */
export type LookUp = (nameOrPath: string | undefined) => Look | undefined

export const LookContext = createContext<LookUp>(() => undefined)

const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase()

export function makeLookUp(projects: Project[]): LookUp {
  const byKey = new Map<string, Look>()
  for (const p of projects) {
    const look = { icon: p.icon, hue: p.hue, name: p.name }
    // Names first, then paths, so a path always wins over a project that happens to share a name.
    byKey.set(p.folderName.toLowerCase(), look)
    byKey.set(p.name.toLowerCase(), look)
  }
  for (const p of projects) byKey.set(norm(p.path), { icon: p.icon, hue: p.hue, name: p.name })
  return (s) => {
    if (!s) return undefined
    const key = norm(s)
    const hit = byKey.get(key)
    if (hit) return hit
    const wt = worktreeParent(s)
    return wt ? byKey.get(norm(wt.parent)) : undefined
  }
}

export function useLook(): LookUp {
  return useContext(LookContext)
}

/** A project's current name, for places that stored an older one (tasks, agents). */
export function useProjectName(name: string, path?: string): string {
  const look = useLook()
  return (path && look(path)?.name) || look(name)?.name || name
}
