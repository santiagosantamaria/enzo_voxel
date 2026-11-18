import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import EnzoScene from './EnzoScene.jsx'
import './index.css'

// Remixed from https://remix.ui8.ai/fly while "Anyone can view and remix" was on.
// Saved control values from that share, so the first flight matches the demo.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <EnzoScene
      showHint
      touchControls="auto"
      speed={74}
      boost={1.8}
      agility={1.25}
      bank={52}
      altitude={110}
      ceiling={300}
      clearance={7}
      wingmen={0}
      followPointer
      stunts
      jetScale={0.6}
      spread={1}
      pixelSize={3}
      intro={false}
      view="top"
      transition={1.4}
      cameraFollow={0.6}
      chaseDistance={2.6}
      chaseAngle={12}
      chaseSize={0.19}
      timeOfDay="clock"
      land={0.33}
      clouds={0.45}
      seed={7}
      shadow
      flameStyle="realistic"
      afterburner={1}
      trails
      bodyColor="#3254a0"
      accentColor="#f6c022"
      canopyColor="#9ca2ac"
    />
  </StrictMode>,
)
