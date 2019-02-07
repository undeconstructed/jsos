
import OS from './os.js'
import * as apps from './apps.js'

// create the OS

let config = {
  element: document.getElementById('main'),
  modules: [],
  apps: [
    ['terminal', apps.Terminal],
    ['cat', apps.CatCmd],
    ['every', apps.EveryCmd]
  ],
  icons: [
    ['terminal', 'terminal']
  ]
}

let os = new OS(config)
os.boot()
