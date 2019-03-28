
import { assert, IdMap } from './util.js'

// the os kernel.
export default class OS {
  constructor (bios) {
    this.bios = bios
  }
  boot () {
    this.bios.initConsole()
    this.bios.initKeyboard()

    this.time = 0
    this.pod0 = this.createPod0()
    this.pod0.start()
    this.bios.writeToConsole('booting')

    // tick
    window.setTimeout(() => this.tick(), 0)
  }
  createPod0 () {
    // pod0 code is embedded in kernel
    let p = new Pod(this, null, {
      main (sys) {
        sys.debug('0 main')
        sys.write('semaphore', 3)
        sys.call('spawn', 'cb', null, ['drv1'])
        sys.call('spawn', 'cb', null, ['drv2'])
        sys.call('spawn', 'cb', null, ['fs'])
      },
      cb (sys) {
        let semaphore = sys.read('semaphore')
        semaphore--
        sys.debug('0 cb ' + semaphore)
        sys.write('semaphore', semaphore)
        if (semaphore === 0) {
          sys.debug('spawning init')
          sys.call('spawn', 'cb', null, ['init'])
        }
      }
    })
    p.id = 0
    return p
  }
  tick () {
    this.time++

    let res = this.pod0.tick(this)

    for (let call of res.calls) {
      switch (call.name) {
      default:
        console.log('unmet syscall', call)
      }
    }

    window.setTimeout(() => this.tick(), 100)
  }
  debug (args) {
    this.bios.writeToConsole(`\n${this.time} ${args}`)
  }
}

// fully isolated world in which work can be done
class Pod {
  constructor (os, parent, binary) {
    this.os = os
    this.parent = parent
    this.binary = binary
    // state
    this.channel = new Channel()
    this.names = new Map()
    this.queue = []
    this.states = new IdMap()
    this.channels = new IdMap()
    // children
    this.children = new IdMap()
  }
  start () {
    let sid = this.states.add(new State())
    this.enqueue('main', sid)
  }
  enqueue (entry, state) {
    this.queue.push(new Task(entry, state))
  }
  tick (ctx) {
    for (let channel of this.channels.values()) {
    }

    for (let c of this.children.values()) {
      let res = c.tick(this)
      this.doSends(res.sends)
      // TODO - pass these up?
      for (let call of res.calls) {
        console.log('unhandled', call)
      }
    }

    let res = { sends: [], calls: [] }

    while (this.queue.length > 0) {
      // TODO - stop after time used up

      let t = this.queue.shift()
      let res2 = this.invoke(t)

      res.calls = res.calls.concat(this.doSyscalls(res2.calls))
      res.sends = res.sends.concat(res2.sends)
    }

    return res
  }
  invoke (task) {
    let os = this.os
    let state = this.states.get(task.state)
    let calls = []
    let sends = []

    let c = {
      debug (...args) {
        os.debug(args)
        console.log(...args)
      },
      read (addr) {
        return JSON.parse(state.data.get(addr))
      },
      write (addr, data) {
        state.data.set(addr, JSON.stringify(data))
      },
      call: (name, reentry, tag, args) => {
        calls.push([name, reentry, tag, JSON.stringify(args)])
      },
      send: (chn, data) => {
        sends.push([chn, JSON.stringify(data)])
      }
    }

    let entry = this.binary[task.entry]
    try {
      // this is user space
      entry.call(null, c)
    } catch (e) {
      console.log('userspace error', e)
    }

    calls = calls.map(e => ({ pod: this, state: state, call: e[0], reentry: e[1], tag: e[2], args: e[3] }))
    sends = sends.map(e => ({ pod: this, channel: e[0], data: e[1] }))

    return { state, calls, sends }
  }
  doSyscalls (calls) {
    let unhandled = []
    for (let call of calls) {
      call.pod = this
      call.args = JSON.parse(call.args)
      let ret = this.doSyscall(call)
      if (ret !== null) {
        if (call.tag) {
          call.state.data.set(call.tag, ret)
        }
        if (call.reentry) {
          this.enqueue(call.reentry, call.state.id)
        }
      } else {
        unhandled.push(call)
      }
    }
    return unhandled
  }
  doSyscall (call) {
    switch (call.call) {
    case 'spawn':
      return this._spawn(call.pod, call.args)
    case 'register':
      return this._register(call.pod, call.args)
    case 'connect':
      return this._connect(call.pod, call.args)
    default:
      return null
    }
  }
  _spawn (pod, args) {
    let [binary] = args

    // cheat straight to disk
    let binx = this.os.bios.readDisk(binary)
    let bin = {}
    for (let prop in binx) {
      bin[prop] = binx[prop]
    }

    let p = new Pod(this.os, this, bin)
    this.children.add(p)
    p.start()
    return p.id
  }
  _register (pod, args) {
    let [name] = args
    pod.parent.names.set(name, pod)
    return name
  }
  _connect (pod, args) {
    let [name] = args
    let tgt = pod.parent.names.get(name)
    let chn = new Channel()
    this.channels.add(chn)
    return chn.id
  }
  doSends (sends) {
    for (let send of sends) {
      let tgt = this.channels.get(send.channel)
      // this.os.debug('send', send)
    }
  }
}

// local memory, to be accessed by at most one task at a time
class State {
  constructor () {
    this.data = new Map()
    this.owner = null
  }
}

// connects pods
class Channel {
  constructor (start, end) {
    this.start = start
    this.end = end
    this.up = []
    this.down = []
  }
}

// goes into the queue
class Task {
  constructor (entry, state) {
    this.entry = entry
    this.state = state
  }
}

