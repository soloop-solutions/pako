export const LAUNCH_COOKIE_NAME = 'pako_launch'

export function isAllowedNavigation(url: string, apiOrigin: string): boolean {
  try {
    return new URL(url).origin === new URL(apiOrigin).origin
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
