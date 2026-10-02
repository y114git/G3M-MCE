import { useEffect, useRef, useState } from 'react';
import {
  emptyAssets,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_ENTRIES,
  safePackagePath,
} from './zipHandler';

export const PACKAGE_PATH_TYPE = 'application/g3m-package-path';

export function assetsFromFiles(files) {
  const assets = emptyAssets();
  let bytes = 0;
  for (const file of files) {
    bytes += file.size;
    if (file.size > 512 * 1024 * 1024 || bytes > MAX_PACKAGE_BYTES)
      throw new Error('Dropped files exceed the package size limit.');
    const path = safePackagePath(file.webkitRelativePath || file.name);
    if (Object.hasOwn(assets.files, path))
      throw new Error(`Duplicate archive path: ${path}`);
    assets.files[path] = file;
    const parts = path.split('/');
    for (let end = 1; end < parts.length; end++) {
      const directory = parts.slice(0, end).join('/') + '/';
      if (!assets.directories.includes(directory))
        assets.directories.push(directory);
    }
  }
  if (
    Object.keys(assets.files).length + assets.directories.length >
    MAX_PACKAGE_ENTRIES
  )
    throw new Error('Too many dropped files or folders (limit: 10000).');
  return assets;
}

export async function droppedAssets(transfer) {
  // Entry handles must be captured before the browser clears the drop event.
  const items = [...transfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => ({
      entry: item.webkitGetAsEntry?.(),
      file: item.getAsFile(),
    }));
  if (!items.length) return assetsFromFiles([...transfer.files]);
  const assets = emptyAssets();
  let count = 0,
    bytes = 0;
  const visit = async (entry, prefix = '', file = null) => {
    if (++count > MAX_PACKAGE_ENTRIES)
      throw new Error('Too many dropped files or folders (limit: 10000).');
    if (entry?.isDirectory) {
      const path = safePackagePath(prefix + entry.name, true);
      if (assets.directories.includes(path))
        throw new Error(`Duplicate archive path: ${path}`);
      assets.directories.push(path);
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) =>
          reader.readEntries(resolve, reject)
        );
        if (!batch.length) break;
        for (const child of batch) await visit(child, path);
      }
    } else {
      if (entry)
        file = await new Promise((resolve, reject) =>
          entry.file(resolve, reject)
        );
      if (!file) throw new Error('Could not read the dropped file.');
      const path = safePackagePath(prefix + file.name);
      if (Object.hasOwn(assets.files, path))
        throw new Error(`Duplicate archive path: ${path}`);
      bytes += file.size;
      if (file.size > 512 * 1024 * 1024 || bytes > MAX_PACKAGE_BYTES)
        throw new Error('Dropped files exceed the package size limit.');
      assets.files[path] = file;
    }
  };
  for (const item of items) await visit(item.entry, '', item.file);
  return assets;
}

export function packageRoot(assets) {
  const roots = new Set(
    [...Object.keys(assets.files), ...assets.directories].map(
      (path) => path.split('/')[0]
    )
  );
  if (roots.size !== 1) return null;
  const root = [...roots][0];
  return root + (assets.directories.includes(root + '/') ? '/' : '');
}

export function useFileDrop({
  onDrop,
  onPath,
  onUrl,
  onError,
  disabled = false,
  onBusyChange,
}) {
  const [active, setActive] = useState(false);
  const depth = useRef(0),
    reading = useRef(false);
  const accepts = (event) =>
    [...event.dataTransfer.types].some(
      (type) =>
        type === 'Files' ||
        (onPath && type === PACKAGE_PATH_TYPE) ||
        (onUrl && type === 'text/uri-list')
    );
  const reset = () => {
    depth.current = 0;
    setActive(false);
  };
  useEffect(() => {
    window.addEventListener('drop', reset, true);
    window.addEventListener('dragend', reset, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('drop', reset, true);
      window.removeEventListener('dragend', reset, true);
      window.removeEventListener('blur', reset);
    };
  }, []);
  return {
    'data-drop-active': active ? '' : undefined,
    onDragEnter(event) {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!disabled && !reading.current) {
        depth.current++;
        setActive(true);
      }
    },
    onDragLeave(event) {
      if (!accepts(event)) return;
      event.stopPropagation();
      if (--depth.current <= 0) reset();
    },
    onDragOver(event) {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect =
        disabled || reading.current ? 'none' : 'copy';
    },
    async onDrop(event) {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      if (disabled || reading.current) return;
      reading.current = true;
      onBusyChange?.(true);
      try {
        const path = onPath && event.dataTransfer.getData(PACKAGE_PATH_TYPE);
        const url =
          onUrl &&
          ![...event.dataTransfer.types].includes('Files') &&
          event.dataTransfer
            .getData('text/uri-list')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line && !line.startsWith('#'));
        if (path) await onPath(path);
        else if (url) await onUrl(url);
        else await onDrop(await droppedAssets(event.dataTransfer));
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
      } finally {
        reading.current = false;
        onBusyChange?.(false);
      }
    },
  };
}
