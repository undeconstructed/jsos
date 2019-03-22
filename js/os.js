
import { assert, IdMap } from './util.js'

let disk = {
  // pretend drivers
  'drv1': {
    main (sys) {
      sys.debug('drv1 main')
    }
  },
  'drv2': {
    main (sys) {
      sys.debug('drv2 main')
    }
  },
   // init app, and master of all other processes
  'init': {
    main (sys) {
      sys.debug('init main')
    }
  },
  // fs server
  'fs': {
    main (sys) {
      sys.debug('fs main')
    }
  },
  // display server
  'display': {
    main (sys) {
      sys.debug('display main')
    }
  },
  // graphical shell app
  'gshell': {
    main (sys) {
      sys.debug('gshell main')
    }
  }
}

// the os kernel.
export default class OS {
  constructor (config) {
    this.config = config
    this.disk = disk
  }
  boot () {
    this.time = 0
    this.process0 = this.createProcess0()
    this.process0.start()
    // tick
    window.setTimeout(() => this.tick(), 0)
  }
  createProcess0 () {
    // process0 code is embedded in kernel
    let p = new Process(null, {
      main (sys) {
        sys.debug('0 main')
        sys.call('spawn', ['drv1'])
        sys.call('spawn', ['drv2'])
        sys.call('spawn', ['fs'])
        sys.call('spawn', ['init'])
      }
    })
    p.id = 0
    return p
  }
  tick () {
    this.time++

    let res = this.process0.tick(this)

    for (let call of res.calls) {
      switch (call.name) {
      default:
        console.log('unmet syscall', call)
      }
    }

    window.setTimeout(() => this.tick(), 100)
  }
}

// fully isolated world in which work can be done
class Process {
  constructor (parent, binary) {
    this.parent = parent
    this.binary = binary
    // state
    this.queue = []
    this.states = new IdMap()
    // children
    this.children = new IdMap()
  }
  start () {
    let sid = this.states.add(new State())
    this.enqueue('main', sid)
  }
  spawn (binary) {
    // cheat straight to disk
    let bin = disk[binary]
    let p = new Process(this, bin)
    this.children.add(p)
    p.start()
  }
  enqueue (entry, state) {
    this.queue.push(new Task(entry, state))
  }
  tick (ctx) {
    let calls = []
    for (let c of this.children.values()) {
      let res = c.tick(this)
      for (let call of res.calls) {
        call.process = c
        if (!this._syscall(call)) {
          calls.push(call)
        }
      }
    }

    if (this.queue.length > 0) {
      let t = this.queue.shift()
      let res = this.invoke(t)

      if (this.parent === null) {
        // only process 0 is allowed to work on its own syscalls
        for (let call of res.calls) {
          call.process = this
          if (!this._syscall(call)) {
            calls.push(call)
          }
        }
      } else {
        for (let call of res.calls) {
          call.process = this
          calls.push(call)
        }
      }
    }

    return { calls }
  }
  invoke (task) {
    let s = this.states.get(task.state)
    let calls = []
    let c = {
      mem: s,
      debug: console.log,
      call: (name, args) => {
        calls.push({ name, args })
      }
    }
    let e = this.binary[task.entry]
    try {
      // this is user space
      e(c)
    } catch (e) {
      console.log('userspace error', e)
    }
    return { calls }
  }
  _syscall (call) {
    switch (call.name) {
    case 'spawn':
      this._spawn(call.process, call.args)
      return true
    default:
      return false
    }
  }
  _spawn (parent, args) {
    let [binary] = args
    parent.spawn(binary)
  }
}

// local memory, to be accessed by at most one thing at a time
class State {
  constructor () {
    this.data = new Map()
    this.owner = null
  }
}

// goes into the queue
class Task {
  constructor (entry, state) {
    this.entry = entry
    this.state = state
  }
}

