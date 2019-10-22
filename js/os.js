
import { make_class } from './classis.js'

import { assert, defer, IdMap } from './util.js'

const Pod = make_class('pod', {
}, {
})

// the os kernel.
const OS = make_class('os', {
  boot (state) {
    // use bios to be able to do basic things during boot
    state.bios.initConsole()
    state.bios.initKeyboard()

    // set up internal state of kernel
    state.time = 0
    state.pod0 = this.createPod0()

    // info
    state.bios.writeToConsole('booting')

    // make something happens
    this.startPod(state.pod0)

    // clear stack and tick
    defer(0, this.tick, [state])
  },

  createPod0 () {
    // pod0 code is embedded in kernel
    let channel0 = this.newChannel(null)
    let pod0 = this.newPod(null, channel0.end, pod0bin)
    pod0.id = 0
    return pod0
  },

  debug (state, text) {
    state.bios.writeToConsole(`\n${state.time} ${text}`)
  },

  newPod (parent, channel0, binary) {
    // queue
    let queue = []
    // states
    let states = new IdMap()
    // channels owned by this pod, i.e. connecting its children
    let channels = new IdMap()
    // channel endpoints
    let endpoints = new IdMap()
    endpoints.add(channel0)
    // child pods
    let children = new Map()

    let pod = {
      parent,
      binary,
      queue,
      states,
      channels,
      endpoints,
      children
    }

    return pod
  },

  podId (pod, parent) {
    return Array.reverse([...(function*() {
      while (pod !== parent) {
        yield pod.id
        pod = pod.parent
      }
    })()]).join('.')
  },

  startPod (pod) {
    // allocate a state0
    let state0 = this.newState(pod)
    pod.states.add(state0)

    // set up channel0 receiver
    let channel0 = pod.endpoints.get(0)
    channel0.rx = { entryName: 'main', stateId: 0 }

    // ensure start
    channel0.down.push(['start', []])
  },

  newState (pod) {
    let data = new Map()

    let state = {
      data: data,
      owner: null,
      write (addr, data) {
        assert(typeof data === 'string')
        return this.data.set(addr, data)
      },
      read (addr) {
        return this.data.get(addr)
      }
    }

    return state
  },

  newTask (pod, entryName, stateId) {
    let entry = pod.binary[entryName]
    if (!entry) {
      return 'noentry'
    }
    let state = pod.states.get(stateId)
    if (!state) {
      return 'nostate'
    }
    if (state.owner) {
      return 'conflict'
    }
    let task = { entry, state }
    state.owner = task
    return task
  },

  enqueue (pod, entryName, stateId) {
    let task = this.newTask(pod, entryName, stateId)
    pod.queue.push(task)
    return null
  },

  newChannel (pod) {
    let atob = []
    let btoa = []

    let start = this.newEndpoint(atob, btoa)
    let end = this.newEndpoint(btoa, atob)

    return { start, end }
  },

  newEndpoint (up, down) {
    let endpoint = {
      owned: null,
      up: up,
      down: down
    }
    return endpoint
  },

  findChild (pod, path) {
    let child = pod
    for (let n of path) {
      child = child.children.get(n)
      if (!child) {
        return null
      }
    }
    return child
  },

  connect (pod, src, tgt) {
    let chn = this.newChannel(pod)
    pod.channels.add(chn)

    src.endpoints.add(chn.start)
    tgt.endpoints.add(chn.end)

    return chn
  },

  tick (state) {
    // nominal time for sim
    state.time++

    // tick the whole OS by recursing down the process tree
    try {
      let res = this.tickPod(state, state.pod0)
      // TODO - see what happened?
    } catch (e) {
      console.log('os error', e)
    }

    defer(100, this.tick, [state])
  },

  tickPod (s, pod) {
    // tick all children
    for (let c of pod.children.values()) {
      let res = this.tickPod(s, c)
      // TODO - check what happened?
    }

    // look for incoming messages that need processing
    for (let channel of pod.endpoints.values()) {
      if (channel.rx) {
        // if set to receive
        let state = pod.states.get(channel.rx.stateId)
        if (state.owner) {
          continue
        }
        // and state is unlocked
        let rcv = channel.down.shift()
        if (rcv) {
          // and data is available
          // then store data in state
          state.write('_', JSON.stringify({
            channelId: channel.id,
            data: rcv
          }))
          // and schedule execution
          this.enqueue(pod, channel.rx.entryName, channel.rx.stateId)
        }
      }
    }

    let res = { }

    // run through task queue
    while (pod.queue.length > 0) {
      // TODO - stop after time used up

      let task = pod.queue.shift()
      let res2 = this.invoke(s, pod, task)

      this.doSyscalls(s, pod, res2.calls)
    }

    return res
  },

  invoke (s, pod, task) {
    // run a task, i.e. execute an entry point with a state
    let os = this
    let id = this.podId(pod, null)
    let state = task.state
    let entry = task.entry

    // context object represents interface to machine and OS.
    let c = {
      debug (...args) {
        os.debug(s, id + ' ' + args.join(' '))
        console.log('dbg', id, args)
      },
      state () {
        return task.state.id
      },
      read (addr) {
        let d = state.read(addr)
        return !d ? null : JSON.parse(d)
      },
      write (addr, data) {
        state.write(addr, JSON.stringify(data))
      },
      call (name, reentry, stateId, args) {
        if (stateId === null) {
          stateId = state.id
        }
        // let args1 = JSON.stringify(args)
        let calls = this.read('_calls')
        calls.push([name, reentry, stateId, args])
        this.write('_calls', calls)
      }
    }

    let calls = []
    try {
      // initialise space for syscalls
      c.write('_calls', [])
      // this is user space
      entry.call(null, c)
      // move syscalls into kernel space
      calls = c.read('_calls').map(e => ({ call: e[0], reentry: e[1], stateId: e[2], args: e[3] }))
    } catch (e) {
      os.debug(s, id + ' ' + e)
      console.log('userspace error', id, e)
    }
    state.owner = null

    return { state, calls }
  },

  doSyscalls (s, pod, calls) {
    for (let call of calls) {
      let err = this.doSyscall(s, pod, call)
      if (err) {
        this.debug(s, 'syscall error: ' + err)
      }
    }
  },

  doSyscall (s, pod, call) {
    let state = pod.states.get(call.stateId)
    if (!state) {
      return 'nostate'
    }
    let entry = pod.binary[call.reentry]
    if (!entry) {
      return 'noentry'
    }
    if (state.owner) {
      return 'conflict'
    }

    let res = this.syscall(s, pod, call.call, call.args)
    state.write('_', JSON.stringify(res))
    this.enqueue(pod, call.reentry, call.stateId)

    return null
  },

  syscall (s, pod, call, args) {
    switch (call) {
    case 'sched':
      return this._sched(pod, args)
    case 'alloc':
      return this._alloc(pod, args)
    case 'delete':
      return this._delete(pod, args)
    case 'spawn':
      return this._spawn(s, pod, args)
    case 'connect':
      return this._connect(pod, args)
    case 'send':
      return this._send(pod, args)
    case 'receive':
      return this._receive(pod, args)
    case 'close':
      return this._close(pod, args)
    default:
      return 'nocall'
    }
  },

  _sched (pod, args) {
    return true
  },

  _alloc (pod, args) {
    // allocate a new state object
    let state = this.newState(pod)
    pod.states.add(state)
    return state.id
  },

  _delete (pod, args) {
    // removes an allocation
    let [stateId] = args
    let state = pod.states.get(stateId)
    if (!state) {
      return 'nostate'
    }
    if (state.owner) {
      return 'conflict'
    }
    pod.states.delete(stateId)
    return true
  },

  _spawn (state, pod, args) {
    // create and start a new pod, as a child of this one
    let [binary] = args

    // cheat straight to disk
    let binx = state.bios.readDisk(binary)
    let bin = {}
    for (let prop in binx) {
      bin[prop] = binx[prop]
    }

    // TODO - link in sys library

    let channel0 = this.newChannel(pod)
    pod.endpoints.add(channel0.start)

    let p = this.newPod(pod, channel0.end, bin)
    // process id is the same as the channel to it
    p.id = channel0.start.id

    pod.children.set(p.id, p)
    this.startPod(p)

    channel0.start.owner = p.id

    return channel0.start.id
  },

  _connect (pod, args) {
    // connect two pods, both of which are children of this one
    let [srcPath, tgtPath] = args

    srcPath = srcPath.split('.').map(parseInt)
    tgtPath = tgtPath.split('.').map(parseInt)

    let src = this.findChild(pod, srcPath)
    let tgt = this.findChild(pod, tgtPath)

    if (!src || !tgt) {
      return 'nopod'
    }

    let chn = this.connect(pod, src, tgt)

    // tell tgt about new channel
    tgt.endpoints.get(0).down.push(['newchannel', chn.end.id])

    return chn.start.id
  },

  _send (pod, args) {
    // send data into a channel
    let [chnId, data] = args
    let chn = pod.endpoints.get(chnId)
    chn.up.push(data)
    return true
  },

  _receive (pod, args) {
    // instructs something to be run anytime data appears in a channel
    let [chnId, entryName, stateId] = args
    let chn = pod.endpoints.get(chnId)
    if (!chn) {
      return 'nochannel'
    }
    chn.rx = { entryName, stateId }
    return true
  },

  _close (pod, args) {
    // closes a channel
    return false
  }
}, {
  boot: {}
})

export function new_os (bios) {
  let state = {
    bios
  }

  return OS.new(state)
}

// code of pod0
let pod0bin = {
  main (sys) {
    let r = sys.read('_').data
    switch (r[0]) {
    case 'start':
      // start of first userspace code
      sys.debug('main')

      // start up system level processes
      sys.call('sched', 'launch', null, [])
    }
  },
  launch (sys) {
    sys.call('spawn', 'listen', null, ['init'])
  },
  listen (sys) {
    let ret = sys.read('_')
    sys.call('receive', 'ready', null, [ret, 'receive', sys.state()])
  },
  ready (sys) {
    sys.debug('ready')
  },
  receive (sys) {
    // message received from child pod
    let { channelId, data } = sys.read('_')
    sys.debug(`received: ${channelId} ${data}`)
    switch (data[0]) {
    case 'connect':
      let [c, name] = data
      let registry = sys.read('registry')
      let src = channelId + ""
      let tgt = registry[name] + ""
      sys.call('connect', 'i', null, [src, tgt])
      break
    }
  },
  i (sys) {
    let ret = sys.read('_')
    sys.debug(`i: ${ret}`)
  }
}
