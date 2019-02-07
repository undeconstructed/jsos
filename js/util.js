
export const assert = (console ? console.assert : function () {})

export function split(s) {
  s = s.trim().split(/\s+/).join(' ')
  let i = s.indexOf(' ')
  if (i > 0) {
    return [s.substr(0, i), s.substr(i + 1)]
  }
  return [s, null]
}

export function join (a, s, f) {
  f = f || (e => e.toString())
  s = s || ','
  let size = a.length || a.size
  if (size == 0) {
    return ''
  } else if (size == 1) {
    let i = a[Symbol.iterator]()
    return f(i.next().value)
  } else {
    let i = a[Symbol.iterator]()
    let out = f(i.next().value)
    for (let e = i.next(); !e.done; e = i.next()) {
      out += s + f(e.value)
    }
    return out
  }
}

export function distance (p1, p2) {
  let dx = p1.x - p2.x
  let dy = p1.y - p2.y
  return Math.sqrt(dx*dx + dy*dy)
}

export function toRadians (degrees) {
  return (degrees - 90) / 180 * Math.PI
}

// frontend

export function mkel(tag, opts) {
  opts = opts || {}
  let e = document.createElement(tag)
  if (opts.classes) {
    e.classList.add(...opts.classes)
  }
  if (opts.style) {
    e.style = opts.style
  }
  if (opts.text) {
    e.textContent = opts.text
  }
  return e
}
