import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GridPicker, usePanelGrid } from '../../src/renderer/src/components/PanelGrid'
import '../../src/renderer/src/styles.css'
import '../../src/renderer/src/tasks.css'
import '../../src/renderer/src/agents.css'
import '../../src/renderer/src/workspace.css'
function App() {
  const [preset, setPreset] = useState('4x2')
  const ids = Array.from({ length: 16 }, (_, i) => String(i))
  const g = usePanelGrid(ids, preset, 'test-grid')
  return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}><GridPicker value={preset} onChange={setPreset}/><button id="reset" onClick={g.reset}>Reset</button><div ref={g.stageRef} className="task-terminals task-agent-stage grid" style={g.style}>{ids.map(id => <section key={id} data-id={id} className="task-term" style={g.place(id)} {...g.target(id)}><header className="task-term-head">{g.handle(id)}Agent {Number(id)+1}</header><pre>Live CLI panel {id}</pre></section>)}{g.gutters}</div></div>
}
createRoot(document.getElementById('root')!).render(<App />)
