import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import App from './App'

// No StrictMode: its double-mount would create and dispose each xterm instance,
// dropping the first output of every terminal.
createRoot(document.getElementById('root')!).render(<App />)
