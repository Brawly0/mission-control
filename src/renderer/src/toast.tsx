import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

type Tone = 'success' | 'error' | 'info'
interface Toast {
  id: number
  tone: Tone
  title: string
  body?: string
}

const ToastContext = createContext<(tone: Tone, title: string, body?: string) => void>(() => {})

/** In-app messages for results of actions (merged, failed, copied, …). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback(
    (tone: Tone, title: string, body?: string) => {
      const id = Date.now() + Math.random()
      setToasts((t) => [...t.slice(-3), { id, tone, title, body }])
      setTimeout(() => dismiss(id), tone === 'error' ? 9000 : 4500)
    },
    [dismiss]
  )

  const icons = { success: CheckCircle2, error: AlertCircle, info: Info }
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => {
          const Icon = icons[t.tone]
          return (
            <div key={t.id} className={`toast toast-${t.tone}`}>
              <Icon size={17} strokeWidth={2} />
              <div className="toast-text">
                <div className="toast-title">{t.title}</div>
                {t.body && <div className="toast-body">{t.body}</div>}
              </div>
              <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
