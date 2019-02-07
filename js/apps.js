
import { mkel } from './util.js'
import * as os from './os.js'
import * as random from './random.js'

export class Lib {
  constructor () {
    this.cbs = new Map()
    this.cbCount = 0
  }
  queue (task) {
    let id = 'cb-' + this.cbCount++
    this.cbs.set(id, task)
    this.defer(id)
  }
  wake (tag, data) {
    let t = this.cbs.get(tag)
    if (t) {
      this.cbs.delete(tag)
      t.call(this, data)
    }
  }
  print (line) {
    this.sys('write', os.STDOUT, line)
  }
  read (cb) {
    let id = 'cb-' + this.cbCount++
    this.cbs.set(id, cb)
    this.sys('read', os.STDIN, id)
  }
  gets (tag) {
    this.sys('read', os.STDIN, tag)
  }
  // setupWindowing () {
  //   // XXX this is not removed on exit
  //   this.windowMemory = mkel('div', { 'style': 'display: none' })
  //   document.body.appendChild(this.windowMemory)
  // }
  newWindow (title, clazz, body) {
    // if (!this.windowMemory) {
    //   this.setupWindowing()
    // }
    // let bodyId = random.id()
    // body.id = bodyId
    // this.windowMemory.appendChild(body)
    let win = this.sys('newWindow', title, clazz)
    document.getElementById(win.bd).appendChild(body)
    return win.id
  }
}

export class CatCmd extends Lib {
  main () {
    this.read(this.loop)
  }
  loop (data) {
    if (data === '') {
      this.exit()
    }
    this.print(`read: ${data}`)
    this.read(this.loop)
  }
  wake (tag, data) {
    super.wake(tag, data)

    if (tag === 'sig') {
      this.print(`sig: ${data}`)
    }
  }
}

export class EveryCmd extends Lib {
  main () {
    this.sys('timeout', 10, 'ping')
  }
  wake (tag, data) {
    if (tag === 'ping') {
      this.print(`ping`)
      this.sys('timeout', 10, 'ping')
    } else if (tag === 'sig') {
      this.exit(0)
    }
  }
}

export class Terminal extends Lib {
  constructor () {
    super()
    this.prompt = '$ '
    this.commands = {
      'exit': () => {
        this.exit()
      },
      'debug': () => {
        console.log(this)
        this.addLine('test ' + this)
      },
      'handles': () => {
        this.addLine(this.sys('getHandles').join(' '))
      },
      'self': () => {
        this.addLine(this.sys('getSelf'))
      },
      'time': () => {
        this.addLine(this.sys('getTime'))
      },
      'ls': () => {
        let ls = this.sys('listFiles')
        for (let file of ls) {
          this.addLine(file)
        }
      },
      'read': (args) => {
        let data = this.sys('readFile', args[1])
        this.addLine(data)
      },
      'ps': (args) => {
        let data = this.sys('listProcesses')
        for (let p of data) {
          this.addLine(`${p.id} ${p.cmd}`)
        }
      },
      'kill': (args) => {
        this.sys('signal', parseInt(args[1]), parseInt(args[2]))
      }
    }
  }
  main () {
    this.drawnLines = mkel('ul')

    this.inputLine = mkel('div', { classes: [ 'inputline' ] })
    this.promptBox = mkel('span', { text: this.prompt })
    this.inputLine.appendChild(this.promptBox)
    this.inputBox = mkel('input')
    this.inputBox.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        let i = this.inputBox.value
        this.inputBox.value = ''
        // this wouldn't be allowed, because it's trying to make os calls from an event handler
        // this.onInput(i)
        this.queue(() => this.onInput(i))
        this.inputBox.focus()
      }
    })
    this.inputLine.appendChild(this.inputBox)

    let scrolled = mkel('div')
    scrolled.appendChild(this.drawnLines)
    scrolled.appendChild(this.inputLine)

    let scroller = mkel('div', { classes: [ 'scroller' ] })
    scroller.appendChild(scrolled)
    scroller.addEventListener('click', (e) => {
      this.focus()
    })

    this.buttonBox = mkel('div', { classes: [ 'buttons' ] })
    let intButton = mkel('button', { text: 'int'} )
    intButton.addEventListener('click', (e) => {
      this.queue(() => this.onInt())
    })
    let killButton = mkel('button', { text: 'kill'} )
    killButton.addEventListener('click', (e) => {
      this.queue(() => this.onKill())
    })
    this.buttonBox.appendChild(intButton)
    this.buttonBox.appendChild(killButton)

    let body = mkel('div', { classes: [ 'body' ] })
    body.appendChild(scroller)
    body.appendChild(this.buttonBox)

    this.window = this.newWindow('console', 'terminal', body)
    this.sys('moveWindow', this.window, 50, 50)
    this.sys('resizeWindow', this.window, 600, 400)
  }
  focus () {
    this.inputLine.scrollIntoView()
    this.inputBox.focus()
  }
  setPrompt (prompt) {
    this.prompt = prompt
    this.promptBox.textContent = this.prompt
  }
  onInput (i) {
    if (this.proc) {
      this.addLine(i)
      // forward to the running app
      this.sys('write', this.proc.tx, i)
    } else {
      // try to launch an app
      let args = i.trim().split(/\s+/)
      this.addLine(this.prompt + i)
      if (args[0]) {
        this.run(args[0], args)
      }
    }
  }
  onInt () {
    if (this.proc) {
      this.sys('signal', this.proc.id, 1)
    }
  }
  onKill () {
    if (this.proc) {
      this.sys('signal', this.proc.id, 9)
    }
  }
  run (i, args) {
    let cmd = this.commands[i]
    if (cmd) {
      cmd(args)
    } else {
      this.proc = this.sys('launch', i, args)
      if (this.proc) {
        this.prompt0 = this.prompt
        this.setPrompt('')
        this.addLine('> launched ' + this.proc.id)
        this.sys('read', this.proc.rx, 'fromapp')
      } else {
        this.addLine(`${i}: command not found`)
      }
    }
  }
  wake (tag, data) {
    super.wake(tag, data)
    if (tag === 'fromapp') {
      if (data === 0) {
        this.onExit()
      } else {
        this.onOutput(data)
        this.sys('read', this.proc.rx, 'fromapp')
      }
    } else if (tag === 'window_close') {
      this.exit()
    }
  }
  onOutput (e) {
    this.addLine(e)
  }
  onExit () {
    this.sys('close', this.proc.tx)
    this.sys('close', this.proc.rx)
    this.addLine('> exited ' + this.proc.id)
    this.proc = null
    this.setPrompt(this.prompt0)
  }
  addLine (i) {
    let e = mkel('li')
    e.textContent = i
    this.drawnLines.appendChild(e)
    this.inputLine.scrollIntoView()
  }
}
