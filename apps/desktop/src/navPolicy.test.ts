import { describe, expect, it } from 'vitest'
import {
  buildLaunchCookie,
  isAllowedNavigation,
  isAllowedRequest,
  isExternalHttps,
} from './navPolicy'

const origin = 'http://127.0.0.1:5050'

describe('isAllowedRequest', () => {
  it('allows the API origin over http and ws, and local resource schemes', () => {
    expect(isAllowedRequest('http://127.0.0.1:5050/api/x', origin)).toBe(true)
    expect(isAllowedRequest('ws://127.0.0.1:5050/hub', origin)).toBe(true)
    expect(isAllowedRequest('data:image/png;base64,AAAA', origin)).toBe(true)
    expect(isAllowedRequest('blob:http://127.0.0.1:5050/abc', origin)).toBe(true)
    expect(isAllowedRequest('devtools://devtools/bundled/x.js', origin)).toBe(true)
    expect(isAllowedRequest('file:///app/splash.html', origin)).toBe(true)
  })

  it('blocks everything else', () => {
    expect(isAllowedRequest('https://example.com/x', origin)).toBe(false)
    expect(isAllowedRequest('wss://example.com/x', origin)).toBe(false)
    expect(isAllowedRequest('http://127.0.0.1:5051/x', origin)).toBe(false)
    expect(isAllowedRequest('ws://127.0.0.1:5051/x', origin)).toBe(false)
    expect(isAllowedRequest('http://localhost:5050/x', origin)).toBe(false)
    expect(isAllowedRequest('blob:https://example.com/abc', origin)).toBe(false)
    expect(isAllowedRequest('ftp://example.com/x', origin)).toBe(false)
    expect(isAllowedRequest('garbage', origin)).toBe(false)
  })
})

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
