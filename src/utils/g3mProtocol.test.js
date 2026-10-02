import { describe, expect, it } from 'vitest';
import { buildG3MLink } from './g3mProtocol';
describe('G3M local-file protocol', () => {
  it.each([
    ['C:\\Mods\\my mod,#?.zip', 'g3m://file:///C:/Mods/my%20mod%2C%23%3F.zip'],
    ['C:\\Downloads\\mod (1).zip', 'g3m://file:///C:/Downloads/mod%20(1).zip'],
    [
      '/home/player/мод.zip',
      'g3m://file:///home/player/%D0%BC%D0%BE%D0%B4.zip',
    ],
  ])('encodes %s for the desktop handler', (path, url) =>
    expect(buildG3MLink(path)).toBe(url)
  );
  it.each([
    'mod.zip',
    '\\\\server\\mod.zip',
    '//server/mod.zip',
    'C:/Mods/../mod.zip',
    'blob:https://example.org/id',
    'data:text/plain,a',
    'C:/Mods/mod.exe',
  ])('rejects unavailable or nonlocal paths %s', (path) =>
    expect(() => buildG3MLink(path)).toThrow()
  );
  it('accepts paths copied with quotes by Windows Explorer', () =>
    expect(buildG3MLink('"C:\\Mods\\my mod.zip"')).toBe(
      'g3m://file:///C:/Mods/my%20mod.zip'
    ));
});
