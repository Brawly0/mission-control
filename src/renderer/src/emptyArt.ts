// Illustrations for empty states, picked by the lucide icon each EmptyState already passes (ADR 0038).
// Icons without an entry keep the plain icon tile.
import type { LucideIcon } from 'lucide-react'
import { BarChart3, BookOpen, Bot, FileStack, FileText, FolderPlus, GitBranch, History, MessagesSquare, NotebookPen, Search, Terminal, TerminalSquare, TextSearch } from 'lucide-react'
import projects from './art/empty-projects.webp'
import chats from './art/empty-chats.webp'
import search from './art/empty-search.webp'
import agents from './art/empty-agents.webp'
import docs from './art/empty-docs.webp'
import tasks from './art/empty-tasks.webp'
import terminal from './art/empty-terminal.webp'
import changes from './art/empty-changes.webp'
import usage from './art/empty-usage.webp'

const ART = new Map<LucideIcon, string>([
  [FolderPlus, projects],
  [Search, projects],
  [History, chats],
  [MessagesSquare, chats],
  [TextSearch, search],
  [Bot, agents],
  [BookOpen, docs],
  [NotebookPen, docs],
  [FileText, docs],
  [FileStack, tasks],
  [Terminal, terminal],
  [TerminalSquare, terminal],
  [GitBranch, changes],
  [BarChart3, usage]
])

export const emptyArt = (icon: LucideIcon): string | undefined => ART.get(icon)
