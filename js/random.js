
export function pick (a) {
  return a[Math.floor(Math.random() * a.length)]
}

export function int (min, max) {
  return min + Math.floor(Math.random() * (max - min))
}

export function id () {
  return (Math.random() + 1).toString(36).substr(2,5)
}
