import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { terminalTheme } from './TerminalPane'

interface Props {
  taskId: string
  visible: boolean
}

/**
 * A background task's live terminal: the CLI's stream as it would read in a console (tool calls,
 * their output, replies, the result). Read-only; the run takes no input.
 */
export default function TaskConsole({ taskId, visible }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 12,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      disableStdin: true,
      convertEol: true,
      scrollback: 10000,
      theme: terminalTheme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    fitRef.current = fit

    // Ctrl+C copies the selection.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      return true
    })

    // Replies and events come through one ordered channel: chunks that arrive before the saved
    // text are already part of it, so only later ones are written.
    let loaded = false
    const off = window.mc.onTaskOutput((id, chunk) => {
      if (id === taskId && loaded) term.write(chunk)
    })
    let disposed = false
    window.mc.getTaskOutput(taskId).then((text) => {
      if (disposed) return
      term.write(text || '\x1b[90mWaiting for output…\x1b[0m\r\n')
      loaded = true
    })

    const resize = () => {
      const el = hostRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      try {
        fit.fit()
      } catch {
        /* not laid out yet */
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(hostRef.current!)
    resize()

    return () => {
      disposed = true
      observer.disconnect()
      off()
      term.dispose()
    }
  }, [taskId])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        /* ignore */
      }
    })
  }, [visible])

  return <div className="terminal-host task-console" ref={hostRef} />
}
