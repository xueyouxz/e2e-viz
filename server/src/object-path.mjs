const ALLOWED_EXTENSIONS = new Set(['.bin', '.glb', '.json', '.webp'])
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export class InvalidObjectPathError extends Error {}

export function resolveObjectName(requestPathname, objectPrefix) {
  if (!requestPathname.startsWith('/data/')) {
    throw new InvalidObjectPathError('Path must start with /data/')
  }

  let relativePath
  try {
    relativePath = decodeURIComponent(requestPathname.slice('/data/'.length))
  } catch {
    throw new InvalidObjectPathError('Path is not valid URL encoding')
  }

  if (!relativePath || relativePath.length > 512 || relativePath.includes('\\')) {
    throw new InvalidObjectPathError('Path is invalid')
  }

  const segments = relativePath.split('/')
  if (
    segments.some(segment => !SAFE_SEGMENT.test(segment) || segment === '.' || segment === '..')
  ) {
    throw new InvalidObjectPathError('Path contains an unsafe segment')
  }

  const dotIndex = relativePath.lastIndexOf('.')
  const extension = dotIndex === -1 ? '' : relativePath.slice(dotIndex).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new InvalidObjectPathError('File type is not allowed')
  }

  const normalizedPrefix = objectPrefix.replace(/^\/+/, '').replace(/\/*$/, '/')
  return `${normalizedPrefix}${relativePath}`
}
