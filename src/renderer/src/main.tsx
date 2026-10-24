import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import './organize.css'
import './tasks.css'
import './automation.css'
import './chains.css'
import './identity.css'
import './spend.css'
import './ui2.css'
import './dashboard.css'
import './vault.css'
import './skills.css'
import App from './App'
import { ToastProvider } from './toast'

// No StrictMode: its double-mount would create and dispose each xterm instance,
// dropping the first output of every terminal.
createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <App />
  </ToastProvider>
)
