export function operationList(files, parent = []) {
  let list = files;
  for (const index of parent) {
    const entry = list[index];
    if (
      !entry ||
      'type' in entry ||
      'source' in entry ||
      Object.keys(entry).length !== 1
    )
      throw new Error('Select a group.');
    list = Object.values(entry)[0];
  }
  return list;
}
export function operationAt(files, path) {
  return operationList(files, path.slice(0, -1))[path.at(-1)];
}
export function moveOperation(files, source, destination, index = Infinity) {
  if (!source.length || source.every((part, i) => destination[i] === part))
    throw new Error('Cannot move a group into itself.');
  const result = structuredClone(files),
    from = operationList(result, source.slice(0, -1)),
    to = operationList(result, destination);
  const oldIndex = source.at(-1),
    item = from[oldIndex];
  if (!item) throw new Error('Operation no longer exists.');
  from.splice(oldIndex, 1);
  to.splice(Math.min(index, to.length), 0, item);
  return result;
}
export function groupPaths(files, prefix = [], result = []) {
  files.forEach((entry, index) => {
    if (!('type' in entry) && !('source' in entry)) {
      const [name, children] = Object.entries(entry)[0],
        path = [...prefix, index];
      result.push({ name, path });
      groupPaths(children, path, result);
    }
  });
  return result;
}
