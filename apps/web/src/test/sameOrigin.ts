function isSameOrigin(url: string, origin: string) {
  if (url.startsWith("data:")) return true;
  try {
    return new URL(url.replace(/^ws/i, "http")).origin === origin;
  } catch {
    return false;
  }
}

export function findForeignUrls(urls: string[], origin: string) {
  return urls.filter((url) => !isSameOrigin(url, origin));
}
