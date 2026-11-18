import { describe, expect, it } from 'vitest'
import { COMMANDS, complete, parseCommand, suggestions } from './commands'

describe('command suggestions', () => {
  it('lists every command in the agreed order', () => {
    const names = 'help clear usage model mode new status list merge clean review full planner aura view report version exit'.split(' ')
    expect(COMMANDS.map(cmd => cmd.name)).toEqual(names)
    expect(suggestions('/').map(item => item.label)).toEqual(names.map(name => '/' + name))
  })
  it('filters command prefixes', () => {
    expect(suggestions('/mo').map(item => item.label)).toEqual(['/model', '/mode'])
  })
  it('completes both levels of model arguments', () => {
    expect(suggestions('/model ').map(item => item.value)).toEqual(['/model claude ', '/model codex '])
    expect(suggestions('/model claude o').map(item => item.value)).toEqual(['/model claude opus', '/model claude claude-opus-5-5'])
    expect(suggestions('/model codex ').map(item => item.label)).toEqual(['default', 'gpt-6-astra'])
    expect(suggestions('/model claude claude-son').map(item => item.label)).toEqual(['claude-sonnet-5-5'])
    expect(suggestions('/model unknown ')).toEqual([])
    expect(suggestions('/model claude opus ')).toEqual([])
  })
  it('adds a space only to commands accepting arguments', () => {
    const withArgs = 'model mode merge clean review full planner aura view'.split(' ')
    for (const item of suggestions('/')) expect(item.value.endsWith(' ')).toBe(withArgs.includes(item.label.slice(1)))
  })
  it('ignores non-slash input and unknown values', () => {
    for (const line of ['', 'help', 'build it', ' /model', '/not-a-command ', '/mode missing']) expect(suggestions(line)).toEqual([])
  })
  it('keeps readline completion compatible', () => {
    expect(complete('/me')).toEqual([['/merge'], '/me'])
    expect(complete('/mode c')).toEqual([['/mode claude', '/mode codex'], '/mode c'])
    expect(complete('/model claude o')[0]).toEqual(['/model claude opus', '/model claude claude-opus-5-5'])
    expect(complete('hello')).toEqual([[], 'hello'])
    expect(complete('/merge ab')[0]).toEqual([])
  })
})

describe('new slash commands', () => {
  it.each([['usage', 'usage'], ['cost', 'usage'], ['clear', 'clear'], ['cls', 'clear'], ['new', 'new'], ['reset', 'new'], ['version', 'version']])('resolves /%s to %s', (input, name) => {
    expect(parseCommand('/' + input)).toMatchObject({ name, args: '' })
  })
})
