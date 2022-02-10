// Contains *everything*: renderer, scene, etc.
import {
  AmbientLight,
  Color,
  PerspectiveCamera, Raycaster,
  Scene,
  SpotLight, Vector2,
  Vector3,
  WebGLRenderer
} from "../external/three.module.js"
import {SHAPES} from "./symmetries.js"
import {OrbitControls} from "../external/three_addons.js"
import {clearTextElements, drawTextElements} from "./text_elem.js"

class VisScene extends Scene {
  setDomain (d) {
    this.domain = d
    this.children.forEach(c => c.setDomain?.(d))

    this.clickable = !!d && this.clickable
  }

  add (o) {
    super.add(o)

    o.setDomain?.(this.domain)
  }

  remove (...args) {
    super.remove(...args)
  }
}

class VisDomain {
  constructor (params={}) {
    // three.js stuff
    this.renderer = new WebGLRenderer({ antialias: true })
    this.scene = new VisScene()
    this.camera = new PerspectiveCamera( 70, 0, 0.0001, 1000 )
    this.defaultCameraPosition = params.defaultCameraPosition ?? new Vector3(1, 1, 1)
    this.defaultCameraTarget = params.defaultCameraTarget ?? new Vector3()
    this.renderer.setPixelRatio(window.devicePixelRatio)

    // Parent element in DOM
    this.parentElement = null
    this.drawingSurface = this.renderer.domElement
    this.orbitControls = new OrbitControls(this.camera, this.drawingSurface)

    this.setDefaultCamera()

    this.clickableObjects = []

    // Used for text elements
    let svg = this.svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.classList.add("text-svg")

    this.useTranslationControls = false

    this.width = 0 // in CSS coordinates
    this.height = 0
    this.computeDims()

    this.scene.domain = this

    this.raycaster = new Raycaster();
    this.mousePos = new Vector2(-Infinity, -Infinity);

    this.isMouseDown = false
    this.mouseDownOn = null // object on which mouse clicked
    this.hovering = null // object hovering on

    this.selected = null // either type: "axis" or type: "plane", with obj: <the relevant object>.
    // when something is selected, no hover events are dispatched at all. click events are only dispatched to the
    // selected object.

    this.init()
  }

  /**
   * Attach this domain to an actual DOM element, with automatic resizing to fit that element
   * @param e {Element}
   */
  attachToElement (e) {
    if (!(e instanceof Element)) throw new TypeError("e must be an Element")

    this.parentElement = e
    e.appendChild(this.drawingSurface)
    e.appendChild(this.svgElement)

    // Automatically resize when the element changes. Also is called on window.onload
    new ResizeObserver(() => this.resizeToFit()).observe(e)
  }

  resizeToFit () {
    let p = this.parentElement
    if (!p) return

    let { width, height } = p.getBoundingClientRect()
    let { renderer, camera, svgElement } = this

    renderer.setSize(width, height);
    camera.aspect = width / height
    camera.updateProjectionMatrix()

    renderer.setPixelRatio(window.devicePixelRatio)

    svgElement.setAttribute("width", width)
    svgElement.setAttribute("height", height)

    this.width = width
    this.height = height
  }

  computeDims () {
    let r = this.drawingSurface.getBoundingClientRect()

    this.width = r.width
    this.height = r.height
  }

  /**
   * Set the background of this domain
   * @param color
   */
  setBG (color) {
    color = new Color(color)
    console.log("hi")

    this.scene.background = color
  }

  setDefaultCamera() {
    let { camera, orbitControls } = this
    let target = this.defaultCameraTarget

    camera.position.copy(this.defaultCameraPosition)
    camera.up.set( 0, 1, 0 );
    camera.lookAt(...target.toArray())

    console.log(target)

    camera.updateProjectionMatrix()

    this.hasOrbitControlsEverInitialized ? orbitControls.saveState() : orbitControls.reset()
    orbitControls.saveState()
    orbitControls.target.set(...target.toArray())

    this.hasOrbitControlsEverInitialized  = true


    this.orbitControls.update()
  }

  init () {
    let { scene } = this

    scene.add(new AmbientLight( 0xbbbbbb));

    const light = new SpotLight( 0xffffff, 1.5 );
    light.position.set( 0, 500, 2000 );

    scene.add(light);

    this.drawingSurface.addEventListener("mousemove", e => this.onMouseMove(e), false)
    this.drawingSurface.addEventListener("mousedown", e => this.onMouseDown(e), false)
    this.drawingSurface.addEventListener("mouseup", e => this.onMouseUp(e), false)
    this.drawingSurface.addEventListener("click", e => this.onClick(e), false)
  }

  onMouseMove (event) {
    this.mousePos.copy(this.DOMToDrawCoords(new Vector2(event.x, event.y), true))
  }

  allow3DRotation (v) {
      if (typeof v !== "boolean") {
        throw new Error("allow3DRotation must be a boolean") // thanks copilot
      }

      if (!v) {
        this.setDefaultCamera()
        this.useTranslationControls = true
        this.orbitControls.enableRotate = false
      } else {
        this.useTranslationControls = false
        this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.1 // prevent from going under the grid
        this.orbitControls.enabled = true
        this.orbitControls.enableRotate = true
      }
  }

  onMouseDown (e) {
    this.onMouseMove(e)
    this.isMouseDown = true

    this.mouseDownOn = this.ifMouseDownOnObject()
    this.onMouseMove(e)
  }

  ifMouseDownOnObject () {
    this.raycaster.setFromCamera(this.mousePos, this.camera);
    const intersects = this.raycaster.intersectObjects(this.clickableObjects);

    // Disable orbit controls if applicable

    let on = (intersects.length === 0) ? null : intersects[0].object

    if (this.isMouseDown && on)
      this.orbitControls.enabled = !this.useTranslationControls

    if (on !== this.hovering && !this.selected) { // ignore hovered if something is selected
      let old = this.hovering
      this.hovering = on

      if (old) {
        old.triggerEvent?.("hover_off")
      }

      if (on) {
        on.triggerEvent?.("hover")
      }
    }

    return on
  }

  onClick (e) {
    if (this.hovering) {
      this.hovering.triggerEvent?.("click")
    }
  }

  onMouseUp () {
    this.isMouseDown = false

    let on = this.ifMouseDownOnObject()

    if (on && on === this.mouseDownOn) {
      // Clicked on an object
      on.triggerEvent?.("short click", { pos: this.mousePos })
    }
  }

  resetDisplayedSymmetries () {

  }

  tick () {
    this.ifMouseDownOnObject()
    this.orbitControls.update()
    this.camera.updateProjectionMatrix()

    clearTextElements()
    this.renderer.render(this.scene, this.camera)

    // Draw text
    drawTextElements(this.svgElement)
  }

  getSize () {
    return new Vector2(this.width, this.height)
  }

  drawToDOMCoords (v, includePageOffset=false) {
    let size = this.getSize()
    let b = this.drawingSurface.getBoundingClientRect()

    v = v.clone()

    v.x = (v.x * size.x / 2) + size.x / 2 + b.x * includePageOffset
    v.y = -(v.y * size.y / 2) + size.y / 2 + b.y * includePageOffset

    return v
  }

  DOMToDrawCoords (v, includePageOffset=true) {
    let size = this.getSize()
    let b = this.drawingSurface.getBoundingClientRect()

    v = v.clone()

    v.x -= includePageOffset * b.x
    v.y -= includePageOffset * b.y

    v.x = (v.x - size.x / 2) * 2 / size.x
    v.y = (v.y - size.y / 2) * -2 / size.y

    return v
  }
}

export { VisDomain }
