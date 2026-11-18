import { describe, expect, it } from 'vitest'
import { buildLaunchCookie, isAllowedNavigation, isExternalHttps } from './navPolicy'

const origin = 'http://127.0.0.1:5050'

describe('navPolicy', () => {
  it('allows only the API origin', () => {
    expect(isAllowedNavigation('http://127.0.0.1:5050/dashboard', origin)).toBe(true)
    expect(isAllowedNavigation('http://127.0.0.1:5051/', origin)).toBe(false)
    expect(isAllowedNavigation('https://127.0.0.1:5050/', origin)).toBe(false)
    expect(isAllowedNavigation('http://localhost:5050/', origin)).toBe(false)
    expect(isAllowedNavigation('https://example.com/', origin)).toBe(false)
    expect(isAllowedNavigation('file:///etc/passwd', origin)).toBe(false)
    expect(isAllowedNavigation('not a url', origin)).toBe(false)
    expect(isAllowedNavigation('http://127.0.0.1:5050@evil.com/', origin)).toBe(false)
  })

  it('treats only https URLs as external-openable', () => {
    expect(isExternalHttps('https://example.com/x')).toBe(true)
    expect(isExternalHttps('http://example.com/x')).toBe(false)
    expect(isExternalHttps('javascript:alert(1)')).toBe(false)
    expect(isExternalHttps('file:///c:/x')).toBe(false)
    expect(isExternalHttps('garbage')).toBe(false)
  })

  it('builds the launch cookie for the API origin', () => {
    expect(buildLaunchCookie(origin, 'abc123')).toEqual({
      url: origin,
      name: 'pako_launch',
      value: 'abc123',
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
    })
  })
})
