import { VisDomain } from "./vis_domain.js"
import {Color, GridHelper, Matrix3, Matrix4, Vector3} from "../external/three.module.js"

import * as THREE from "../external/three.module.js"
import * as TWEEN from "../external/tween.esm.js"

import {VisText} from "./text_elem.js"
import {SymmetricObject} from "./symmetric_object.js"
import {explainMatrix, motionFromMatrix, SHAPES} from "./symmetries.js"
import {VisObject} from "./vis_object.js"
import {ReflectivePlaneObject} from "./reflective_plane_object.js"
import {AxisObject} from "./axis_object.js"

Object.assign(window, { THREE })

let STARTING_POS = new Vector3(-5, 0, -3)

// Styling info for y'all
// You can just set the value in styles and it will automatically update
let styles = {
  //triangleColor: { default: 0x8f8f1f, handler: setColor(() => triangleMaterial) },
  gridColor: { default: 0x888888, handler: v => mainGrid.colorCenterLine = mainGrid.colorGrid = new Color(v) },
  backgroundColor: { default: 0xf0f0f0, handler: v => (mainDomain.setBG(v), miniatureDomain.setBG(v)) },
  //selectedTriangleColor: { default: 0x3f3f3f, handler: setColor(() => selectedTriangleMaterial)},
  allow3DRotation: { default: true, handler: v => (mainDomain.allow3DRotation(v), DOM.allow3DRotation.checked = v) }
}

Object.assign(window, { styles })

// Note, if you change this you will have to change some other stuff
const SIZE = 15 // width of the entire grid
const gridDivisions = 15

// Overall scaling factor used for units
const SCALE = SIZE / gridDivisions
const gridSize = SIZE

let DOM = {} // mapping from id -> element
let DOMList = {
  mainSurface: "main-surface",
  groupSelectors: "group-selectors",
  items: "items",
  allow3DRotation: "allow-3d",
  miniature: "miniature",
  shapeSelector: "shape-select"
}

// Retrieve elements
for (let [ name, id ] of Object.entries(DOMList))
  if (!(DOM[name] = document.getElementById(id))) throw new Error(`Id ${id} doesn't exist`)

function setColor(target) {
  return v => target().color = new Color(v)
}

// Set all styles to their default values
function setStyleDefaults () {
  for (let o of Object.values(styles)) {
    (o.setDefault = () => o.handler(o.value = o.default))()
  }
}

DOM.allow3DRotation.addEventListener("input", () => {
  mainDomain.allow3DRotation(DOM.allow3DRotation.checked)
})

const mainDomain = new VisDomain({ defaultCameraPosition: new Vector3(0, SIZE / 2, 5), defaultCameraTarget: STARTING_POS })
mainDomain.attachToElement(DOM.mainSurface)

const mainGrid = new GridHelper(gridSize, gridDivisions)
mainDomain.scene.add(mainGrid)


const miniatureDomain = new VisDomain( { defaultCameraPosition: new Vector3(1, 1.1, 1) })
miniatureDomain.attachToElement(DOM.miniature)
miniatureDomain.setDefaultCamera()

let text = new VisText({ text: "300", position: new Vector3(0, 0, 0) })
//miniatureDomain.scene.add(text)

function render () {
    mainDomain.tick()
  miniatureDomain.tick()
  TWEEN.update()

  requestAnimationFrame(render)
}

let miniatureSym
let CURRENT_SHAPE = SHAPES.triangle

let congaLine = []

function resetAll () {
    congaLine.forEach(c => mainDomain.scene.remove(c))
  clearDemonstration()

  mainDomain.clickableObjects = []

  let seed = new SymmetricObject({ shape: CURRENT_SHAPE, position: STARTING_POS.clone() })
  congaLine = [ seed ]

  mainDomain.scene.add(seed)
  allowClick(seed)

  miniatureSym?.dispose()
  miniatureDomain.scene.remove(miniatureSym)
  miniatureSym = new SymmetricObject({ shape: CURRENT_SHAPE })

  miniatureSym.showAxisObjects(showAxes)
  miniatureSym.showPlaneObjects(showPlanes)

  miniatureDomain.scene.add(miniatureSym)
  miniatureDomain.setDefaultCamera()

  clearRotateButtons()
  toggleReflectButton(true)

    mainDomain.setDefaultCamera()
    //miniatureDomain.setDefaultCamera()
}

function setShape (shape) {
    CURRENT_SHAPE = shape
  let name = shape.name

  DOM.shapeSelector.value = name
  resetAll()
}

let queue = []

function allowClick (o) {
    o.clickable = true
    o.addVisEventListener("click", () => {
      let t = mainDomain.orbitControls.target
      new TWEEN.Tween(t)
        .to(o.position.clone(), 200)
        .easing(TWEEN.Easing.Quadratic.In)
        .onUpdate(() => {
          if (mainDomain.useTranslationControls) {
            // Move to face down
            mainDomain.camera.position.set(t.x, mainDomain.camera.position.y, t.z)

            mainDomain.orbitControls.update()
          }
        }).start()
    })
}

let congaInMotion = false
let animDuration = 1000

function addToCongaLine (motion) {
    if (!motion) return

  if (congaInMotion) {
    queue.push(motion)
    return
  }

  congaInMotion = true

  let last = congaLine[congaLine.length - 1]

  let n = last.castratedClone()
  // Translate n in the +x direction
  mainDomain.scene.add(n)

  congaLine.push(n)
  allowClick(n)

  new TWEEN.Tween(n.position)
    .to(n.position.clone().add(new Vector3(2.5, 0, 0)), animDuration)
    .easing(TWEEN.Easing.Quadratic.In)
    .onUpdate(() => {
      n.updateMatrix()

      mainDomain.orbitControls.target.copy(n.position)
      if (mainDomain.useTranslationControls) {
        // Move to face down
        mainDomain.camera.position.set(n.position.x, mainDomain.camera.position.y, n.position.z)

        mainDomain.orbitControls.update()
      }
    })
    .onComplete(() => {
      let god = n.performMotion(motion, animDuration)
      if (god) {
        god.onComplete(() => {
          congaInMotion = false
          addToCongaLine(queue.splice(0, 1)[0])
        })
      } else {
        congaInMotion = false
      }
    }).start()
}

let demonstration

function clearDemonstration () {
  // Translate n in the +x direction
  demonstration?.dispose()
  mainDomain.scene.remove(demonstration)
  demonstration = null
}

function demonstrateCongaLine () {
    if (congaLine.length <= 1) return

  if (congaInMotion) return
    mainDomain.setDefaultCamera()

  let first = congaLine[0]
    let last = congaLine[congaLine.length - 1]

  let shiftDown = new Vector3(0, 0, 4) // z direction
  let n = first.castratedClone()

  n.position.add(shiftDown)
  let n2 = n.castratedClone()

  clearDemonstration()

  demonstration = new VisObject()
  mainDomain.scene.add(demonstration)

  demonstration.add(n)
  demonstration.add(n2)

  allowClick(n)
  allowClick(n2)

  let netMotion = motionFromMatrix(CURRENT_SHAPE, last.currentTransform)
  let expl = explainMatrix(last.currentTransform)

  // TODO rotoreflection
  new TWEEN.Tween(n.position)
    .to(last.position.clone().add(shiftDown), 1.5 * animDuration)
    .easing(TWEEN.Easing.Quadratic.In)
    .onUpdate(() => {
      n.updateMatrix()

      mainDomain.orbitControls.target.copy(n.position)
      if (mainDomain.useTranslationControls) {
        // Move to face down
        mainDomain.camera.position.set(n.position.x, mainDomain.camera.position.y, n.position.z)

        mainDomain.orbitControls.update()
      }
    })
    .onComplete(() => {
      let god = n.performMotion(netMotion, animDuration)
    }).start()
}

setStyleDefaults()
render()

function toggleReflectButton(v){
    document.getElementById('reflect').classList.toggle('hidden', v)
}

function clearRotateButtons(){
    const el = document.getElementById('rotate-container');
    el.innerHTML = null
}

function createRotateButtons(...degrees){
    const el = document.getElementById('rotate-container');
    clearRotateButtons()
    const nodes = degrees.map((n)=>{
      const btn = document.createElement('button');
      btn.className = 'smol-button';
      btn.addEventListener('click', ()=>{
        window.dispatchEvent(new CustomEvent("on rotate", { detail: n }))
      })

      btn.innerText = `Rotate ${n}°`

      return btn
    })
    nodes.forEach((node)=>{
      el.appendChild(node)
    })
}

window.addEventListener("on deselected", ()=>{
    clearRotateButtons()
    toggleReflectButton(true)
})

window.addEventListener("on plane selected", ()=>{
  toggleReflectButton(false)})

window.addEventListener("on axis selected", (e)=>{
  createRotateButtons(...e.detail)
})

window.addEventListener("on rotate", (e)=>{
  doRotation(e.detail * Math.PI / 180)
    console.log("Rotate the object by ", e.detail, " degrees")
})

resetAll()

var showAxes = true
var showPlanes = true

window.showAxes = (v) => {
  showAxes = v
  showStuff()
}

function showStuff () {
  miniatureSym.showPlaneObjects(showPlanes)
  miniatureSym.showAxisObjects(showAxes)
}

window.showPlanes = (v) => {
  showPlanes = v
  showStuff()
}

DOM.shapeSelector.addEventListener("input", () => {
  let shapeName = DOM.shapeSelector.value

  let shape = Object.values(SHAPES).filter(s => s.name === shapeName)[0]
  if (!shape) return // unknown shape

  setShape(shape)
})

setShape(SHAPES.triangle)

window.doSelectedAction = () => {
  let selected = miniatureDomain.selected
    if (!selected) return

  if ((selected instanceof ReflectivePlaneObject)) doReflection()
  if (selected instanceof AxisObject) doRotation()
}

window.doReflection = () => {
    let selected = miniatureDomain.selected

  let motion = motionFromMatrix(CURRENT_SHAPE, selected.toMatrix())
  if (motion)
    addToCongaLine(motion)
}

window.doRotation = (radians) => {
  let selected = miniatureDomain.selected

  let motion = motionFromMatrix(CURRENT_SHAPE, selected.toMatrix(radians))
  if (motion)
    addToCongaLine(motion)
}

window.showNetMovement = () => {
    demonstrateCongaLine()
}

window.resetStuff = () => {
    resetAll()
}

window.setAnimSpeed = v => animDuration = (1600 - v)

Object.assign(window, { mainDomain, miniatureDomain, addToCongaLine, setShape, demonstrateCongaLine, motionFromMatrix })
