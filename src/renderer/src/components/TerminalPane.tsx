import { useEffect, useRef } from 'react'
import { Terminal, type ILink } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { subscribe } from '../terminalBus'
import { findFileRefs } from '@shared/terminalLinks'

interface Props {
  id: string
  visible: boolean
  onExit: (code: number) => void
  /** Focus the terminal when it's shown (off for a terminal mirrored somewhere else, or when a prompt box takes focus). */
  autoFocus?: boolean
  /** The folder the process runs in; file paths in the output open relative to it. */
  cwd?: string
}

/** Fired with a terminal id to put the keyboard in that terminal (e.g. after a slash command from the prompt box). */
export const FOCUS_TERMINAL_EVENT = 'mc:focus-terminal'

/** The app's palette as the 16 terminal colors, so Claude's and Codex's colored output fits the app. */
export const terminalTheme = {
  background: '#08090d',
  foreground: '#e6e6ee',
  cursor: '#7fd8ff',
  cursorAccent: '#08090d',
  selectionBackground: 'rgba(102, 139, 255, 0.32)',
  selectionInactiveBackground: 'rgba(102, 139, 255, 0.16)',
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.07)',
  scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.14)',
  scrollbarSliderActiveBackground: 'rgba(102, 139, 255, 0.35)',
  black: '#1b1e25',
  red: '#e47d8e',
  green: '#5ed5b0',
  yellow: '#e8c46c',
  blue: '#7fa6ff',
  magenta: '#b79cff',
  cyan: '#5cd4e8',
  white: '#c9cbd6',
  brightBlack: '#5c6370',
  brightRed: '#f2a0ad',
  brightGreen: '#8ae6c8',
  brightYellow: '#f2d891',
  brightBlue: '#a6c1ff',
  brightMagenta: '#cfbaff',
  brightCyan: '#8ee6f2',
  brightWhite: '#f4f4f8'
}

/** Draws with the GPU; falls back to the normal renderer if the GPU context is lost (too many open, driver reset). */
export function loadGpuRenderer(term: Terminal): void {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch {
    /* no WebGL here: the default renderer stays */
  }
}

export default function TerminalPane({ id, visible, onExit, autoFocus = true, cwd }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const busRef = useRef<ReturnType<typeof subscribe> | null>(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      fontWeightBold: '600',
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      cursorInactiveStyle: 'outline',
      scrollback: 10000,
      allowProposedApi: true,
      rescaleOverlappingGlyphs: true,
      theme: terminalTheme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // Emoji and symbols Claude prints are two cells wide; without this, spinners and boxes drift.
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    // Web links open in the browser (window.open goes to the main process's external-link handler).
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank')))
    term.open(hostRef.current!)
    loadGpuRenderer(term)
    termRef.current = term
    fitRef.current = fit

    // File paths in the output (src/App.tsx:42) open in VS Code; only paths that exist become links.
    const known = new Map<string, boolean>()
    const links = term.registerLinkProvider({
      provideLinks(y, callback) {
        const folder = cwdRef.current
        const line = term.buffer.active.getLine(y - 1)
        if (!folder || !line) return callback(undefined)
        const refs = findFileRefs(line.translateToString(true))
        if (refs.length === 0) return callback(undefined)
        const unknown = [...new Set(refs.map((r) => r.path).filter((p) => !known.has(p)))]
        const ready = unknown.length ? window.mc.filesExist(folder, unknown) : Promise.resolve([])
        ready
          .then((exists) => {
            unknown.forEach((p, i) => known.set(p, !!exists[i]))
            if (known.size > 500) known.clear()
            const out: ILink[] = refs
              .filter((r) => known.get(r.path))
              .map((r) => ({
                range: { start: { x: r.start + 1, y }, end: { x: r.end, y } },
                text: line.translateToString(true).slice(r.start, r.end),
                decorations: { underline: true, pointerCursor: true },
                activate: () => void window.mc.openFileAt(folder, r.path, r.line, r.col)
              }))
            callback(out.length ? out : undefined)
          })
          .catch(() => callback(undefined))
      }
    })

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

    const focusRequest = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) term.focus()
    }
    window.addEventListener(FOCUS_TERMINAL_EVENT, focusRequest)

    return () => {
      window.removeEventListener(FOCUS_TERMINAL_EVENT, focusRequest)
      observer.disconnect()
      links.dispose()
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
