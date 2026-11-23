import { useEffect, useRef, useState } from 'react'
import { createScene, DEFAULT_PARAMS } from './lib/scene.ts'
import { createFlameLayer } from './lib/flame-layer.ts'
import { createGpuWorld } from './lib/gpu-world.ts'

const KEYS = Object.keys(DEFAULT_PARAMS)

const HINTS = {
  top: 'Move to steer · Click to roll · Hold for throttle and smoke · B to bomb · V to walk · Space for chase view',
  chase: 'Point to turn, climb and dive · Click to roll · Hold for throttle and smoke · B to bomb · V to walk · Space for the cockpit',
  cockpit: 'Point to turn, climb and dive · Click to roll · Hold for throttle and smoke · B to bomb · V to walk · Space for overhead',
}

const TOUCH_HINTS = {
  top: 'Drag the way to fly · Tap to roll · Hold Boost · Bomb the houses · View for chase view · Walk to go on foot',
  chase: 'Drag to turn, climb and dive · Tap to roll · Hold Boost · Bomb · View for the cockpit · Walk to go on foot',
  cockpit: 'Drag to turn, climb and dive · Tap to roll · Hold Boost · Bomb · View for overhead · Walk to go on foot',
}

// On a phone the frame has about this many pixels, a little more than a 1280 by 720 desktop's, so it shows
// as much of the world and costs about the same to draw (pixelSize alone would leave a phone a tiny frame)
const PHONE_PIXELS = 150000

// On foot, a finger dragged on the screen is a stick: this far (CSS pixels) is full speed, under STICK_DEAD is none
const STICK_R = 46
const STICK_DEAD = 8
const stickAxis = (d) =>
  Math.abs(d) < STICK_DEAD ? 0 : Math.max(-1, Math.min(1, (d - Math.sign(d) * STICK_DEAD) / (STICK_R - STICK_DEAD)))

const viewOf = (v) => (v === 'cockpit' ? 'cockpit' : v === 'chase' ? 'chase' : 'top')

/** timeOfDay="clock": the light from the browser's own clock, day from 7 in the morning and night from 8 in the evening */
const clockLight = () => {
  const h = new Date().getHours()
  if (!Number.isFinite(h)) return 'day'
  return h >= 7 && h < 20 ? 'day' : 'night'
}

const FLY = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'boost', ShiftRight: 'boost',
  TouchBoost: 'boost',
  KeyB: 'bomb',
  KeyF: 'bomb',
  TouchBomb: 'bomb',
}

export default function EnzoScene({ pixelSize = 0, showHint = true, touchControls = 'auto', ...rest }) {
  const [noFire, setNoFire] = useState(false)
  const [fingerScreen, setFingerScreen] = useState(false)
  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) setFingerScreen(true)
  }, [])
  const buttons = touchControls === 'on' || (touchControls === 'auto' && fingerScreen)
  const [boosting, setBoosting] = useState(false)
  const [bombing, setBombing] = useState(false)
  const [onFoot, setOnFoot] = useState(false)
  const [aboard, setAboard] = useState(false)
  const [footView, setFootView] = useState('above')
  const [canBoard, setCanBoard] = useState(false) // a boat in reach on foot, or a shore aboard
  const [indoors, setIndoors] = useState(false) // walking the gallery inside the museum
  const indoorsRef = useRef(false)
  // the first time aboard, how to sail glows softly in the hint until the boat sails or is left
  const [sailCue, setSailCue] = useState(false)
  const sailCueRef = useRef(false)
  const boardedRef = useRef(false)
  const heldRef = useRef(new Set())
  const sendKeysRef = useRef(() => {})
  const stickRef = useRef(null) // the finger steering: where it went down, the way it has dragged, and the turn and move it gives
  const ringRef = useRef(null)
  const knobRef = useRef(null)
  const actionsRef = useRef({ toggleWalk() {}, board() {} }) // V and E, for the buttons too
  const buttonsRef = useRef(false)
  buttonsRef.current = buttons
  const phoneRef = useRef(false)
  phoneRef.current = fingerScreen

  // on the clock, the light follows the browser's clock until N is pressed: it is looked at every minute,
  // so the light eases to night at 8 in the evening and to day at 7. After N the light is the player's.
  const [clock, setClock] = useState(clockLight)
  const ownLightRef = useRef(false)
  const onClock = rest.timeOfDay === 'clock'
  useEffect(() => {
    if (!onClock) return
    const id = window.setInterval(() => {
      if (ownLightRef.current) window.clearInterval(id)
      else setClock(clockLight())
    }, 60000)
    return () => window.clearInterval(id)
  }, [onClock])

  const params = { ...DEFAULT_PARAMS }
  for (const k of KEYS) {
    const v = rest[k]
    if (v !== undefined && v !== null) params[k] = v
  }
  if (params.timeOfDay === 'clock') params.timeOfDay = clock
  if (noFire) params.flameStyle = 'pixel'
  const signature = JSON.stringify(params)

  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const fireRef = useRef(null)
  const sceneRef = useRef(null)
  const paramsRef = useRef(params)
  const pixelRef = useRef(pixelSize)
  const scaleRef = useRef(4)
  const layoutRef = useRef(() => {})
  const [hint, setHint] = useState({ mode: viewOf(params.view), on: true })
  const [night, setNight] = useState(params.timeOfDay === 'night')
  const hintTimer = useRef(0)
  const revealHint = (mode, seconds) => {
    setHint({ mode, on: true })
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint((h) => ({ ...h, on: false })), seconds * 1000)
  }
  const revealHintRef = useRef(revealHint)
  revealHintRef.current = revealHint
  paramsRef.current = params
  pixelRef.current = pixelSize

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scene = createScene(paramsRef.current)
    sceneRef.current = scene
    // the ground and clouds are drawn on the graphics card when it can (add ?cpu to the address to
    // draw them on the CPU instead)
    const gpu = new URLSearchParams(window.location.search).has('cpu') ? null : createGpuWorld()
    scene.setGpu(gpu)
    if (import.meta.env.DEV) window.enzoScene = scene
    let image = null
    const fire = fireRef.current
    let layer = null
    let fireDead = false
    const onFireLost = (e) => {
      e.preventDefault()
      layer = null
      fireDead = true
      setNoFire(true)
    }
    fire?.addEventListener('webglcontextlost', onFireLost)

    const layout = () => {
      const cw = wrap.clientWidth
      const ch = wrap.clientHeight
      if (!cw || !ch) return
      const auto = Math.min(12, Math.max(2, Math.round(Math.sqrt((cw * ch) / 100000))))
      let px = pixelRef.current > 0 ? Math.round(pixelRef.current) : auto
      if (phoneRef.current) {
        // a pixel no bigger than gives the frame PHONE_PIXELS, and a whole number of the screen's own
        // pixels, so the pixel art stays crisp
        const dpr = window.devicePixelRatio || 1
        const want = Math.sqrt((cw * ch) / PHONE_PIXELS)
        px = Math.min(px, Math.max(1, Math.round(want * dpr)) / dpr)
      }
      const lw = Math.ceil(cw / px)
      const lh = Math.ceil(ch / px)
      const sizeChanged = canvas.width !== lw || canvas.height !== lh
      if (sizeChanged) {
        canvas.width = lw
        canvas.height = lh
        image = null
      }
      // A fresh scene starts at 0×0. The canvas can already be the right size
      // (React remounts the effect without clearing it), so check the scene too.
      if (sizeChanged || scene.width !== lw || scene.height !== lh) {
        scene.resize(lw, lh)
        image = null
      }
      canvas.style.width = lw * px + 'px'
      canvas.style.height = lh * px + 'px'
      canvas.style.left = Math.round((cw - lw * px) / 2) + 'px'
      canvas.style.top = Math.round((ch - lh * px) / 2) + 'px'
      if (fire) {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const fw = Math.round(lw * px * dpr)
        const fh = Math.round(lh * px * dpr)
        if (fire.width !== fw || fire.height !== fh) {
          fire.width = fw
          fire.height = fh
        }
        fire.style.width = canvas.style.width
        fire.style.height = canvas.style.height
        fire.style.left = canvas.style.left
        fire.style.top = canvas.style.top
      }
      scaleRef.current = px
    }
    layoutRef.current = layout
    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(wrap)

    let raf = 0
    let last = performance.now()
    let poll = 0
    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      if (!scene.width) return
      scene.step(dt)
      if (scene.indoors !== indoorsRef.current) {
        indoorsRef.current = scene.indoors
        setIndoors(scene.indoors)
      }
      if (sailCueRef.current && (scene.sailing || !scene.aboard)) {
        sailCueRef.current = false
        setSailCue(false)
      }
      // the Board button shows only when it would do something: looked at five times a second
      if (buttonsRef.current && ++poll >= 12) {
        poll = 0
        setCanBoard(scene.canBoard)
        setAboard(scene.aboard)
      }
      const bytes = scene.render()
      if (!image || image.width !== scene.width || image.height !== scene.height) {
        image = new ImageData(scene.width, scene.height)
      }
      image.data.set(bytes)
      ctx.putImageData(image, 0, 0)
      const flames = scene.flames
      if (fire && flames.count > 0 && !layer && !fireDead) {
        layer = createFlameLayer(fire)
        if (!layer) {
          fireDead = true
          setNoFire(true)
        }
      }
      if (fire && layer) layer.draw(flames.count, flames.data, fire.width / scene.width, now / 1000)
    }
    raf = requestAnimationFrame(frame)

    const held = heldRef.current
    held.clear()
    const sendKeys = () => {
      let turn = 0
      let climb = 0
      let boost = false
      let bomb = false
      let move = 0
      held.forEach((code) => {
        const k = FLY[code]
        if (k === 'left') turn -= 1
        else if (k === 'right') turn += 1
        else if (k === 'up') { climb -= 1; move += 1 }
        else if (k === 'down') { climb += 1; move -= 1 }
        else if (k === 'boost') boost = true
        else if (k === 'bomb') bomb = true
      })
      if (scene.onFoot) {
        // a finger on the screen steers as well. On land it is a stick: sideways turns, up and down walk.
        // In a boat the boat turns to the way it drags, in any direction (a tap sets sail or stops).
        const st = stickRef.current
        if (st && !scene.aboard) {
          turn += st.turn
          move += st.move
        }
        const aim = st && scene.aboard && Math.hypot(st.dx, st.dy) > STICK_DEAD * 1.5
        scene.setAim(aim ? st.dx : null, aim ? st.dy : null)
        scene.setWalk(turn, move)
        scene.setKeys(0, 0, false)
        scene.setBomb(false)
      } else {
        // flying, the plane goes the way the finger drags. Overhead it turns to point that way, as a boat
        // does. From behind and from the seat the drag is a stick: sideways turns, up climbs, down dives.
        const st = stickRef.current
        const over = scene.view === 'top'
        if (st && !over) {
          turn += st.turn
          climb += st.move
        }
        const aim = st && over && Math.hypot(st.dx, st.dy) > STICK_DEAD * 1.5
        scene.setAim(aim ? st.dx : null, aim ? st.dy : null)
        scene.setWalk(0, 0)
        scene.setKeys(turn, climb, boost)
        scene.setBomb(bomb)
      }
    }
    sendKeysRef.current = sendKeys
    // V: become the man, or go back to the plane; E: board the nearest boat, or step ashore
    const toggleWalk = () => {
      held.delete('TouchBoost')
      held.delete('TouchBomb')
      setBoosting(false)
      setBombing(false)
      stickRef.current = null
      if (ringRef.current) ringRef.current.style.display = 'none'
      scene.toggleFoot()
      sendKeys()
      setOnFoot(scene.onFoot)
      setAboard(scene.aboard)
      setFootView(scene.footView)
      setCanBoard(scene.canBoard)
      if (!scene.onFoot) revealHintRef.current(scene.view, 7)
    }
    const board = () => {
      if (!scene.onFoot) return
      scene.board()
      sendKeys()
      setAboard(scene.aboard)
      if (scene.aboard && !boardedRef.current) {
        boardedRef.current = true
        sailCueRef.current = true
        setSailCue(true)
      }
      setCanBoard(scene.canBoard)
    }
    actionsRef.current = { toggleWalk, board }
    const typing = (e) => {
      const el = e.target
      return !!el && el !== wrap && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.isContentEditable)
    }
    const onKey = (e) => {
      if (typing(e)) return
      if (e.code === 'KeyV' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        toggleWalk()
        return
      }
      if (e.code === 'KeyN' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        ownLightRef.current = true // the clock no longer moves the light
        scene.toggleNight()
        setNight(scene.night)
        return
      }
      if (e.code === 'KeyE' && !e.repeat && scene.onFoot && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        board()
        return
      }
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        if (e.repeat) return
        if (scene.onFoot) {
          scene.toggleFootView()
          setFootView(scene.footView)
          return
        }
        scene.toggleView()
        revealHintRef.current(scene.view, 7)
        return
      }
      if (FLY[e.code] && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.code.startsWith('Arrow')) e.preventDefault()
        held.add(e.code)
        sendKeys()
      }
    }
    const onKeyUp = (e) => {
      if (held.delete(e.code)) sendKeys()
    }
    const onBlur = () => {
      held.clear()
      sendKeys()
      setBoosting(false)
      setBombing(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.clearTimeout(hintTimer.current)
      fire?.removeEventListener('webglcontextlost', onFireLost)
      layer?.dispose()
      gpu?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.setParams(paramsRef.current)
    setNight(scene.night)
  }, [signature])

  useEffect(() => {
    layoutRef.current()
  }, [pixelSize, fingerScreen])

  const firstView = useRef(true)
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false
      return
    }
    revealHintRef.current(viewOf(params.view), 7)
  }, [params.view])

  const toScene = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return [(e.clientX - r.left) / scaleRef.current, (e.clientY - r.top) / scaleRef.current]
  }

  const byFinger = (e) => touchControls !== 'off' && e.pointerType === 'touch'
  const mine = (e) => e.stopPropagation()
  // the stick: it starts where the finger goes down, and a ring and a knob show it
  const stickStart = (e) => {
    const r = wrapRef.current.getBoundingClientRect()
    stickRef.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t: performance.now(), moved: false, turn: 0, move: 0, dx: 0, dy: 0 }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* touch already ended */ }
    const ring = ringRef.current
    if (ring) {
      ring.style.display = 'block'
      ring.style.transform = `translate(${e.clientX - r.left - STICK_R}px, ${e.clientY - r.top - STICK_R}px)`
    }
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)'
  }
  const stickMove = (e) => {
    const st = stickRef.current
    if (!st || st.id !== e.pointerId) return
    let dx = e.clientX - st.x0
    let dy = e.clientY - st.y0
    if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 12) st.moved = true
    st.dx = dx
    st.dy = dy
    st.turn = stickAxis(dx)
    st.move = stickAxis(-dy)
    const l = Math.hypot(dx, dy)
    if (l > STICK_R) {
      dx *= STICK_R / l
      dy *= STICK_R / l
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
    sendKeysRef.current()
  }
  const stickEnd = (e, tap) => {
    const st = stickRef.current
    if (!st || st.id !== e.pointerId) return
    stickRef.current = null
    if (ringRef.current) ringRef.current.style.display = 'none'
    sendKeysRef.current()
    const scene = sceneRef.current
    if (!scene || !tap || st.moved || performance.now() - st.t >= 300) return
    // a tap: in a boat it sets sail or stops, and flying it rolls the plane
    if (scene.aboard) scene.sailToggle()
    else if (!scene.onFoot) {
      scene.press()
      scene.release()
    }
  }
  const tapButton = (fn) => () => {
    fn()
    wrapRef.current?.focus({ preventScroll: true })
  }
  const nextView = () => {
    const scene = sceneRef.current
    if (!scene) return
    if (scene.onFoot) {
      scene.toggleFootView()
      setFootView(scene.footView)
    } else {
      scene.toggleView()
      revealHint(scene.view, 7)
    }
    sendKeysRef.current() // a finger held down steers the new view its own way
    wrapRef.current?.focus({ preventScroll: true })
  }
  const boostOn = (e) => {
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* touch already ended */ }
    heldRef.current.add('TouchBoost')
    sendKeysRef.current()
    setBoosting(true)
  }
  const boostOff = (e) => {
    e.stopPropagation()
    heldRef.current.delete('TouchBoost')
    sendKeysRef.current()
    setBoosting(false)
    wrapRef.current?.focus({ preventScroll: true })
  }
  const bombOn = (e) => {
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* touch already ended */ }
    heldRef.current.add('TouchBomb')
    sendKeysRef.current()
    sceneRef.current?.dropBomb()
    setBombing(true)
  }
  const bombOff = (e) => {
    e.stopPropagation()
    heldRef.current.delete('TouchBomb')
    sendKeysRef.current()
    setBombing(false)
    wrapRef.current?.focus({ preventScroll: true })
  }
  const hints = buttons ? TOUCH_HINTS : HINTS
  const footHint = !onFoot ? null
    : indoors
      ? (buttons ? 'Drag to walk round the gallery · Walk out by the door · Fly back to the plane' : 'WASD walks round the gallery · Walk out by the door · V back to the plane')
    : buttons
      ? (aboard
        ? `Tap to sail or stop · Drag the way to steer · Ashore near land · View for ${footView === 'first' ? 'overhead' : 'first person'} · Fly back to the plane`
        : `Drag to walk · Board when a boat is near · View for ${footView === 'first' ? 'overhead' : 'first person'} · Fly back to the plane`)
    : aboard
      ? (footView === 'first'
        ? 'W starts · S stops · A D turn · E ashore · Space for overhead · V back to the plane'
        : 'W starts · S stops · A D turn · E ashore · Space for first person · V back to the plane')
      : (footView === 'first'
        ? 'WASD walks · E hops on a boat · Space for overhead · V back to the plane'
        : 'WASD walks · E hops on a boat · Space for first person · V back to the plane')
  const buttonLook =
    'absolute flex h-16 w-20 cursor-pointer select-none items-center justify-center rounded-[5px] border font-mono text-[13px] uppercase leading-none tracking-[0.14em] text-white/90 outline-none transition-colors duration-100 focus-visible:border-white'

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      className="relative h-screen min-h-[320px] w-full touch-none select-none overflow-hidden bg-[#2468b4] outline-none"
      style={{ cursor: 'crosshair', height: '100dvh', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' }}
      onContextMenu={(e) => { if (fingerScreen) e.preventDefault() }}
      onPointerEnter={() => wrapRef.current?.focus({ preventScroll: true })}
      onPointerMove={(e) => {
        if (byFinger(e)) {
          stickMove(e)
          return
        }
        const [x, y] = toScene(e)
        sceneRef.current?.pointerMove(x, y)
      }}
      onPointerDown={(e) => {
        const [x, y] = toScene(e)
        if (byFinger(e)) {
          if (!fingerScreen) setFingerScreen(true)
          if (!stickRef.current) stickStart(e)
        } else {
          sceneRef.current?.pointerMove(x, y)
          sceneRef.current?.press()
        }
        wrapRef.current?.focus({ preventScroll: true })
        if (!hintTimer.current) hintTimer.current = window.setTimeout(() => setHint((h) => ({ ...h, on: false })), 9000)
      }}
      onPointerUp={(e) => {
        if (byFinger(e)) stickEnd(e, true)
        else sceneRef.current?.release()
      }}
      onPointerLeave={(e) => {
        if (byFinger(e)) stickEnd(e, false)
        else sceneRef.current?.pointerLeave()
      }}
      onPointerCancel={(e) => {
        if (byFinger(e)) stickEnd(e, false)
        else sceneRef.current?.pointerLeave()
      }}
      onLostPointerCapture={(e) => stickEnd(e, false)}
    >
      <canvas
        ref={canvasRef}
        aria-label="Enzo's day: a pixel-art 1920s biplane, built from stacked slices, flying over islands. Space moves between the overhead view, the view from behind the plane and the open cockpit; arrow keys fly it, Shift opens the throttle and trails smoke, and B drops a bomb."
        role="img"
        className="absolute block"
        style={{ imageRendering: 'pixelated' }}
      />
      <canvas ref={fireRef} aria-hidden="true" className="pointer-events-none absolute block" />
      <div
        ref={ringRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 rounded-full border border-white/40 bg-[#0b1a33]/25"
        style={{ display: 'none', width: STICK_R * 2, height: STICK_R * 2 }}
      >
        <div
          ref={knobRef}
          className="absolute rounded-full border border-white/70 bg-white/35"
          style={{ left: STICK_R - 17, top: STICK_R - 17, width: 34, height: 34 }}
        />
      </div>
      {showHint && (
        <div
          className={`pointer-events-none absolute inset-x-0 flex justify-center px-4 transition-opacity duration-700 ${buttons || hint.mode === 'cockpit' || (onFoot && (footView === 'first' || indoors)) ? 'top-4' : 'bottom-4'}`}
          style={{ opacity: onFoot || hint.on ? 1 : 0 }}
        >
          <p
            className={`rounded-[3px] bg-[#0b1a33]/55 px-2.5 py-1.5 text-center font-mono uppercase tracking-[0.14em] text-white/90 ${buttons ? 'text-[12px] leading-[1.4]' : 'text-[11px] leading-none'}`}
            style={{ textShadow: '0 1px 0 rgba(0,0,0,.45)' }}
          >
            {(() => {
              const text = (footHint || hints[hint.mode]) + (buttons ? '' : night ? ' · N for day' : ' · N for night')
              if (!(sailCue && aboard)) return text
              // the first part says how to sail: it glows
              const cut = text.indexOf(' · ', buttons ? 0 : text.indexOf(' · ') + 1)
              return (
                <>
                  <span className="sail-cue">{text.slice(0, cut)}</span>
                  {text.slice(cut)}
                </>
              )
            })()}
          </p>
        </div>
      )}
      {buttons && (
        <>
          <button
            type="button"
            aria-label={onFoot ? 'Back to the plane' : 'Walk: put the man down on land nearby'}
            className={`${buttonLook} border-white/30 bg-[#0b1a33]/60 active:bg-[#0b1a33]/90`}
            style={{ left: 'max(14px, env(safe-area-inset-left))', bottom: 'calc(max(14px, env(safe-area-inset-bottom)) + 76px)', touchAction: 'none' }}
            onClick={tapButton(() => actionsRef.current.toggleWalk())}
            onPointerDown={mine}
            onPointerMove={mine}
            onPointerUp={mine}
          >
            {onFoot ? 'Fly' : 'Walk'}
          </button>
          {onFoot && canBoard && (
            <button
              type="button"
              aria-label={aboard ? 'Step ashore' : 'Board the nearest boat'}
              className={`${buttonLook} border-white/70 bg-[#0b1a33]/75 active:bg-[#0b1a33]/95`}
              style={{ right: 'max(14px, env(safe-area-inset-right))', bottom: 'max(14px, env(safe-area-inset-bottom))', touchAction: 'none' }}
              onClick={tapButton(() => actionsRef.current.board())}
              onPointerDown={mine}
              onPointerMove={mine}
              onPointerUp={mine}
            >
              {aboard ? 'Ashore' : 'Board'}
            </button>
          )}
          {!indoors && (
            <button
              type="button"
              aria-label="Change view"
              className={`${buttonLook} border-white/30 bg-[#0b1a33]/60 active:bg-[#0b1a33]/90`}
              style={{ left: 'max(14px, env(safe-area-inset-left))', bottom: 'max(14px, env(safe-area-inset-bottom))', touchAction: 'none' }}
              onClick={nextView}
              onPointerDown={mine}
              onPointerMove={mine}
              onPointerUp={mine}
            >
              View
            </button>
          )}
          {!onFoot && (
            <>
              <button
                type="button"
                aria-label="Drop a bomb"
                aria-pressed={bombing}
                className={`${buttonLook} ${bombing ? 'border-white/70 bg-[#7a2418]/90' : 'border-white/30 bg-[#0b1a33]/60'}`}
                style={{
                  right: 'max(14px, env(safe-area-inset-right))',
                  bottom: 'calc(max(14px, env(safe-area-inset-bottom)) + 76px)',
                  touchAction: 'none',
                }}
                onPointerDown={bombOn}
                onPointerMove={mine}
                onPointerUp={bombOff}
                onPointerCancel={bombOff}
                onLostPointerCapture={bombOff}
                onContextMenu={(e) => e.preventDefault()}
              >
                Bomb
              </button>
              <button
                type="button"
                aria-label="Throttle: hold to open it and trail smoke"
                aria-pressed={boosting}
                className={`${buttonLook} ${boosting ? 'border-white/70' : 'border-white/30 bg-[#0b1a33]/60'}`}
                style={{
                  right: 'max(14px, env(safe-area-inset-right))',
                  bottom: 'max(14px, env(safe-area-inset-bottom))',
                  touchAction: 'none',
                  backgroundColor: boosting ? params.accentColor : undefined,
                }}
                onPointerDown={boostOn}
                onPointerMove={mine}
                onPointerUp={boostOff}
                onPointerCancel={boostOff}
                onLostPointerCapture={boostOff}
                onContextMenu={(e) => e.preventDefault()}
              >
                Boost
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
