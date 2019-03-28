
import OS from './os.js'

let config = {
  display: document.getElementById('display')
}

let os = new OS(config)
os.boot()
