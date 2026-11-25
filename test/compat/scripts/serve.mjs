// A minimal static file server for the official GUI build (used by Playwright's webServer).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const [rootArg, port = '8611'] = process.argv.slice(2)
const root = path.resolve(rootArg)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }

http
  .createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    let file = path.join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root)) {
      response.writeHead(403).end()
      return
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }).end(data)
    })
  })
  .listen(Number(port), () => console.log(`Serving ${root} on http://localhost:${port}`))
