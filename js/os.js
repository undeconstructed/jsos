
import { assert, IdMap } from './util.js'

// the os kernel.
export default class OS {
  constructor (bios) {
    this.bios = bios
  }
  boot () {
    // use bios to be able to do basic things during boot
    this.bios.initConsole()
    this.bios.initKeyboard()

    // set up internal state of kernel
    this.time = 0
    this.pod0 = this.createPod0()
    this.pod0.start()

    // info
    this.bios.writeToConsole('booting')

    // clear stack and tick
    window.setTimeout(() => this.tick(), 0)
  }
  createPod0 () {
    // pod0 code is embedded in kernel
    let channel0 = new Channel()
    let pod0 = new Pod(this, null, channel0.end, {
      main (sys) {
        // start of first userspace code
        sys.debug('0 main')

        // this registry enables connection to drivers
        let registry = new Map()
        sys.write('registry', registry)

        // start up system level processes
        sys.write('semaphore', 3)
        sys.call('spawn', 'cb', null, null, ['drv1'])
        sys.call('spawn', 'cb', null, null, ['drv2'])
        sys.call('spawn', 'cb', null, null, ['fs'])
      },
      cb (sys) {
        // lazy single callback for all earlier spawns
        let semaphore = sys.read('semaphore')
        semaphore--
        sys.debug('0 cb ' + semaphore)
        sys.write('semaphore', semaphore)

        if (semaphore === 0) {
          // start user processes, via init
          sys.debug('spawning init')
          sys.call('spawn', 'cb', null, null, ['init'])
        }
      },
      receive (sys) {
        // message received from child pod
        sys.debug('0 receive')
      }
    })
    pod0.id = 0
    return pod0
  }
  tick () {
    // nominal time for sim
    this.time++

    // tick the whole OS by recursing down the process tree
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
    // channels owned by this pod, i.e. connecting its children
    this.channels = new IdMap()
    // channel endpoints
    this.endpoints = new IdMap()
    this.endpoints.add(channel0)
    // child pods
    this.children = new IdMap()
  }
  start () {
    this.enqueue('main', 0)
  }
  enqueue (entry, state) {
    this.queue.push(new Task(entry, state))
  }
  tick (ctx) {
    // tick all children
    for (let c of this.children.values()) {
      let res = c.tick(this)
      // TODO - pass these up?
      for (let call of res.calls) {
        console.log('unhandled', call)
      }
    }

    // look for incoming messages that need processing
    for (let channel of this.endpoints.values()) {
      let rcv = channel.read()
      if (rcv) {
        // TODO - which state?
        this.queue.push(new Task('receive', 0))
      }
    }

    let res = { calls: [] }

    // run through task queue
    while (this.queue.length > 0) {
      // TODO - stop after time used up

      let t = this.queue.shift()
      let res2 = this.invoke(t)

      res.calls = res.calls.concat(this.doSyscalls(res2.calls))
    }

    return res
  }
  invoke (task) {
    // run a task, i.e. execute an entry point with a state
    let os = this.os
    let state = this.states.get(task.state)
    // to collect system calls
    let calls = []

    // context object represents interface to machine and OS.
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

    // initial work on syscalls, represents moving data into kernel space
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
    // allocate a new state object
    let state = new State()
    pod.states.add(state)
    return state.id
  }
  _spawn (pod, args) {
    // create and start a new pod, as a child of this one
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
    // connect two pods, both of which are children of this one
    let [srcId, name] = args

    // TODO - handle deeper children
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
    // send data into a channel
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

// one end of a channel
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
