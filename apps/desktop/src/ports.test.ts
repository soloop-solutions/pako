import { describe, expect, it } from 'vitest'
import net from 'node:net'
import { getFreePort } from './ports'

describe('ports', () => {
  it('GetFreePort_ReturnsUsablePort', async () => {
    const port = await getFreePort()
    expect(port).toBeGreaterThan(1023)
    await new Promise<void>((resolve, reject) => {
      const s = net.createServer()
      s.once('error', reject)
      s.listen(port, '127.0.0.1', () => s.close(() => resolve()))
    })
  })
})
