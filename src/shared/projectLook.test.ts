import { describe, expect, it } from 'vitest'
import { encodeProjectKey, folderLabel, guessIcon, prettyWorktreeName, readmeInfo, titleFromPrompt, worktreeParent } from './projectLook'

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

describe('names', () => {
  it('labels folders and drive roots', () => {
    expect(folderLabel('C:\\')).toBe('C: drive')
    expect(folderLabel('C:\\Users\\me\\Desktop\\WBP\\')).toBe('WBP')
  })
  it("matches Claude Code's folder naming", () => {
    expect(encodeProjectKey('C:\\Users\\bsbra\\Desktop\\WBP')).toBe('C--Users-bsbra-Desktop-WBP')
  })
  it('turns a first prompt into a short title', () => {
    expect(titleFromPrompt('ok so can you fix the login page\nmore details')).toBe('Can you fix the login page')
    expect(titleFromPrompt('<command-name>/x</command-name>\nhello')).toBe('')
    expect(titleFromPrompt('a'.repeat(200)).length).toBeLessThanOrEqual(80)
  })
})
