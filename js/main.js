
import OS from './os.js'

// keyboard hardward
let keyboard = {
  init () {
    document.addEventListener('keypress', e => {
      this.char = e.key
    })
  },
  read () {
    return this.char
  }
}

// display hardware
let display = {
  init () {
    this.html = document.getElementById('display')
  }
}

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
      sys.call('send', 'i', null, null, [0, ['register', 'kbd']])
    },
    i() {
    }
  },
  // fs server
  'fs': {
    main (sys) {
      sys.debug('fs main')
      sys.call('send', 'i', null, null, [0, ['register', 'fs']])
    },
    data (sys, chn) {
    },
    incoming (sys) {
      sys.debug('fs incoming')
    },
    i(sys) {
      sys.debug('i')
    }
  },
   // init app, and master of all normal pods
  'init': {
    main (sys) {
      sys.debug('init main')

      let registry = {}
      sys.write('registry', registry)

      sys.call('send', 'i', null, 'r', [0, ['connect', 'fs']])
    },
    receive (sys) {
      sys.debug('init receive')
    },
    fsconnected (sys) {
      let fschn = sys.read('ret1')
      sys.debug('init fsconnected', fschn)
      sys.write('fschn', fschn)
      sys.call('send', 'i', null, null, [fschn, 'some message'])
    },
    i () {
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
let os = new OS(bios)
os.boot()

// for hacking
window.os = os
