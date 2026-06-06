import './style.css'
import { initVeil } from './veil/veil.js'

const canvas = document.getElementById('silk')
const teardown = initVeil(canvas)

// Clean up the render loop on hot reload so we don't stack WebGL contexts.
if (import.meta.hot) {
  import.meta.hot.dispose(() => teardown())
}
