
import { assert, mkel } from './util.js'
import * as random from './random.js'

export const STDIN = 0
export const STDOUT = 1

export const EXIT = Symbol('exit')
export const INVALID_CALL = Symbol('invalidcall')
export const NOT_INSIDE = Symbol('notinside')

/*
struct process {
id,
parent,
children,
queue,
}
*/

/*
struct event {
source,
data
}
*/

class Init {
  main () {
  }
}

class Display {
  main () {
  }
}

class GShell {
  main () {
  }
}

export default class OS {
  constructor (config) {
    this.config = config
  }
  boot () {
    this.element = this.config.element
    this.modules = this.config.modules
    this.time = 0
    this.tasks = []
    this.apps = new Map()
    this.streams = new Map()
    this.streamCounter = 0
    this.processes = new Map()
    this.processCounter = 0
    this.windows = new Map()
    this.windowCounter = 0
    this.topWindow = null
    this.timeouts = new Map()
    this.timeoutCounter = 0
    // default syscalls
    this.syscalls = new Map([
      [ 'getTime', this._getTime ],
      [ 'getSelf', this._getSelf ],
      [ 'getHandles', this._getHandles ],
      [ 'open', this._openStream ],
      [ 'read', this._readStream ],
      [ 'write', this._writeStream ],
      [ 'close', this._closeStream ],
      [ 'signal', this._signalProcess ],
      [ 'launch', this._launchProcess ],
      [ 'listFiles', this._listFiles ],
      [ 'writeFile', this._writeFile ],
      [ 'readFile', this._readFile ],
      [ 'deleteFile', this._deleteFile ],
      [ 'newWindow', this._newWindow ],
      [ 'moveWindow', this._moveWindow ],
      [ 'resizeWindow', this._resizeWindow ],
      [ 'closeWindow', this._closeWindow ],
      [ 'listProcesses', this._listProcesses ],
      [ 'timeout', this._setTimeout ]
    ])
    this.protocols = new Map([
      [ 'file', this._openFile ]
    ])
    // console
    this.console = mkel('div', { classes: [ 'console' ] })
    this.element.appendChild(this.console)
    // topbar
    this.topBox = mkel('div', { classes: [ 'os', 'topbar' ] })
    this.timeBox = mkel('div', { classes: [ 'os', 'clock' ] })
    this.topBox.appendChild(this.timeBox)
    this.element.appendChild(this.topBox)
    // dock
    let dockBox = mkel('div', { classes: [ 'os', 'dockbox' ] })
    this.dockBox = mkel('div', { classes: [ 'os', 'dock' ] })
    dockBox.appendChild(this.dockBox)
    this.element.appendChild(dockBox)
    // window management
    this.element.addEventListener('mousemove', (e) => {
      if (this.moving) {
        this.doMove(e)
      }
    })
    this.element.addEventListener('mouseup', (e) => {
      if (this.moving) {
        this.stopMove(e)
      }
    })
    // setup
    for (let mod of this.modules) {
      mod.init && mod.init(this)
    }
    for (let [cmd, app] of this.config.apps) {
      this.addApp(cmd, app)
    }
    for (let [label, cmd] of this.config.icons) {
      this.addIcon(label, cmd)
    }
    // tick
    window.setTimeout(() => this.tick(), 0)
  }
  // syscall API
  syscall (proc, name, args) {
    proc = this.getProcess(proc)
    if (!proc) {
      this.log(`no proc: ${proc}`)
      return
    }
    let sc = this.syscalls.get(name)
    if (!sc) {
      this.log(`no syscall: ${name}`)
      return
    }

    this.log(`${proc.id} ${name} ${args}`)
    let r = sc.apply(this, [proc, ...JSON.parse(args)])
    if (r === undefined || r === null) {
      return null
    }
    r = JSON.stringify(r)
    this.log(`=> ${r}`)
    return r
  }
  // misc syscalls
  _getTime (proc) {
    return this.time
  }
  _getSelf (proc) {
    return proc.id
  }
  _getHandles (proc) {
    return Array.from(proc.handles.keys())
  }
  // timer syscalls
  _setTimeout (proc, time, tag) {
    let id = ++this.timeoutCounter
    this.timeouts.set(id, {
      proc: proc.id,
      tag: tag,
      time: time
    })
    return id
  }
  // window syscalls
  _newWindow (proc, clazz, title, body) {
    let w = this.createWindow(proc, clazz, title, body)
    return {
      id: w.id,
      bd: w.body
    }
  }
  _moveWindow (proc, handle, x, y) {
    let win = this.getWindow(handle)
    if (!win) {
      throw new Error('no window ' + handle)
    }
    this.moveWindow(win, x, y)
  }
  _resizeWindow (proc, handle, w, h) {
    let win = this.getWindow(handle)
    if (!win) {
      throw new Error('no window ' + handle)
    }
    this.resizeWindow(win, w, h)
  }
  _closeWindow (proc, handle) {
    let w = this.getWindow(handle)
    if (!w) {
      throw new Error('no window ' + handle)
    }
    this.removeWindow(w)
  }
  // stream syscalls
  _openStream (proc, url) {
    let [proto, uri] = url
    let opener = this.protocols.get(proto)
    if (opener) {
      let s = opener.apply(this, [ proc, uri ])
      if (s) {
        return {
          tx: this.addToProcess(proc, 'stream', s.tx.id),
          rx: this.addToProcess(proc, 'stream', s.rx.id)
        }
      }
    }
    return null
  }
  _readStream (proc, handle, tag) {
    let sid = proc.handles.get(handle)
    if (sid === undefined) {
      throw new Error(`no stream ${handle}`)
    }

    let s = this.getStream(sid.id)
    return this.readStream(s, proc, tag)
  }
  _writeStream (proc, handle, data) {
    let sid = proc.handles.get(handle)
    if (sid === undefined) {
      throw new Error(`no stream ${handle}`)
    }

    let s = this.getStream(sid.id)
    return this.writeStream(s, data)
  }
  _closeStream (proc, handle) {
    let sid = proc.handles.get(handle)
    if (sid === undefined) {
      throw new Error(`no stream ${handle}`)
    }

    let s = this.getStream(sid.id)
    proc.handles.delete(handle)
    return this.unlinkStream(s, proc)
  }
  // process syscalls
  _launchProcess (proc, cmd, args) {
    let p = this.createProcess(cmd, args)
    if (!p) {
      return null
    }

    this.linkStream(p.stdIn, proc)
    this.linkStream(p.stdOut, proc)

    let id = p.process.id
    let tx = this.addToProcess(proc, 'stream', p.stdIn.id)
    let rx = this.addToProcess(proc, 'stream', p.stdOut.id)

    this.startProcess(p.process)

    return { id, tx, rx }
  }
  _signalProcess (proc, tgt, sig) {
    let tgtProc = this.getProcess(tgt)
    if (tgtProc) {
      this.signal(proc, tgt, sig)
    }
  }
  _listProcesses (proc) {
    let l = []
    for (let p of this.processes.values()) {
      l.push({
        id: p.id,
        cmd: p.cmd
      })
    }
    return l
  }
  // file syscalls
  _listFiles (proc) {
    return [ 'file' ]
  }
  _writeFile (proc, name, data) {
  }
  _readFile (proc, name) {
    return ':fun 1 ; fun fun +'
  }
  _deleteFile (proc, name) {
  }
  _openFile (proc, uri) {
    return null
  }
  // stream internals
  createStream (owner) {
    let id = this.streamCounter++
    let stream = {
      id: id,
      owner: owner.id,
      procs: new Set([ owner.id ]),
      open: true,
      lines: [],
      reader: null
    }
    this.streams.set(id, stream)
    return stream
  }
  getStream (s) {
    if (typeof(s) === 'number') {
      return this.streams.get(s)
    }
    return s
  }
  linkStream (stream, proc) {
    if (!stream.open) {
      throw new Error('stream closed')
    }
    stream.procs.add(proc.id)
  }
  unlinkStream (stream, proc) {
    stream.procs.delete(proc.id)
    if (stream.owner === proc.id) {
      stream.open = false
      stream.owner = null
    }
    if (stream.reader && stream.reader.proc === proc.id) {
      stream.reader = null
    }
  }
  writeStream (stream, i) {
    if (typeof(i) !== 'string') {
      throw new Error('must write string')
    }
    if (!stream.open) {
      throw new Error('stream closed')
    }
    stream.lines.push(i)
  }
  readStream (stream, proc, tag) {
    stream.reader = { proc: proc.id, tag: tag }
  }
  // process internals
  createProcess (cmd, args) {
    let appClass = this.apps.get(cmd)
    if (!appClass) {
      return null
    }

    let app = null
    try {
      app = new appClass()
    } catch (e) {
      console.log('failed app load', e)
      return null
    }

    app.wake = app.wake || (() => null)

    let id = ++this.processCounter
    let process = {
      id: id,
      app: app,
      args: args,
      cmd: cmd,
      tasks: [],
      inside: false,
      handles: new Map(),
      handleCounter: 0
    }
    this.processes.set(id, process)

    let stdIn = this.createStream(process)
    let stdOut = this.createStream(process)

    this.addToProcess(process, 'stream', stdIn.id)
    this.addToProcess(process, 'stream', stdOut.id)

    return { process, stdIn, stdOut }
  }
  getProcess (p) {
    if (typeof(p) === 'number') {
      return this.processes.get(p)
    }
    return p
  }
  wakeProcess (p, tag, data) {
    this.enqueueInProcess(p, () => p.app.wake(tag, data))
  }
  enqueueInProcess (p, task) {
    p.tasks.push(task)
  }
  startProcess (p) {
    const sys = (name, ...args) => {
      if (!p.inside) {
        throw NOT_INSIDE
      }
      args = args || []
      // console.log('syscall', p.id, name, args)
      let r = this.syscall(p.id, name, JSON.stringify(args))
      // console.log('=>', r)
      if (r) {
        return JSON.parse(r)
      }
      return null
    }

    const defer = (tag) => {
      // this is weirdly direct access into the OS, but the only way to connect JS signals etc
      this._setTimeout(p, 0, tag)
    }

    const exit = () => {
      throw EXIT
    }

    p.app.args = p.args
    p.app.sys = sys
    p.app.defer = defer
    p.app.exit = exit

    p.running = true
    p.tasks.push(() => {
      p.app.main()
    })
  }
  addToProcess (p, type, id) {
    let handle = p.handleCounter++
    p.handles.set(handle, {
      type: type,
      id: id
    })
    return handle
  }
  removeFromProcess (p, type, id) {
    for (let [h, l] of p.handles) {
      if (l.type === type && l.id === id) {
        p.handles.remove(h)
        return
      }
    }
  }
  tickProcess (p) {
    let task = p.tasks.shift()
    if (task) {
      p.inside = true
      try {
        task(p)
      } catch (e) {
        if (e === EXIT) {
          p.running && this.exitProcess(p)
        } else {
          p.running && this.crashProcess(p, e)
        }
      }
      p.inside = false
    }
  }
  exitProcess (proc) {
    proc.running = false
    if (proc.id) {
      for (let [id, sid] of proc.handles) {
        let s = this.streams.get(sid.id)
        this.unlinkStream(s, proc)
      }
      for (let [id, w] of this.windows) {
        if (w.owner === proc.id) {
          this.removeWindow(w)
        }
      }
      for (let [id, t] of this.timeouts) {
        if (t.proc === proc.id) {
          this.timeouts.delete(id)
        }
      }
      this.processes.delete(proc.id)
      proc.id = 0
    }
  }
  crashProcess (proc, e) {
    console.log('crashing', proc, e)
    this.exitProcess(proc)
  }
  // window internals
  createWindow (owner, clazz, title) {
    let id = this.windowCounter++
    let w = {
      id: id,
      owner: owner.id,
      body: random.id(),
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      z: 1
    }
    createWindowHTML(w, clazz, title)
    this.windows.set(id, w)

    if (this.topWindow) {
      this.topWindow.box.classList.remove('focused')
      w.z = this.topWindow.z + 1
    }
    w.box.style.zIndex = w.z
    w.box.classList.add('focused')
    this.topWindow = w

    w.box.addEventListener('mousedown', (e) => {
      if (w != this.topWindow) {
        this.topWindow.box.classList.remove('focused')
        w.z = this.topWindow.z + 1
        w.box.style.zIndex = w.z
        w.box.classList.add('focused')
        this.topWindow = w
      }
    })
    w.titleBar.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.startMove(e, w)
    }, { capture: false })
    w.closeButton.addEventListener('click', (e) => {
      e.stopPropagation()
      this.wakeProcess(this.getProcess(w.owner), 'window_close', id)
    })

    w.bodyBox.id = w.body

    // let body = document.getElementById(bodyId)
    // body.parentNode.removeChild(body)
    // w.bodyBox.appendChild(body)

    // this.enqueue(() => {
      this.element.appendChild(w.box)
    // })
    return w
  }
  getWindow (w) {
    if (typeof(w) === 'number') {
      return this.windows.get(w)
    }
    return w
  }
  startMove (e, w) {
    this.moving = { x: e.clientX, y: e.clientY, w: w }
  }
  doMove (e) {
    // offsets
    let b = this.moving.w.box
    let dx = e.clientX - this.moving.x
    let dy = e.clientY - this.moving.y
    let nx = b.offsetLeft + dx
    let ny = Math.max(40, b.offsetTop + dy)
    // screen move
    this.moveWindow(this.moving.w, nx, ny)
    // for next event
    this.moving.x = e.clientX
    this.moving.y = e.clientY
  }
  stopMove (e) {
    this.moving = null
  }
  moveWindow (win, x, y) {
    win.x = x
    win.y = y
    win.box.style.left = `${x}px`
    win.box.style.top =`${y}px`
  }
  resizeWindow (win, w, h) {
    win.w = w
    win.h = h
    win.box.style.width = `${w}px`
    win.box.style.height = `${h}px`
  }
  removeWindow (w) {
    this.windows.delete(w.id)
    this.element.removeChild(w.box)
    // TODO - handle topWindow
  }
  signal (proc, tgt, sig) {
    tgt = this.getProcess(tgt)
    if (sig === 9) {
      this.exitProcess(tgt)
    } else {
      this.wakeProcess(tgt, 'sig', sig)
    }
  }
  // internals
  addApp (cmd, app) {
    this.apps.set(cmd, app)
  }
  addIcon (label, cmd) {
    let iconCore = mkel('div', { text: label })
    let iconBox = mkel('div', { classes: [ 'os', 'icon' ] })
    iconBox.appendChild(iconCore)
    this.dockBox.appendChild(iconBox)
    iconBox.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.launch(cmd)
    })
  }
  launch (cmd, args) {
    let p = this.createProcess(cmd, args)
    if (!p) {
      return null
    }

    this.startProcess(p.process)

    return { id: p.process.id }
  }
  enqueue (task) {
    this.tasks.push(task)
  }
  tick () {
    // process timeouts
    for (let [id, t] of this.timeouts) {
      t.time--
      if (t.time <= 0) {
        this.timeouts.delete(id)
        this.wakeProcess(this.getProcess(t.proc), t.tag)
      }
    }

    for (let mod of this.modules) {
      mod.tick && mod.tick.apply(this)
    }

    // process streams
    for (let stream of this.streams.values()) {
      // pump all streams, regardless of state
      let wakes = this.pump(stream)
      for (let [pid, tag, l] of wakes) {
        this.wakeProcess(this.getProcess(pid), tag, l)
      }
    }

    // any other OS tasks
    for (let t of this.tasks) {
      t()
    }
    this.tasks = []

    // tick processes
    for (let [id, p] of this.processes) {
      this.tickProcess(p)
    }

    window.setTimeout(() => this.tick(), 100)
  }
  pump (stream) {
    let wakes = []
    if (stream.reader) {
      if (stream.lines.length > 0) {
        let l = stream.lines.pop()
        let r = stream.reader
        stream.reader = null
        wakes.push([r.proc, r.tag, l])
      } else if (!stream.open) {
        let r = stream.reader
        stream.reader = null
        wakes.push([r.proc, r.tag, 0])
      }
    }
    if (stream.procs.size == 0) {
      stream.open = false
      this.streams.delete(stream.id)
    }
    return wakes
  }
  log (t) {
    if (this.console.childElementCount > 100) {
      this.console.removeChild(this.console.firstElementChild)
    }
    let line = mkel('p', { text: t })
    this.console.appendChild(line)
    line.scrollIntoView()
  }
}

function createWindowHTML (w, clazz, title) {
    let box = mkel('div', { classes: ['window'] })

    let titleBar = mkel('div', { classes: [ 'os', 'title' ] })
    let titleBox = mkel('div', { text: title })
    titleBar.appendChild(titleBox)
    let buttonBox = mkel('div', { classes: [ 'buttons' ] })
    let closeButton = mkel('div', { text: '×' })
    buttonBox.appendChild(closeButton)
    titleBar.appendChild(buttonBox)
    box.appendChild(titleBar)

    let bodyBox = mkel('div', { classes: [ 'body', clazz ] })
    box.appendChild(bodyBox)

    box.style.left = `${w.x}px`
    box.style.top =`${w.y}px`
    box.style.width = `${w.w}px`
    box.style.height = `${w.h}px`

    w.box = box
    w.titleBar = titleBar
    w.bodyBox = bodyBox
    w.closeButton = closeButton
}
