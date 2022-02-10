import {
  Vector2,
  Vector3,
  Matrix4,
  Matrix3,
  Quaternion,
  BufferGeometry,
  BoxGeometry,
  BoxBufferGeometry
} from "../external/three.module.js"
import {ConvexGeometry} from "../external/three_addons.js"

// Helper stuffs for symmetries, etc.

// We describe our shape in question as a set of vertices centered around its centroid, (0,0,0). All of its symmetries
// are thus isometries which preserve the centroid and permute the vertices in some way. We index the vertices 0 ... n-1,
// where n is the vertex count, and a movement is therefore some valid permutation of the vertices. A permutation is
// valid if, in 3-dimensional space, each vertex is mapped to a distinct destination vertex, and the distances between
// each pair of vertices is preserved.

// Assumed to be convex
export class SymmetricShape {
  constructor (params={}) {
    this.name = params.name
    this.dimensions = params.dimensions // should be 2 or 3
    this.vertices = params.vertices // vertices centered around (0, 0, 0)
    this.vertexNames = params.vertexNames

    this.normalizeVertexDimensions()

    let generators = params.generators?.map(g => Array.isArray(g) ? new Motion(g) : motionFromMatrix(this, g)) ?? []
    generators.map((g, i) => { if (!g) throw new Error(`Generator at index ${i} is not a valid symmetry of the object`)})

    let group = this.fullSymmetryGroup = computeSymmetryGroup(this, generators)

    this.axes = group.getAxes() // axes in which this shape is symmetrical in
    this.reflectiveNormals = group.getReflectiveNormals() // normals of reflective planes this shape is symmetrical in

    this.axisNames = []

    this.faceColors = params.faceColors ?? null
    this.geometry = params.geometry ?? new ConvexGeometry(this.vertices)
  }

  normalizeVertexDimensions() {
    let v = this.vertices

    if (v[0] instanceof Vector2) {
      this.vertices = this.vertices.map(v => new Vector3(v.x, 0, v.y))
    }
  }

  getRotationOptions (axisNormal) {
    let g = this.fullSymmetryGroup
    let opts = []

    for (let e of g.elements) {
      let m = explainMatrix(e.toMatrix(this))

      if (m.length === 1 && m[0].type === "rotation") {
        let a = m[0].axis
        let eq
        if (eq = closelyEquilinear(a, axisNormal)) {
          let theta = m[0].theta

          if (eq === -1) {
            theta = -theta // axis is dumb
          }

          theta = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
          if (theta > Math.PI) theta = theta - 2 * Math.PI


          opts.push(Math.round(theta * 180 / Math.PI))
        }
      }
    }

    return opts
  }
}

export function closeEnough (d1, d2) {
  if (Math.abs(d2) < 1e-6) {
    return Math.abs(d1 - d2) < 1e-6 // lol
  }

  return Math.abs(d1 / d2 - 1) < 1e-6
}

function isIsometry (shape, motion) {
  let v = shape.vertices
  let m = motion.permutation

  if (v.length !== m.length) return false
  let count = v.length

  // Check every pair of points and see if their distances are close
  for (let i = 0; i < count - 1; ++i) {
    for (let j = i + 1; j < count; ++j) {
      if (!closeEnough(v[i].distanceTo(v[j]), v[m[i]].distanceTo(v[m[j]])))
        return false
    }
  }

  return true
}

// Returns a Mat4 from a valid isometry
export function matrixFromIsometry (shape, motion) {
  if (!isIsometry(shape, motion)) return null

  // [ a b c ] [ v1x v2x v3x ]   [ w1x w2x w3x ]
  // | d e f ] [ v1y v2y v3y ] = [ w1y w2y w3y ]
  // [ g h i ] [ v1z v2z v3z ]   [ w1z w2z w2z ]
  //     T           V                  W

  // T = WV^-1

  // get first three vertex pairs
  let [ v1, v2, v3 ] = shape.vertices
  let [ w1, w2, w3 ] = shape.vertices.map((_, i) => shape.vertices[motion.permutation[i]])

  let V = new Matrix3()
  V.set(v1.x, v2.x, v3.x, v1.y, v2.y, v3.y, v1.z, v2.z, v3.z)
  let W = new Matrix3()
  W.set(w1.x, w2.x, w3.x, w1.y, w2.y, w3.y, w1.z, w2.z, w3.z)

  let M = W.multiply(V.invert())
  return new Matrix4().setFromMatrix3(M)
}

/**
 *
 * @param shape
 * @param matrix {Matrix4}
 */
export function motionFromMatrix (shape, matrix) {
  // Assumes the matrix is valid

  let v = shape.vertices
  let vtr = v.map(v => v.clone().applyMatrix4(matrix))

  // get indices in v of each element in vtr
  let perm = vtr.map(newv => v.findIndex(v => v.distanceTo(newv) < 1e-6))
  if (perm.indexOf(-1) !== -1) // lol
    return null

  return new Motion(perm)
}

export function explainMatrix (mat4) {
  // A 3d transformation matrix can be decomposed into one of the following:
  // identity
  // reflection across some plane
  // rotation by some angle theta around some axis
  // reflection followed by rotation (rotoreflection)
  // We're preserving the origin, which is nice

  /**
   * Is identity
   * @param m {Matrix4}
   */
  function detectIdentity (m) {
    let a = new Matrix4().toArray()
    let b = m.toArray()

    return a.map((v, i) => Math.abs(v - b[i])).reduce((a, b) => a + b) < 1e-6
  }

  if (detectIdentity(mat4)) return [ { type: "identity", m: mat4 } ]

  let q = new Quaternion()
  let s = new Vector3()

  mat4.decompose(new Vector3() /* should always be 0,0,0 */, q, s)

  let k = Math.sqrt(1 - q.w * q.w)
  if (k < 1e-6) k = 1

  let axis = new Vector3(q.x / k, q.y / k, q.z / k)
  let theta = 2 * Math.acos(q.w)

  if (closeEnough(theta, 2 * Math.PI) || closeEnough(theta, 2 * Math.PI)) theta = 0
  if (closeEnough(s.x, 1) && closeEnough(s.y, 1) && closeEnough(s.z, 1)) {
    // Pure rotation, def not reflection, tries to turn it into a clockwise rotation if >180
    let ccw = true
    if (theta > Math.PI) {
      ccw = false
      theta = theta - 2 * Math.PI
    }

    return [ { type: "rotation", axis, theta, m: mat4, ccw } ]
  }

  // If it's a reflection with unit normal <a, b, c>... see
  // https://en.wikipedia.org/wiki/Transformation_matrix#Examples_in_3D_computer_graphics

  let r = mat4.toArray()
  let a = (1 - r[0]) / 2
  if (closeEnough(a, 0)) a = 0 // arbitrarily choose a to be the positive root

  a = Math.sqrt(a)

  let b = (a === 0) ? Math.sqrt(Math.abs((1 - r[5]) / 2)) : (r[1] / (-2 * a))
  if (closeEnough(b, 0)) b = 0

  let c = (a === 0) ? Math.sqrt(Math.abs((1 - r[10]) / 2)) : (r[2] / (-2 * a))
  if (closeEnough(c, 0)) c = 0

  //console.log('a', a, 'b', b, 'c', c)

  if (![a,b,c].every(Number.isFinite)) throw new Error("what the fuck")

  // We now confirm that it is a genuine reflection matrix...

  let expect = [ 1-2*a*a, -2*a*b, -2*a*c, NaN, -2*a*b, 1-2*b*b, -2*b*c, NaN, -2*a*c, -2*b*c, 1-2*c*c ]
  //console.log(expect, r, a, b, c)
  if (expect.every((s, i) => !Number.isFinite(s) || closeEnough(s, r[i]))) {
    // Pure reflection about normal <a, b, c>
    return [ { type: "reflection", normal: new Vector3(a, b, c), m: mat4 }]
  }

  // It's a fucking rotoreflection
  return [ { type: "rotation", axis, theta, m: new Matrix4().makeRotationFromQuaternion(q) },
    { type: "reflection", normal: s, m: new Matrix4().makeScale(s.x, s.y, s.z) }]
}

export function radiansToReadable (r) {
  return Math.round(r * 180 / Math.PI) + '°'
}

export class Motion {
  constructor (perm, shape) {
    if (typeof perm === "number") perm = [...new Array(perm).keys()]

    this.permutation = perm // [0, 1 ... n] is identity
  }

  eq (m) {
    return this.permutation.every((p, i) => m.permutation[i] === p)
  }

  compose (m) {
    let p = this.permutation
    let mp = m.permutation

    if (p.length !== mp.length) throw new Error("οκεανος")
    return new Motion( p.map(i => mp[i]))
  }

  isIdentity () {
    return this.permutation.every((i, j) => i === j)
  }

  toMatrix (shape) {
    return matrixFromIsometry(shape, this)
  }
}

// We compute the full symmetry group of a 3-dimensional shape. One way to do this would be to iterate through all
// permutations (n!), but that is slow. Instead, we use some list of motions as generators and apply them repeatedly
function computeSymmetryGroup(shape, generators=[]) {
  let vCount = shape.vertices.length
  let identity = new Motion(vCount)

  let elems = [ identity, ...generators ]
  let prevLen

  do {
    prevLen = elems.length
    if (prevLen > 240) throw new Error("The symmetry group is too large")

    for (let i = 0; i < prevLen; ++i) {
      let m1 = elems[i]
      for (let j = 0; j < prevLen; ++j) {
        let m2 = elems[j]

        // Compose two motions to get a potentially new motion
        let newM = m1.compose(m2)

        if (!elems.some(e => e.eq(newM)))
          elems.push(newM)
      }
    }
  } while (elems.length !== prevLen)

  // At this point, we should have all possible generated permutations
  return new SymmetryGroup({ shape, elems })
}

function closelyEquilinear (v1, v2) {
  let r = 0
  if (Math.abs(v2.x) < 1e-6) {
    if (Math.abs(v2.y) < 1e-6) {
      if (Math.abs(v2.z) < 1e-6) {
        throw new Error("The vector is too close to zero for equilinearity to be established")
      } else {
        r = v1.z / v2.z
      }
    } else {
      r = v1.y / v2.y
    }
  } else {
    r = v1.x / v2.x
  }

  let av1x = v2.x * r
  let av1y = v2.y * r
  let av1z = v2.z * r

  let sign = Math.sign(r)

  return (closeEnough(av1x, v1.x) && closeEnough(av1y, v1.y) && closeEnough(av1z, v1.z)) ? sign : 0
}

export class SymmetryGroup {
  constructor (params={}) {
    this.shape = params.shape
    this.elements = params.elems // array of motions
  }

  getAxes () {
    // Iterate through each element; test whether it's a rotation, record the axis if it is

    let axes = []

    for (let elem of this.elements) {
      let explain = explainMatrix(elem.toMatrix(this.shape))
      if (explain.length === 1 && explain[0].type === "rotation") explain = explain[0]
      else continue

      axes.push(explain.axis)
    }

    // remove axes if they are equilinear to another axis
    let filtered = []
    axes.forEach(a => {
      if (!filtered.some(m => closelyEquilinear(a, m))) filtered.push(a)
    })

    return filtered
  }

  getReflectiveNormals () {
    let norms = []

    for (let elem of this.elements) {
      let explain = explainMatrix(elem.toMatrix(this.shape))
      if (explain.length === 1 && explain[0].type === "reflection") explain = explain[0]
      else continue

      norms.push(explain.normal)
    }

    return norms
  }
}

/**
 * The vertices of a (2-dimensional) regular polygon, with the first vertex at (1, 0)
 * @param n {number} Vertex count
 * @param circumradius {number}
 * @param rot {number} Extra rotation ccw to apply
 * @returns {Vector2[]}
 */
export function generateRegularPolygon (n=3, circumradius=1, rot=0) {
  let points = []

  for (let i = 0; i < n; ++i) {
    let x = Math.cos(i / n * 2 * Math.PI + rot) * circumradius
    let z = Math.sin(i / n * 2 * Math.PI + rot) * circumradius
    points.push(new Vector2(x, z))
  }

  return points
}

/**
 * Fatten a polygon in the y direction (recall the three.js convention that y is upwards, while the xz-plane is the
 * "ground")
 * @param vertices {Vector2[]}
 * @param thickness {number}
 * @returns {Vector3[]}
 */
export function fattenPolygon (vertices, thickness=0.5) {
  thickness /= 2
  return vertices.flatMap(v => [ new Vector3(v.x, -thickness, v.y), new Vector3(v.x, thickness, v.y) ])
}

function generateSkinnyPolygon(n, cr=1, rot=0) {
  return fattenPolygon(generateRegularPolygon(n, cr, rot), 0.1)
}

let cs = x => x >= 0 ? 1 : -1

export function getCylinderBasis (n, girth, preferAxisAligned=false) {
  let p
  n = n.clone().normalize()

  if (preferAxisAligned) {
    // Try to get a vector where one of the components is 0... y, then x, then z
    let p1 = new Vector3(n.z, 0, -n.x)
    let p2 = new Vector3(0, n.z, -n.y)
    let p3 = new Vector3(-n.y, n.x, 0)

    let ps = [ p1, p2, p3 ]
    p = ps.reduce((v1, v2) => v1.lengthSq() < v2.lengthSq() ? v2 : v1)

    if (p.lengthSq() < 1e-6) preferAxisAligned = false
    p.normalize().multiplyScalar(girth)
  }

  if (!preferAxisAligned)
    p = new Vector3(Math.abs(n.z) * cs(n.x),
      Math.abs(n.z) * cs(n.y),
      -(Math.abs(n.x) + Math.abs(n.y)) * cs(n.z)).normalize().multiplyScalar(girth)

  let q = new Vector3().crossVectors(n, p).normalize().multiplyScalar(girth)

  return [ p, q ]
}

/**
 *
 * @param verts {Vector3[]}
 * @param res
 * @param showCone
 * @param shaftGirth
 * @param coneGirth
 * @param coneLen
 */
export function generateArrow (verts, { res=16, showCone = true, shaftGirth = 0.1, coneGirth = 0.2, coneLen = 0.5 } = {}) {
  // We basically strategically generate a bunch of cylinders
  let geoV = []
  let n = new Vector3()

  for (let i = 0; i < verts.length - 1; ++i) {
    let pv = verts[i]
    let nv = verts[i+1]

    // Draw cylinder starting at pv, ending at nv, radius shaftGirth, resolution 8
    n.subVectors(nv, pv).normalize()
    let [ p, q ] = getCylinderBasis(n, shaftGirth)

    // EXTREMELY UNOPTIMIZED LOL
    let v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), v4 = new Vector3(), d1 = new Vector3(), d2 = new Vector3()

    for (let i = 0; i < res; ++i) {
      // For each rectangle...
      let c1 = Math.cos(i / res * 2 * Math.PI)
      let s1 = Math.sin(i / res * 2 * Math.PI)
      let c2 = Math.cos((i+1) / res * 2 * Math.PI)
      let s2 = Math.sin((i+1) / res * 2 * Math.PI)

      d1 = p.clone().multiplyScalar(c1).add(q.clone().multiplyScalar(s1))
      d2 = p.clone().multiplyScalar(c2).add(q.clone().multiplyScalar(s2))

      v1.addVectors(pv, d1)
      v2.addVectors(pv, d2)
      v3.addVectors(nv, d1)
      v4.addVectors(nv, d2)

      geoV.push(
        v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z, // triangle 1
        v4.x, v4.y, v4.z, v3.x, v3.y, v3.z, v2.x, v2.y, v2.z,  // triangle 2
        pv.x, pv.y, pv.z, v2.x, v2.y, v2.z, v1.x, v1.y, v1.z, // cap 1 triangle
        nv.x, nv.y, nv.z, v3.x, v3.y, v3.z, v4.x, v4.y, v4.z // cap 2 triangle
      )
    }
  }

  // n is last normal, add cone
  if (showCone) {
    let [ p, q ] = getCylinderBasis(n, coneGirth)
    let last = verts[verts.length - 1]
    let tip = last.clone().add(n.clone().multiplyScalar(coneLen))

    let v1 = new Vector3(), v2 = new Vector3(), d1 = new Vector3(), d2 = new Vector3()

    for (let i = 0; i < res; ++i) {
      // For each rectangle...
      let c1 = Math.cos(i / res * 2 * Math.PI)
      let s1 = Math.sin(i / res * 2 * Math.PI)
      let c2 = Math.cos((i+1) / res * 2 * Math.PI)
      let s2 = Math.sin((i+1) / res * 2 * Math.PI)

      d1 = p.clone().multiplyScalar(c1).add(q.clone().multiplyScalar(s1))
      d2 = p.clone().multiplyScalar(c2).add(q.clone().multiplyScalar(s2))

      v1.addVectors(last, d1)
      v2.addVectors(last, d2)

      geoV.push(
        v1.x, v1.y, v1.z, last.x, last.y, last.z, v2.x, v2.y, v2.z, // cap triangle
        v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, tip.x, tip.y, tip.z // to tip
      )
    }
  }

  let geo = new BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute( new Float32Array(geoV), 3 ))
  geo.computeVertexNormals()

  return geo
}

let gr = (1 + Math.sqrt(5)) / 2

export const SHAPES = {
  triangle: new SymmetricShape({
    name: "Equilateral triangle",
    dimensions: 2,
    vertices: generateSkinnyPolygon(3),
    generators: [
      new Matrix4().makeRotationY(2 * Math.PI / 3), // single rotation of 120°
      new Matrix4().makeScale(1, 1, -1) // single reflection to make it a dihedral group
    ],
    vertexNames: [ '1', '', '3', '', '2' ]
  }),
  square: new SymmetricShape({
    name: "Square",
    dimensions: 2,
    vertices: generateSkinnyPolygon(4, 1, Math.PI / 4), // axis aligned square
    generators: [
      new Matrix4().makeRotationY(Math.PI / 2), // single rotation of 90°
      new Matrix4().makeScale(1, 1, -1) // single reflection to make it a dihedral group
    ],
    vertexNames: [ '4', '', '1', '', '3', '', '2' ]
  }),
  pentagon: new SymmetricShape({
    name: "Equilateral pentagon",
    dimensions: 2,
    vertices: generateSkinnyPolygon(5),
    generators: [
      new Matrix4().makeRotationY(2 * Math.PI / 5), // single rotation of 72°
      new Matrix4().makeScale(1, 1, -1) // single reflection to make it a dihedral group
    ],
    vertexNames: [ '1', '', '5', '', '4', '', '3', '', '2' ]
  }),
  hexagon: new SymmetricShape({
    name: "Equilateral hexagon",
    dimensions: 2,
    vertices: generateSkinnyPolygon(6),
    generators: [
      new Matrix4().makeRotationY(Math.PI / 3), // single rotation of 60°
      new Matrix4().makeScale(1, 1, -1) // single reflection to make it a dihedral group
    ],
    vertexNames: [ '1', '', '6', '', '5', '', '4', '', '3', '', '2' ]
  }),
  rectangle: new SymmetricShape({
    name: "Rectangle",
    dimensions: 2,
    vertices: fattenPolygon([[0.9, 0.5], [0.9, -0.5], [-0.9, -0.5], [-0.9, 0.5]].map(([x, y]) => new Vector2(x, y)), 0.1), // axis aligned square
    generators: [
      new Matrix4().makeScale(1, 1, -1),
      new Matrix4().makeScale(-1, 1, 1)
    ],
    vertexNames: [ '4', '', '1', '', '2', '', '3' ]
  }),
  triangularPrism: new SymmetricShape({
    name: "Triangular prism",
    dimensions: 3,
    vertices: fattenPolygon(generateRegularPolygon(3, 0.7), 1.4),
    generators: [
      new Matrix4().makeRotationY(2 * Math.PI / 3), // single rotation of 120°
      new Matrix4().makeScale(1, 1, -1), // dihedral
      new Matrix4().makeScale(1, -1, 1) // prism GANG 银行
    ],
    vertexNames: [ '1\'', '1', '3\'', '3', '2\'', '2' ],
    faceColors: [
      0x0000ff, 0x0000ff, 0x0000ff, // side 1 p 1
      0xff0000, 0xff0000, 0xff0000, // side 2 p 1
      0xdddddd, 0xdddddd, 0xdddddd, // top face
      0x00ff00, 0x00ff00, 0x00ff00, // side 3 p 1
      0x0000ff, 0x0000ff, 0x0000ff, // side 1 p 2
      0x222222, 0x222222, 0x222222, // bottom face
      0x00ff00, 0x00ff00, 0x00ff00, // side 3 p 2
      0xff0000, 0xff0000, 0xff0000, // side 2 p 2
    ]
  }),
  squarePrism: new SymmetricShape({
    name: "Square prism",
    dimensions: 3,
    vertices: fattenPolygon(generateRegularPolygon(4, 0.7, Math.PI / 4), 1.3),
    generators: [
      new Matrix4().makeRotationY(Math.PI / 2), // single rotation of 90°
      new Matrix4().makeScale(1, 1, -1), // dihedral
      new Matrix4().makeScale(1, -1, 1) // prism
    ],
    vertexNames: [ '1\'', '1', '4\'', '4', '3\'', '3', '2\'', '2' ],
    faceColors: [
      0x0000ff, 0x0000ff, 0x0000ff, // side 1 p 1
      0x222222, 0x222222, 0x222222,
      0xff8800, 0xff8800, 0xff8800,
      0xff0000, 0xff0000, 0xff0000,
      0x00ff00, 0x00ff00, 0x00ff00,
      0xdddddd, 0xdddddd, 0xdddddd,
      0xdddddd, 0xdddddd, 0xdddddd,
      0xff8800, 0xff8800, 0xff8800,
      0x0000ff, 0x0000ff, 0x0000ff,
      0x00ff00, 0x00ff00, 0x00ff00,
      0xff0000, 0xff0000, 0xff0000,
      0x222222, 0x222222, 0x222222,
    ]
  }),
  squarePyramid: new SymmetricShape({
    name: "Square pyramid",
    dimensions: 3,
    vertices: [
      [-1, -1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, -1, -1],
      [0, 1, 0]
    ].map(([x, y, z]) => new Vector3(x, y, z).multiplyScalar(0.7)),
    generators: [
      new Matrix4().makeRotationY(Math.PI / 2), // single rotation of 90°
      new Matrix4().makeScale(1, 1, -1) // dihedral
    ],
    vertexNames: [ '2', '3', '4', '1' ],
    faceColors: [
      0xff0000, 0xff0000, 0xff0000,
      0x222222, 0x222222, 0x222222,
      0xff8800, 0xff8800, 0xff8800,
      0xff0000, 0xff0000, 0xff0000,
      0x00ff00, 0x00ff00, 0x00ff00,
      0xdddddd, 0xdddddd, 0xdddddd,
    ]
  }),
  pentagonalPrism: new SymmetricShape({
    name: "Pentagonal prism",
    dimensions: 3,
    vertices: fattenPolygon(generateRegularPolygon(5, 0.7), 1.3),
    generators: [
      new Matrix4().makeRotationY(2 * Math.PI / 5), // single rotation of 72°
      new Matrix4().makeScale(1, 1, -1), // dihedral
      new Matrix4().makeScale(1, -1, 1) // prism
    ],
    vertexNames: [ '1\'', '1', '5\'', '5', '4\'', '4', '3\'', '3', '2\'', '2' ],
    faceColors: [
      0x0000ff, 0x0000ff, 0x0000ff,
      0xff8800, 0xff8800, 0xff8800,
      0x222222, 0x222222, 0x222222,
      0xff8800, 0xff8800, 0xff8800,
      0xdddddd, 0xdddddd, 0xdddddd,
      0x00ffff, 0x00ffff, 0x00ffff,
      0x222222, 0x222222, 0x222222,
      0xdddddd, 0xdddddd, 0xdddddd,
      0x0000ff, 0x0000ff, 0x0000ff,
      0xff0000, 0xff0000, 0xff0000,
      0x00ff00, 0x00ff00, 0x00ff00,
      0x222222, 0x222222, 0x222222,
      0x00ffff, 0x00ffff, 0x00ffff,
      0xdddddd, 0xdddddd, 0xdddddd,
      0xff0000, 0xff0000, 0xff0000,
      0x00ff00, 0x00ff00, 0x00ff00
    ]
  }),
  tetrahedron: new SymmetricShape({
    name: "Regular tetrahedron",
    dimensions: 3,
    vertices: [
      [1, 0, -Math.SQRT1_2], [-1, 0, -Math.SQRT1_2],
      [0, 1, Math.SQRT1_2], [0, -1, Math.SQRT1_2]
    ].map(([x, y, z]) => new Vector3(x, y, z).multiplyScalar(0.7)),
    generators: [
      new Matrix4().makeRotationZ(Math.PI),
      new Matrix4().makeScale(1, -1, 1),
      new Matrix4().setRotationFromQuaternion(new Quaternion().setFromAxisAngle(new Vector3(1, 0, -Math.SQRT1_2).normalize(), 2 * Math.PI / 3))
    ],
    vertexNames: [ '1', '2', '3', '4' ],
    faceColors: [
      0x0000ff, 0x0000ff, 0x0000ff,
      0xff8800, 0xff8800, 0xff8800,
      0x222222, 0x222222, 0x222222,
      0x00ff00, 0x00ff00, 0x00ff00
    ]
  }),
  cube: new SymmetricShape({
    name: "Cube",
    dimensions: 3,
    vertices: fattenPolygon(generateRegularPolygon(4, Math.sqrt(2) / 2, Math.PI / 4), 1), // close enough
    generators: [
      new Matrix4().makeRotationX(Math.PI / 2), // three rotations
      new Matrix4().makeRotationY(Math.PI / 2),
      new Matrix4().makeRotationZ(Math.PI / 2),
      new Matrix4().makeScale(1, -1, 1) // reflection
    ],
    geometry: new BoxBufferGeometry(1, 1, 1),
    // Face colors/attributes, vertex labels
    faceColors: [
      0xffffff, 0xffffff, 0xffffff, 0xffffff, // Rubik's cube
      0xffff00, 0xffff00, 0xffff00, 0xffff00,
      0xff8800, 0xff8800, 0xff8800, 0xff8800,
      0xff0000, 0xff0000, 0xff0000, 0xff0000,
      0x00ff00, 0x00ff00, 0x00ff00, 0x00ff00,
      0x0000ff, 0x0000ff, 0x0000ff, 0x0000ff
    ],
    vertexNames: [
      '3', '2', '4', '1', "2'", "3'", "1'", "4'"
    ]
  }),
  icosahedron: new SymmetricShape({
    name: "ICOSAHEDRON",
    dimensions: 3,
    vertices: [
      [0, 1, gr], [0, 1, -gr], [1, gr, 0], [0, -1, -gr], [0, -1, gr],
      [1, -gr, 0], [-1, -gr, 0], [-1, gr, 0],
      [gr, 0, 1], [-gr, 0, 1], [-gr, 0, -1], [gr, 0, -1]
    ].map(([x, y, z]) => new Vector3(x, y, z).multiplyScalar(0.4)),
    generators: [
      new Matrix4().makeScale(1, 1, -1),
      new Matrix4().makeScale(-1, 1, 1),
      new Matrix4()
        .setRotationFromQuaternion(new Quaternion()
          .setFromAxisAngle(new Vector3(gr, 0, 1).normalize(), 2 * Math.PI / 5))
    ],
    vertexNames: [...new Array(12).keys()].map(s => (s + 1) + '')
  })
}

Object.assign(window, { SHAPES, explainMatrix })
