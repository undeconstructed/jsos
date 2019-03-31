
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
    let channel0 = new Channel()
    let pod0 = new Pod(this, null, channel0.end, {
      main (sys) {
        sys.debug('0 main')

        let registry = new Map()
        sys.write('registry', registry)

        sys.write('semaphore', 3)
        sys.call('spawn', 'cb', null, null, ['drv1'])
        sys.call('spawn', 'cb', null, null, ['drv2'])
        sys.call('spawn', 'cb', null, null, ['fs'])
      },
      receive (sys) {
        sys.debug('0 receive')
      },
      cb (sys) {
        let semaphore = sys.read('semaphore')
        semaphore--
        sys.debug('0 cb ' + semaphore)
        sys.write('semaphore', semaphore)

        if (semaphore === 0) {
          sys.debug('spawning init')
          sys.call('spawn', 'cb', null, null, ['init'])
        }
      }
    })
    pod0.id = 0
    return pod0
  }
  tick () {
    this.time++

    let res = this.pod0.tick(this)

    for (let call of res.calls) {
      console.log('unmet syscall', call)
    }

    window.setTimeout(() => this.tick(), 100)
  }
  debug (args) {
    this.bios.writeToConsole(`\n${this.time} ${args}`)
  }
}

// fully isolated world in which work can be done
class Pod {
  constructor (os, parent, channel0, binary) {
    this.os = os
    this.parent = parent
    this.binary = binary
    // queue
    this.queue = []
    // states
    this.states = new IdMap()
    let state0 = new State()
    this.states.add(state0)
    // channels
    this.channels = new IdMap()
    // endpoints
    this.endpoints = new IdMap()
    this.endpoints.add(channel0)
    // children
    this.children = new IdMap()
  }
  start () {
    this.enqueue('main', 0)
  }
  enqueue (entry, state) {
    this.queue.push(new Task(entry, state))
  }
  tick (ctx) {
    for (let c of this.children.values()) {
      let res = c.tick(this)
      // TODO - pass these up?
      for (let call of res.calls) {
        console.log('unhandled', call)
      }
    }

    for (let channel of this.endpoints.values()) {
      let rcv = channel.read()
      if (rcv) {
        // TODO - which state?
        this.queue.push(new Task('receive', 0))
      }
    }

    let res = { calls: [] }

    while (this.queue.length > 0) {
      // TODO - stop after time used up

      let t = this.queue.shift()
      let res2 = this.invoke(t)

      res.calls = res.calls.concat(this.doSyscalls(res2.calls))
    }

    return res
  }
  invoke (task) {
    let os = this.os
    let state = this.states.get(task.state)
    let calls = []

    let c = {
      debug (...args) {
        os.debug(args)
        console.log(...args)
      },
      state () {
        return task.state
      },
      read (addr) {
        return JSON.parse(state.data.get(addr))
      },
      write (addr, data) {
        state.data.set(addr, JSON.stringify(data))
      },
      call: (name, reentry, state, tag, args) => {
        calls.push([name, reentry, task.state, tag, JSON.stringify(args)])
      }
    }

    let entry = this.binary[task.entry]
    try {
      // this is user space
      entry.call(null, c)
    } catch (e) {
      console.log('userspace error', e)
    }

    calls = calls.map(e => ({ pod: this, call: e[0], reentry: e[1], state: e[2], tag: e[3], args: e[4] }))

    return { state, calls }
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
          this.enqueue(call.reentry, call.state)
        }
      } else {
        unhandled.push(call)
      }
    }
    return unhandled
  }
  doSyscall (call) {
    switch (call.call) {
    case 'alloc':
      return this._alloc(call.pod, call.args)
    case 'spawn':
      return this._spawn(call.pod, call.args)
    case 'connect':
      return this._connect(call.pod, call.args)
    case 'send':
      return this._send(call.pod, call.args)
    default:
      return null
    }
  }
  _alloc (pod, args) {
    let state = new State()
    pod.states
  }
  _spawn (pod, args) {
    // starts a new process, as a child of this one
    let [binary] = args

    // cheat straight to disk
    let binx = this.os.bios.readDisk(binary)
    let bin = {}
    for (let prop in binx) {
      bin[prop] = binx[prop]
    }

    let channel0 = new Channel()
    this.endpoints.add(channel0.start)

    let p = new Pod(this.os, this, channel0.end, bin)

    this.children.add(p)
    p.start()
    return p.id
  }
  _connect (pod, args) {
    // connects two pods, both of which are children of this one
    let [srcId, name] = args

    let src = pod.children.get(srcId)
    let tgt = pod.names.get(name)

    let chn = new Channel(pod)
    pod.channels.add(chn)
    src.endpoints.add(chn.start)
    // TODO - some sort of handshake
    tgt.endpoints.add(chn.end)

    return chn.start.id
  }
  _send (pod, args) {
    let [chnId, data] = args
    let chn = pod.endpoints.get(chnId)
    chn.write(data)
    return true
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
  constructor (owner) {
    this.start = new ChannelEnd(this)
    this.end = new ChannelEnd(this)
  }
}

class ChannelEnd {
  constructor (channel) {
    this.channel = channel
    this.up = []
  }
  write (data) {
    this.up.push(data)
  }
  read () {
    if (this === this.channel.start) {
      return this.channel.end.up.shift()
    } else {
      return this.channel.start.up.shift()
    }
  }
}

// goes into the queue
class Task {
  constructor (entry, state) {
    this.entry = entry
    this.state = state
  }
}
