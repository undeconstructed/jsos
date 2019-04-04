
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

    // info
    this.bios.writeToConsole('booting')

    // make something happens
    this.start(this.pod0)

    // clear stack and tick
    window.setTimeout(() => this.tick(), 0)
  }
  createPod0 () {
    // pod0 code is embedded in kernel
    let channel0 = this.newChannel(null)
    let pod0 = this.newPod(null, channel0.end, pod0bin)
    pod0.id = 0
    return pod0
  }
  tick () {
    // nominal time for sim
    this.time++

    // tick the whole OS by recursing down the process tree
    let res = this.tickPod(this.pod0)
    // TODO - see what happened?

    window.setTimeout(() => this.tick(), 100)
  }
  tickPod (pod) {
    // tick all children
    for (let c of pod.children.values()) {
      let res = this.tickPod(c)
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
        let rcv = channel.read()
        if (rcv) {
          // and data is available
          // then store data in state
          state.write(channel.rx.tag, {
            channelId: channel.id,
            data: rcv
          })
          // and schedule execution
          this.enqueue(pod, channel.rx.entry, channel.rx.stateId)
        }
      }
    }

    let res = { }

    // run through task queue
    while (pod.queue.length > 0) {
      // TODO - stop after time used up

      let t = pod.queue.shift()
      let res2 = this.invoke(pod, t)

      this.doSyscalls(pod, res2.calls)
    }

    return res
  }
  invoke (pod, task) {
    // run a task, i.e. execute an entry point with a state
    let os = this
    let id = this.podId(pod, null)
    let state = task.state
    let entry = task.entry

    // context object represents interface to machine and OS.
    let c = {
      debug (...args) {
        os.debug(id + ' ' + args.join(' '))
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
      call (name, reentry, stateId, tag, args) {
        if (stateId === null) {
          stateId = state.id
        }
        if (tag === null) {
          tag = '_'
        }
        let calls = this.read('_calls')
        calls.push([name, reentry, stateId, tag, args])
        this.write('_calls', calls)
      }
    }

    let calls = []
    try {
      // initialise space for syscalls
      c.write('_calls', [])
      // this is user space
      entry.call(null, c)
      state.owner = null
      // move syscalls into kernel space
      calls = c.read('_calls').map(e => ({ call: e[0], reentry: e[1], stateId: e[2], tag: e[3], args: e[4] }))
    } catch (e) {
      os.debug(id + ' ' + e)
      console.log('userspace error', id, e)
    }

    return { state, calls }
  }
  debug (text) {
    this.bios.writeToConsole(`\n${this.time} ${text}`)
  }
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
  }
  podId (pod, parent) {
    return Array.reverse([...(function*() {
      while (pod !== parent) {
        yield pod.id
        pod = pod.parent
      }
    })()]).join('.')
  }
  start (pod) {
    let state0 = this.newState(pod)
    pod.states.add(state0)
    this.enqueue(pod, 'main', 0)
  }
  doSyscalls (pod, calls) {
    for (let call of calls) {
      let err = this.doSyscall(pod, call)
      if (err) {
        this.debug('syscall error: ' + err)
      }
    }
  }
  doSyscall (pod, call) {
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

    let res = this.syscall(pod, call.call, call.args)

    if (call.tag) {
      state.write(call.tag, JSON.stringify(res))
    }

    this.enqueue(pod, call.reentry, call.stateId)

    return null
  }
  syscall (pod, call, args) {
    switch (call) {
    case 'sched':
      return this._sched(pod, args)
    case 'alloc':
      return this._alloc(pod, args)
    case 'delete':
      return this._delete(pod, args)
    case 'spawn':
      return this._spawn(pod, args)
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
  }
  _sched (pod, args) {
    return true
  }
  _alloc (pod, args) {
    // allocate a new state object
    let state = this.newState(pod)
    pod.states.add(state)
    return state.id
  }
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
  }
  _spawn (pod, args) {
    // create and start a new pod, as a child of this one
    let [binary] = args

    // cheat straight to disk
    let binx = this.bios.readDisk(binary)
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
    this.start(p)

    channel0.start.owner = p.id

    return channel0.start.id
  }
  _connect (pod, args) {
    // connect two pods, both of which are children of this one
    let [srcId, name] = args

    // TODO - handle deeper children
    let src = pod.children.get(srcId)
    let tgt = pod.names.get(name)

    let chn = this.newChannel(pod)
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
  _receive (pod, args) {
    // instructs something to be run anytime data appears in a channel
    let [chnId, entry, stateId, tag] = args
    let chn = pod.endpoints.get(chnId)
    if (!chn) {
      return 'nochannel'
    }
    chn.rx = { entry, stateId, tag }
    return true
  }
  _close (pod, args) {
    // closes a channel
    return false
  }
  newState (pod) {
    let data = new Map()

    let state = {
      data: data,
      owner: null,
      write (addr, data) {
        return this.data.set(addr, data)
      },
      read (addr) {
        return this.data.get(addr)
      }
    }

    return state
  }
  newTask (pod, entryName, stateId) {
    let entry = pod.binary[entryName]
    if (!entry) {
      return 'noentry'
    }
    let state = pod.states.get(stateId)
    if (state.owner) {
      return 'conflict'
    }
    let task = { entry, state }
    state.owner = task
    return task
  }
  enqueue (pod, entryName, stateId) {
    let task = this.newTask(pod, entryName, stateId)
    pod.queue.push(task)
    return null
  }
  newChannel (pod) {
    let atob = []
    let btoa = []

    let start = this.newEndpoint(atob, btoa)
    let end = this.newEndpoint(btoa, atob)

    return { start, end }
  }
  newEndpoint (u, d) {
    let endpoint = {
      owned: null,
      write (data) {
        u.push(data)
      },
      read () {
        d.shift()
      }
    }
    return endpoint
  }
}

// code of pod0
let pod0bin = {
  main (sys) {
    // start of first userspace code
    sys.debug('main')

    let launchList = [ 'drv1', 'drv2', 'fs', 'init' ]
    sys.write('launchList', launchList)

    // this registry enables connection to drivers
    let registry = {}
    sys.write('registry', registry)

    // start up system level processes
    sys.call('sched', 'launch', null, 'tag', sys)
  },
  launch (sys) {
    let launchList = sys.read('launchList')
    let next = launchList.shift()
    if (next) {
      sys.write('next', next)
      sys.write('launchList', launchList)
      sys.call('spawn', 'listen', null, 'ret', [next])
    } else {
    }
  },
  listen (sys) {
    let last = sys.read('next')
    let ret = sys.read('ret')
    sys.debug(`spawned: ${last} ${ret}`)

    // remember all the processes spawned
    let registry = sys.read('registry')
    registry[last] = ret
    sys.write('registry', registry)

    sys.call('receive', 'next', null, 'ret', [ret, 'receive', sys.state(), 'got'])
  },
  next (sys) {
    sys.call('sched', 'launch', null, null, [])
  },
  receive (sys) {
    // message received from child pod
    sys.debug('received: ' + sys.read('got'))
  }
}
