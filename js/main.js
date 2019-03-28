
import OS from './os.js'

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

let display = {
  init () {
    this.html = document.getElementById('display')
  }
}

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
    }
  },
  // fs server
  'fs': {
    main (sys) {
      sys.debug('fs main')
      sys.call('register', null, null, ['fs', 'incoming'])
    },
    incoming (sys) {
      sys.debug('fs incoming')
    }
  },
   // init app, and master of all other pods
  'init': {
    main (sys) {
      sys.debug('init main')
      sys.call('connect', 'fsconnected', 'ret1', ['fs'])
    },
    fsconnected (sys) {
      let fschn = sys.read('ret1')
      sys.debug('init fsconnected', fschn)
      sys.write('fschn', fschn)
      sys.send(fschn, 'some message')
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

let disk = {
  read (name) {
    return files[name]
  }
}

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

let os = new OS(bios)
os.boot()

// for hacking
window.os = os
