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
  /**
   * mc draws its live area and prompt on the alternate screen, where xterm turns the wheel into ↑↓ keys (which would
   * walk the prompt history). For mc, wheel-up sends Page Up instead, which shows the real scrollback.
   */
  mc?: boolean
}

export const terminalTheme = {
  background: '#08090d',
  foreground: '#e6e6ee',
  cursor: '#668bff',
  selectionBackground: '#28345e',
  black: '#1b1e25',
  brightBlack: '#5c6370'
}

export default function TerminalPane({ id, visible, onExit, autoFocus = true, mc = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const resizeRef = useRef<((delay?: number) => void) | null>(null)
  const busRef = useRef<ReturnType<typeof subscribe> | null>(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const mcRef = useRef(mc)
  mcRef.current = mc

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

    term.attachCustomWheelEventHandler((e) => {
      if (!mcRef.current || term.buffer.active.type !== 'alternate') return true
      if (e.deltaY < 0 && bus.ownsInput()) window.mc.ptyWrite(id, '\x1b[5~')
      return false
    })

    // Fitting on every ResizeObserver tick makes xterm reflow (and the CLI redraw) many times per drag, and a pane
    // that is being moved in the grid briefly has a half size. So: one fit per animation frame after the size has
    // settled for ~60 ms, none while a pane is being dragged, and the pty only hears about real cols/rows changes.
    let sent = { cols: 0, rows: 0 }
    let dragging = false
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const resize = () => {
      const el = hostRef.current
      if (!el || dragging || el.clientWidth === 0 || el.clientHeight === 0) return
      try {
        fit.fit()
        if (term.cols !== sent.cols || term.rows !== sent.rows) {
          sent = { cols: term.cols, rows: term.rows }
          window.mc.ptyResize(id, term.cols, term.rows)
        }
      } catch {
        /* not laid out yet */
      }
    }
    const schedule = (delay = 60) => {
      if (timer) clearTimeout(timer)
      cancelAnimationFrame(frame)
      timer = setTimeout(() => {
        timer = undefined
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(resize)
      }, delay)
    }
    resizeRef.current = schedule
    const observer = new ResizeObserver(() => schedule())
    observer.observe(hostRef.current!)
    // Moving or re-parenting a pane in the arrangeable grid: wait for the drag to end, then fit once.
    const onDragStart = () => { dragging = true }
    const onDragEnd = () => { dragging = false; schedule(30) }
    const onSettled = () => schedule(30)
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('dragend', onDragEnd, true)
    document.addEventListener('drop', onDragEnd, true)
    document.addEventListener('transitionend', onSettled, true)
    document.addEventListener('visibilitychange', onSettled)
    window.addEventListener('pointerup', onSettled)
    const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) schedule(0) })
    seen.observe(hostRef.current!)
    resize()

    return () => {
      if (timer) clearTimeout(timer)
      cancelAnimationFrame(frame)
      observer.disconnect()
      seen.disconnect()
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('dragend', onDragEnd, true)
      document.removeEventListener('drop', onDragEnd, true)
      document.removeEventListener('transitionend', onSettled, true)
      document.removeEventListener('visibilitychange', onSettled)
      window.removeEventListener('pointerup', onSettled)
      input.dispose()
      bus.unsubscribe()
      busRef.current = null
      resizeRef.current = null
      termRef.current = null
      term.dispose()
    }
  }, [id])

  useEffect(() => {
    if (!visible) return
    busRef.current?.claimInput()
    resizeRef.current?.(0)
    const frame = requestAnimationFrame(() => {
      if (autoFocus) termRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [visible, id, autoFocus])

  return <div className="terminal-host" ref={hostRef} onMouseDown={() => termRef.current?.focus()} />
}
