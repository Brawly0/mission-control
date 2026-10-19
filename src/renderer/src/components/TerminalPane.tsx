import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { subscribe } from '../terminalBus'

interface Props {
  id: string
  visible: boolean
  onExit: (code: number) => void
}

const theme = {
  background: '#0b0d12',
  foreground: '#d7dae0',
  cursor: '#e8a87c',
  selectionBackground: '#3a4150',
  black: '#1b1e25',
  brightBlack: '#5c6370'
}

export default function TerminalPane({ id, visible, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    termRef.current = term
    fitRef.current = fit

    // Ctrl+C copies when text is selected (otherwise it interrupts as usual); Ctrl+V pastes text.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey) return true
      if (e.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      if (e.key === 'v' && !e.shiftKey) {
        navigator.clipboard.readText().then((text) => text && term.paste(text))
        return false
      }
      return true
    })

    const input = term.onData((data) => window.mc.ptyWrite(id, data))
    const unsubscribe = subscribe(
      id,
      (data) => term.write(data),
      (code) => {
        term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`)
        onExitRef.current(code)
      }
    )

    const resize = () => {
      const el = hostRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      try {
        fit.fit()
        window.mc.ptyResize(id, term.cols, term.rows)
      } catch {
        /* not laid out yet */
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(hostRef.current!)
    resize()

    return () => {
      observer.disconnect()
      input.dispose()
      unsubscribe()
      term.dispose()
    }
  }, [id])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        if (termRef.current) window.mc.ptyResize(id, termRef.current.cols, termRef.current.rows)
      } catch {
        /* ignore */
      }
      termRef.current?.focus()
    })
  }, [visible, id])

  return <div className="terminal-host" ref={hostRef} onMouseDown={() => termRef.current?.focus()} />
}
