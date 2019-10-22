
export default function jsc (src) {
  let bin = {}

  for (let prop in src) {
    if (prop.startsWith('*')) {
      bin[prop] = p(src[prop])
    } else {
      bin[prop] = src[prop]
    }
  }

  return bin
}

function p (fs) {
  return (sys) => {
    let r = sys.read('_').data
    let f = fs[r[0]]
    if (f) {
      f(sys, r.slice(1))
    }
  }
}
