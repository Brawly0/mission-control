import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { subscribe } from '../terminalBus'

interface Props {
  id: string
  visible: boolean
  onExit: (code: number) => void
  /** Focus the terminal when it's shown (off for a terminal mirrored somewhere else). */
  autoFocus?: boolean
}

export const terminalTheme = {
  background: '#08090d',
  foreground: '#e6e6ee',
  cursor: '#668bff',
  selectionBackground: '#28345e',
  black: '#1b1e25',
  brightBlack: '#5c6370'
}

export default function TerminalPane({ id, visible, onExit, autoFocus = true }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const busRef = useRef<ReturnType<typeof subscribe> | null>(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: terminalTheme
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

    const bus = subscribe(
      id,
      (data) => term.write(data),
      (code) => {
        term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`)
        onExitRef.current(code)
      }
    )
    busRef.current = bus
    const input = term.onData((data) => {
      // Typing in a pane makes it the one that talks to the terminal.
      if (hostRef.current?.contains(document.activeElement)) bus.claimInput()
      if (bus.ownsInput()) window.mc.ptyWrite(id, data)
    })

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
      bus.unsubscribe()
      busRef.current = null
      term.dispose()
    }
  }, [id])

  useEffect(() => {
    if (!visible) return
    busRef.current?.claimInput()
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        if (termRef.current) window.mc.ptyResize(id, termRef.current.cols, termRef.current.rows)
      } catch {
        /* ignore */
      }
      if (autoFocus) termRef.current?.focus()
    })
  }, [visible, id, autoFocus])

  return <div className="terminal-host" ref={hostRef} onMouseDown={() => termRef.current?.focus()} />
}
