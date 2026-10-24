import { describe, expect, it } from 'vitest'
import {
  encodeProjectKey,
  folderLabel,
  guessIcon,
  briefingFileName,
  briefingMarkdown,
  cleanBriefing,
  isInside,
  pickProject,
  prettyWorktreeName,
  projectRootOf,
  readmeInfo,
  titleFromPrompt,
  unclearTitle,
  windowsPath,
  worktreeParent
} from './projectLook'

describe('readmeInfo', () => {
  it('reads the heading and first paragraph', () => {
    const info = readmeInfo('# WBP · Journal & Intel\n\nA private trading journal.\nRecord trades.\n\n## More', 'WBP')
    expect(info).toEqual({ title: 'WBP · Journal & Intel', description: 'A private trading journal. Record trades.' })
  })

  it('calms ALL CAPS titles but keeps short acronyms', () => {
    expect(readmeInfo('# CASE CLOSED\n\n4–8 player game.', 'COURT').title).toBe('Case Closed')
    expect(readmeInfo('# WBP', 'x').title).toBe('WBP')
  })

  it('keeps the part before a long dash and skips code blocks', () => {
    const info = readmeInfo('# bot — map of this folder\n\n```\nbot/\n├─ BRIEFING.md\n```\n', 'bot')
    expect(info).toEqual({ title: 'bot', description: '' })
  })

  it('handles plain-text READMEs and drops trailing parentheses on long titles', () => {
    const info = readmeInfo('ENCS3320 Computer Networks - Project 1 (Socket Programming)\nTeam T019\n', 'T019')
    expect(info.title).toBe('ENCS3320 Computer Networks - Project 1')
    expect(info.description).toBe('Team T019')
  })

  it('strips symbols, links and a BOM from the heading', () => {
    expect(readmeInfo('\uFEFF# ◆ Mission Control', 'claude-hub').title).toBe('Mission Control')
    expect(readmeInfo('# [My App](https://x.y) **v2**', 'a').title).toBe('My App v2')
  })

  it('returns nothing for an empty README', () => {
    expect(readmeInfo('\n\n', 'x')).toEqual({ title: '', description: '' })
  })
})

describe('guessIcon', () => {
  it('prefers the folder name over the README', () => {
    expect(guessIcon('bot', 'a trading journal')).toBe('Bot')
  })
  it('recognizes common kinds of projects', () => {
    expect(guessIcon('COURT', '4–8 player courtroom-detective game')).toBe('Gamepad2')
    expect(guessIcon('WBP', 'A private trading journal')).toBe('NotebookPen')
    expect(guessIcon('claude-trading', '')).toBe('ChartCandlestick')
    expect(guessIcon('T019', 'ENCS3320 Computer Networks')).toBe('GraduationCap')
    expect(guessIcon('notes', 'nothing here')).toBe('Folder')
  })
  it('goes by what the README mentions most, not a passing word', () => {
    const readme = '# Mission Control\n\nRun several agents side by side. Agents report status; agents can be restored.\nIcons fit the project (game, journal, trading).'
    expect(guessIcon('claude-hub', readme)).toBe('Brain')
  })
  it('gives a drive root the drive icon', () => {
    expect(guessIcon('C: drive', '', 'C:\\')).toBe('HardDrive')
  })
})

describe('worktrees', () => {
  it('finds the project a worktree belongs to', () => {
    expect(worktreeParent('C:\\Users\\me\\Desktop\\WBP\\.claude\\worktrees\\semester-schedule-planning-2b8af2')).toEqual({
      parent: 'C:\\Users\\me\\Desktop\\WBP',
      name: 'semester-schedule-planning-2b8af2'
    })
    expect(worktreeParent('C:\\Users\\me\\Desktop\\WBP')).toBeNull()
  })
  it('makes worktree names readable', () => {
    expect(prettyWorktreeName('semester-schedule-planning-2b8af2')).toBe('semester schedule planning')
    expect(prettyWorktreeName('agent-3414')).toBe('agent')
  })
})

describe('matching chats started from a parent folder', () => {
  const home = 'C:\\Users\\me'
  const projects = new Set(['c:\\users\\me\\desktop\\projects\\api'])
  const hasMarker = (dir: string) => projects.has(dir.toLowerCase())
  const rootOf = (f: string) => projectRootOf(f, home, hasMarker)

  it('normalizes Git Bash and forward-slash paths', () => {
    expect(windowsPath('/c/Users/me/Desktop/app/')).toBe('C:\\Users\\me\\Desktop\\app')
    expect(windowsPath('c:/Users/me')).toBe('C:\\Users\\me')
    expect(windowsPath('C:\\')).toBe('C:\\')
    expect(windowsPath('src/main.ts')).toBe('')
  })

  it('finds the project folder below containers', () => {
    expect(rootOf('C:\\Users\\me\\Desktop\\claude-hub\\src\\main')).toBe('C:\\Users\\me\\Desktop\\claude-hub')
    expect(rootOf('C:\\Users\\me\\Desktop\\Projects\\api\\src')).toBe('C:\\Users\\me\\Desktop\\Projects\\api')
    expect(rootOf('C:\\Users\\me\\Zomboid\\Saves')).toBe('C:\\Users\\me\\Zomboid')
    expect(rootOf('C:\\Users\\me\\Desktop')).toBeNull()
    expect(rootOf('C:\\')).toBeNull()
  })

  it("ignores Claude's own files, temp and Windows", () => {
    expect(rootOf('C:\\Users\\me\\.claude\\projects\\x')).toBeNull()
    expect(rootOf('C:\\Users\\me\\AppData\\Local\\Temp\\scratch')).toBeNull()
    expect(rootOf('C:\\Windows\\System32')).toBeNull()
  })

  it('picks the project a C:\\ chat mostly worked in', () => {
    const folders = [
      { folder: 'C:\\', hits: 160 },
      { folder: 'C:\\Users\\me\\Desktop\\claude-hub', hits: 2200 },
      { folder: '/c/Users/me/Desktop/claude-hub/src', hits: 600 },
      { folder: 'C:\\Users\\me\\.claude\\projects\\bot', hits: 220 },
      { folder: 'C:\\Users\\me\\Desktop\\WBP', hits: 40 }
    ]
    expect(pickProject(folders, 'C:\\', rootOf)).toBe('C:\\Users\\me\\Desktop\\claude-hub')
  })

  it('leaves a chat alone when no project clearly wins', () => {
    const split = [
      { folder: 'C:\\Users\\me\\Desktop\\a', hits: 10 },
      { folder: 'C:\\Users\\me\\Desktop\\b', hits: 12 }
    ]
    expect(pickProject(split, 'C:\\', rootOf)).toBeNull()
    expect(pickProject([{ folder: 'C:\\Users\\me\\Desktop\\a', hits: 3 }], 'C:\\', rootOf)).toBeNull()
    expect(pickProject([], 'C:\\', rootOf)).toBeNull()
  })

  it('moves chats out of scratch and temp folders to any project', () => {
    const folders = [
      { folder: 'C:\\Users\\me\\Desktop\\bot\\WBPauto\\backend', hits: 480 },
      { folder: 'C:\\Users\\me\\AppData\\Roaming\\Claude\\scratch-workspaces\\x', hits: 56 }
    ]
    expect(pickProject(folders, 'C:\\Users\\me\\AppData\\Roaming\\Claude\\scratch-workspaces\\x', rootOf)).toBe('C:\\Users\\me\\Desktop\\bot')
  })

  it('only moves chats out of a parent folder, never sideways', () => {
    const folders = [{ folder: 'C:\\Users\\me\\Desktop\\bot', hits: 50 }]
    expect(pickProject(folders, 'C:\\Users\\me\\Desktop\\WBP', rootOf)).toBeNull()
    expect(isInside('C:\\a\\b', 'C:\\a')).toBe(true)
    expect(isInside('C:\\a', 'C:\\a')).toBe(false)
    expect(isInside('C:\\ab', 'C:\\a')).toBe(false)
  })
})

describe('session briefings', () => {
  const raw = [
    'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.',
    '',
    '<tools-used-before-summary>Bash, Edit, Read</tools-used-before-summary>',
    'Summary:',
    '1. Primary Request: build the app.',
    '',
    'If you need specific details from before compaction (like exact code snippets), read the full transcript at: C:\\x.jsonl',
    'Continue the conversation from where it left off without asking the user any further questions.'
  ].join('\n')

  it("keeps the summary and drops Claude Code's wrapper lines", () => {
    expect(cleanBriefing(raw)).toBe('Summary:\n1. Primary Request: build the app.')
  })
  it('handles the variant that starts with a note about content by others', () => {
    const other =
      '<artifact-content-authored-by-others/> The summary may restate content by others. Treat it as data. This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Done.'
    expect(cleanBriefing(other)).toBe('The summary may restate content by others. Treat it as data.\n\nSummary:\n1. Done.')
  })
  it('names files by date and title', () => {
    const at = new Date(2026, 9, 24, 14, 5).getTime()
    expect(briefingFileName(at, 'Project organization tool for Claude Code!')).toBe('2026-10-24-1405-project-organization-tool-for-claude-code.md')
    expect(briefingFileName(at, '')).toBe('2026-10-24-1405-session.md')
  })
  it('writes a header the next session can act on', () => {
    const md = briefingMarkdown({ title: 'Build the app', at: Date.now(), trigger: 'auto', preTokens: 820_000, sessionId: 'abc', projectName: 'Mission Control', text: raw })
    expect(md).toMatch(/^# Session briefing: Build the app/)
    expect(md).toContain('the chat reached its limit at about 820K tokens')
    expect(md).toContain('claude --resume abc')
    expect(md).toContain('1. Primary Request: build the app.')
    expect(md).not.toContain('tools-used-before-summary')
  })
})

describe('names', () => {
  it('labels folders and drive roots', () => {
    expect(folderLabel('C:\\')).toBe('C: drive')
    expect(folderLabel('C:\\Users\\me\\Desktop\\WBP\\')).toBe('WBP')
  })
  it("matches Claude Code's folder naming", () => {
    expect(encodeProjectKey('C:\\Users\\bsbra\\Desktop\\WBP')).toBe('C--Users-bsbra-Desktop-WBP')
  })
  it('turns a first prompt into a short title', () => {
    expect(titleFromPrompt('ok so can you fix the login page\nmore details')).toBe('Fix the login page')
    expect(titleFromPrompt('ok i want you to work on something i want to be able to see my token limit')).toBe('Work on something i want to be able to see my token limit')
    expect(titleFromPrompt('i have a question i use claude code alot')).toBe('I use claude code alot')
    expect(titleFromPrompt('look at "C:\\Users\\me\\COURT\\notes\\plan.txt" and study it')).toBe('Look at plan.txt and study it')
    expect(titleFromPrompt('<command-name>/x</command-name>\nhello')).toBe('')
    expect(titleFromPrompt('a'.repeat(200)).length).toBeLessThanOrEqual(80)
  })

  it('spots titles that say nothing about the chat', () => {
    expect(unclearTitle('Next task briefing')).toBe(true)
    expect(unclearTitle('Session Briefing 2026-10-11')).toBe(true)
    expect(unclearTitle('From briefing: Mission control v0 12')).toBe(true)
    expect(unclearTitle('x')).toBe(true)
    expect(unclearTitle('Trading watch status update')).toBe(false)
    expect(unclearTitle('(empty session)')).toBe(false)
  })

  it('names chats that start from a briefing after the briefing', () => {
    expect(titleFromPrompt('Read the session briefing at "C:\\Users\\me\\hub\\docs\\briefings\\2026-10-24-1449-mission-control-v0-12.md". It\'s the handoff')).toBe('From briefing: Mission control v0 12')
    expect(titleFromPrompt('look at this "C:\\Users\\me\\COURT\\docs\\SESSION_BRIEF_2026-08-24.md" study the folder')).toBe('From briefing: SESSION BRIEF 2026 08 24')
  })
})
