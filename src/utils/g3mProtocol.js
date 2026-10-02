export function normalizeSavedPath(path) {
  return String(path || '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\/g, '/');
}
export function buildG3MLink(path) {
  const normalized = normalizeSavedPath(path);
  if (
    !/^(?:[A-Za-z]:\/[^/]|\/[^/])/.test(normalized) ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized) ||
    !/\.zip$/i.test(normalized) ||
    normalized.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error(
      'Enter the full path to the saved ZIP, for example C:/Users/Name/Downloads/mod.zip.'
    );
  const encoded = normalized
    .split('/')
    .map((part, index) =>
      index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)
    )
    .join('/');
  return 'g3m://file://' + (encoded.startsWith('/') ? '' : '/') + encoded;
}
