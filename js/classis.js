
const OBJECT_META = Symbol('_object')
const ASYNC = Symbol('async')

const assert = console.assert

export function make_class (name, fs, api) {
  let ms = {}
  for (let f in fs) {
    let m = fs[f].bind(ms)
    ms[f] = m
  }
  ms = Object.seal(ms)

  return Object.seal({
    static: ms,
    new (state) {
      return new_object(state, ms, api, name)
    }
  })
}

function serialise (o) {
  if (o === null) {
    return null
  }

  let t = typeof o
  if (t !== 'object' && t !== 'function') {
    return o
  }

  if (o.nodeType > 0) {
    return null
  }

  let j = {}
  if (o[OBJECT_META]) {
    j._type = o[OBJECT_META].type
  }
  if (o.serialise) {
    o = o.serialise()
  }
  for (let f in o) {
    j[f] = serialise(o[f])
  }
  return j
}

function new_object (state, ms, api, type) {
  let o = {}

  for (let m in api) {
    let def = api[m]
    if (def['async']) {
      let inner = ms[m].bind(ms, state)
      let chan_name = def['async']
      let a = function (...args) {
        let ret_chan = make_chan(1)
        let chan = state[chan_name]
        chan.send({
          method: m,
          args: args,
          ret: ret_chan,
        })
        return ret_chan
      }
      a[ASYNC] = true
      o[m] = a
    } else if (def['get']) {
      let field = def['get']
      let a = function () {
        return state[field]
      }
      o[m] = a
    } else {
      let a = ms[m].bind(ms, state)
      o[m] = a
    }
  }

  state[OBJECT_META] = { type }

  if (!o['serialise']) {
    o['serialise'] = function () {
      return state
    }
  }

  if (!o['toJSON']) {
    o['toJSON'] = function () {
      return JSON.stringify(serialise(this))
    }.bind(o)
  }

  return Object.seal(o)
}

function send (state, msg) {
  if (state.cap === 0) {
    // direct handoff only
    let hook = state.hook
    if (!hook) {
      // if (!msg._p) {
      //   console.log('nothing waits for', msg)
      // }
      return false
    }
    state.hook = null
    // XXX - is it always okay to run the hook within send?
    run_hook(hook, msg)
  }
  if (state.array.length === state.cap) {
    return false
  }
  state.array.push(msg)
  maybe_hook(state)
  return true
}

function hook (state, func, args) {
  state.hook = {
    func, args
  }
  maybe_hook(state)
}

function unhook (state, func, args) {
  state.hook = null
}

function maybe_hook (state) {
  setTimeout(function () {
    let hook = state.hook
    if (!hook) {
      return
    }
    let msg = state.array.shift()
    if (!msg) {
      return
    }
    state.hook = null
    run_hook(hook, msg)
  }, 0)
}

function run_hook (hook, msg) {
  try {
    hook.func(msg, ...hook.args)
  } catch (e) {
    console.log('hook error', e)
    return
  }
}

let chan_count = 0

export function make_channel (cap) {
  let id = 'chan_' + chan_count++

  let state = {
    id: id,
    cap: cap === undefined ? 10000 : cap,
    array: [],
    hook: null
  }

  return {
    send: (msg) => send(state, msg),
    hook: (func, args) => hook(state, func, args),
    unhook: (func, args) => unhook(state, func, args),
    drain: () => {
      let out = state.array
      state.array = []
      return out
    },
    toString: () => id,
  }
}

function process_proc_yield (frame, y) {
  if (y.done) {
    for (let d of frame.defer) {
      try {
        d()
      } catch (e) {
        console.log('defer error', e, frame)
      }
    }

    let parent = frame.parent
    if (!parent) {
      return
    }

    iterate_proc(parent, y.value)
  } else if (Array.isArray(y.value)) {
    let chans = y.value
    let fired = false

    let cb = function (msg, chan) {
      assert(!fired)
      fired = true

      for (let chan of chans) {
        chan.unhook(cb, [chan])
      }

      iterate_proc(frame, [chan, msg])
    }

    for (let chan of chans) {
      chan.hook(cb, [chan])
    }
  } else {
    try {
      run_proc(y.value, frame)
    } catch (e) {
      console.log('yield error', e)
    }
  }
}

function iterate_proc(frame, value) {
  setTimeout(function () {
    let y = null
    try {
      y = frame.gen.next(value)
    } catch (e) {
      console.log('proc error', e, frame)
      return
    }
    process_proc_yield(frame, y)
  }, 0)
}

export function run_proc (p, parent) {
  let frame = {
    gen: null,
    defer: [],
    parent: parent,
  }

  if (p.next) {
    frame.gen = p
  } else if (typeof p === 'function') {
    let ctx = {}
    ctx.wait = (chans) => chans
    ctx.run = (proc) => proc
    ctx.defer = (f) => {
      frame.defer.push(f)
    }
    frame.gen = p(ctx)
  } else {
    throw new Error('unknown proc type')
  }

  iterate_proc(frame, null)
}
