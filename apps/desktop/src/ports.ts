import net from 'node:net'

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Could not determine a free port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}
