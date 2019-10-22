
import { new_os } from './os.js'
import jsc from './jsc.js'

// keyboard hardware
let keyboard = {
  init () {
    document.addEventListener('keypress', e => {
      this.char = e.key
    })
  },
  read () {
    let char = this.char
    this.char = null
    return char
  }
}

// display hardware
let display = {
  init () {
    this.html = document.getElementById('display')
  }
}

let initBin = jsc({
  '*main': {
    'start': (sys, args) => {
      sys.debug('init main')

      let launchList = [ 'drv1', 'drv2', 'fs', 'init' ]
      sys.write('launchList', launchList)

      let registry = {}
      sys.write('registry', registry)

      sys.call('send', 'i', null, [0, ['connect', 'fs']])
    }
  },
  receive (sys) {
    sys.debug('init receive')
  },
  fsconnected (sys) {
    let fschn = sys.read('ret1')
    sys.debug('init fsconnected', fschn)
    sys.write('fschn', fschn)
    sys.call('send', 'i', null, [fschn, 'some message'])
  },
  i (sys) {
    let ret = sys.read('_')
    sys.debug(`i: ${ret}`)
  }
})

let fsBin = jsc({
  '*main': {
    'start': (sys, args) => {
      sys.debug('fs main start')
      // sys.call('send', 'i', null, [0, ['register', 'fs']])
    },
    'newchannel': (sys, args) => {
      sys.debug('fs main newchannel')
    }
  },
  incoming (sys) {
    sys.debug('fs incoming')
  },
  i(sys) {
    let ret = sys.read('_')
    sys.debug(`i: ${ret}`)
  }
})

// represents filesystem on disk
let files = {
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
  // keyboard
  'kbd': {
    main (sys) {
      sys.debug('kbd main')
      sys.call('send', 'i', null, [0, ['register', 'kbd']])
    },
    i() {
    }
  },
  // fs server
  'fs': fsBin,
   // init app, and master of all normal pods
  'init': initBin,
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
  },
  // what to start up
  'inittab': `display
`
}

// disk hardware
let disk = {
  read (name) {
    return files[name]
  }
}

// sort of baby BIOS for easy hardware access
let bios = {
  initConsole () {
    display.init()
  },
  initKeyboard () {
    keyboard.init()
  },
  writeToConsole (text) {
    display.html.textContent += text
  },
  readDisk (name) {
    return disk.read(name)
  },
  readKeyboard () {
    return keyboard.read()
  }
}

// the OS
let os = new_os(bios)
os.boot()

// for hacking
window.os = os
