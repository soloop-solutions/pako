import { describe, expect, it } from 'vitest'
import net from 'node:net'
import { chooseApiPort, getFreePort, isPortFree } from './ports'

function listen(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(port, '127.0.0.1', () => resolve(s))
  })
}

describe('ports', () => {
  it('GetFreePort_ReturnsUsablePort', async () => {
    const port = await getFreePort()
    expect(port).toBeGreaterThan(1023)
    const s = await listen(port)
    await new Promise<void>((r) => s.close(() => r()))
  })

  it('IsPortFree_FalseWhileListening_TrueAfterClose', async () => {
    const port = await getFreePort()
    const s = await listen(port)
    expect(await isPortFree(port)).toBe(false)
    await new Promise<void>((r) => s.close(() => r()))
    expect(await isPortFree(port)).toBe(true)
  })

  it('ChooseApiPort_FirstLaunch_PicksAndPersists', async () => {
    const persisted: number[] = []
    const port = await chooseApiPort({
      saved: undefined,
      isFree: async () => true,
      getFree: async () => 50001,
      persist: async (p) => void persisted.push(p),
    })
    expect(port).toBe(50001)
    expect(persisted).toEqual([50001])
  })

  it('ChooseApiPort_SavedAndFree_ReusesWithoutWriting', async () => {
    const persisted: number[] = []
    const checked: number[] = []
    const port = await chooseApiPort({
      saved: 50001,
      isFree: async (p) => (checked.push(p), true),
      getFree: async () => 50999,
      persist: async (p) => void persisted.push(p),
    })
    expect(port).toBe(50001)
    expect(checked).toEqual([50001])
    expect(persisted).toEqual([])
  })

  it('ChooseApiPort_SavedButOccupied_FallsBackAndPersistsTheNewPort', async () => {
    const persisted: number[] = []
    const port = await chooseApiPort({
      saved: 50001,
      isFree: async () => false,
      getFree: async () => 50999,
      persist: async (p) => void persisted.push(p),
    })
    expect(port).toBe(50999)
    expect(persisted).toEqual([50999])
  })

  it('ChooseApiPort_PersistFailure_StillReturnsThePort', async () => {
    const port = await chooseApiPort({
      saved: undefined,
      isFree: async () => true,
      getFree: async () => 50002,
      persist: async () => {
        throw new Error('disk full')
      },
    })
    expect(port).toBe(50002)
  })
})
