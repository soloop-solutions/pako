export const LAUNCH_COOKIE_NAME = 'pako_launch'

export function isAllowedNavigation(url: string, apiOrigin: string): boolean {
  try {
    return new URL(url).origin === new URL(apiOrigin).origin
  } catch {
    return false
  }
}

export function isAllowedRequest(url: string, apiOrigin: string): boolean {
  try {
    const u = new URL(url)
    const api = new URL(apiOrigin)
    switch (u.protocol) {
      case 'data:':
      case 'devtools:':
      case 'file:':
        return true
      case 'blob:':
        return u.origin === api.origin
      case 'http:':
      case 'ws:':
        return u.host === api.host
      default:
        return false
    }
  } catch {
    return false
  }
}

export function isExternalHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

export function buildLaunchCookie(origin: string, secret: string) {
  return {
    url: origin,
    name: LAUNCH_COOKIE_NAME,
    value: secret,
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
  }
}
