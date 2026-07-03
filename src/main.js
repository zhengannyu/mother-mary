import './style.css'
import { initVeil } from './veil/veil.js'

const canvas = document.getElementById('silk')
const teardown = initVeil(canvas)

// Scale the fixed 1920×1080 poster stage to fit the window.
function fitStage() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
  document.documentElement.style.setProperty('--stage-scale', String(scale))
}
fitStage()
window.addEventListener('resize', fitStage)

// Hand-drawn "boiling" frame: re-seed the turbulence filter a few times
// per second so the wobbly stroke jitters like stop-motion animation.
const squiggleTurbulence = document.querySelector('#frame-squiggle feTurbulence')
let squiggleTimer
if (squiggleTurbulence && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let seed = 1
  squiggleTimer = setInterval(() => {
    seed = (seed % 12) + 1
    squiggleTurbulence.setAttribute('seed', String(seed))
  }, 120)
}

// Clean up the render loop on hot reload so we don't stack WebGL contexts.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    teardown()
    clearInterval(squiggleTimer)
  })
}
