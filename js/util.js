
// safe assert call
export const assert = (console ? console.assert : function () {})

// map that assigns increasing integers as ids, and write them into its values
export class IdMap {
  constructor () {
    this.map = new Map()
    this.count = 0
  }
  add (e) {
    e.id = this.count++
    this.map.set(e.id, e)
    return e.id
  }
  get (id) {
    return this.map.get(id)
  }
  delete (id) {
    this.map.delete(id)
  }
  entries () {
    return this.map.entries()
  }
  values () {
    return this.map.values()
  }
}

// helper for making HTML elements
export function mkel(tag, opts) {
  opts = opts || {}
  let e = document.createElement(tag)
  for (let opt in opts) {
    switch (opt) {
      case 'classes':
        e.classList.add(...opts.classes)
        break
      case 'text':
        e.textContent = opts.text
        break
      default:
        e[opt] = opts[opt]
    }
  }
  return e
}

export function defer (delay, func, args) {
  return setTimeout(function () {
    return func(...args)
  })
}

export function hook (src, event, options, func, args) {
  return src.addEventListener(event, function (e) {
    return func(e, ...args)
  }, options)
}

export function animate (func, args) {
  window.requestAnimationFrame(function() {
    func(...args)
  })
}

export function select (parent, selector) {
  return parent.querySelector(selector)
}

export function main (func) {
  document.addEventListener('DOMContentLoaded', function() {
    func({
      window,
      document,
      localStorage
    })
  })
}
