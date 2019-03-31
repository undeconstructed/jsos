
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
