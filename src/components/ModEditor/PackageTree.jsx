import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PACKAGE_PATH_TYPE } from '../../utils/fileDrop';
import Icon from '../Icon';

export default function PackageTree({ assets, onChoose, onRemove, disabled = false, folders = true, label, selectedPath }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const tree = useMemo(() => {
    const root = new Map();
    for (const path of [...assets.directories, ...Object.keys(assets.files)]) {
      const parts = path.replace(/\/$/, '').split('/');
      let children = root;
      parts.forEach((name, index) => {
        const directory = index < parts.length - 1 || path.endsWith('/');
        if (!children.has(name)) children.set(name, {
          name, path: parts.slice(0, index + 1).join('/') + (directory ? '/' : ''),
          directory, children: new Map(),
        });
        children = children.get(name).children;
      });
    }
    return root;
  }, [assets]);
  const matches = (node) => node.path.toLowerCase().includes(query.toLowerCase()) || [...node.children.values()].some(matches);
  const render = (nodes) => (
    <ul>
      {[...nodes.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)).filter(matches).map((node) => {
        const row = (
          <div className="package-tree-row">
            {node.directory && !folders ? <span className="package-path" title={node.path}>
              <Icon name="folder_icon" /><span>{node.name}</span>
            </span> :
            <button type="button" className="package-path" title={node.path}
              aria-label={`${label || t('mce.useSource')}: ${node.path}`} disabled={disabled || (node.directory && !folders)}
              aria-pressed={selectedPath === node.path}
              onClick={() => onChoose(node.path)}>
              {node.directory && <Icon name="folder_icon" />}
              <span>{node.name}</span>
            </button>}
            {!node.directory && onRemove && <button type="button" className="icon-button"
              aria-label={`${t('buttons.delete')}: ${node.path}`} disabled={disabled}
              onClick={() => onRemove(node.path)}><Icon name="delete_icon" /></button>}
          </div>
        );
        return <li key={node.path} draggable={!disabled} title={node.path}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData(PACKAGE_PATH_TYPE, node.path);
          }}>
          {node.directory ? <details open={query ? true : undefined}>
            <summary>{row}</summary>{render(node.children)}
          </details> : row}
        </li>;
      })}
    </ul>
  );
  return <div className="package-tree">
    <input type="search" aria-label={t('mce.searchFiles')} placeholder={t('mce.searchFiles')}
      value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} />
    <div className="package-tree-scroll">{[...tree.values()].some(matches) ? render(tree) : <p>{t('mce.noMatchingFiles')}</p>}</div>
  </div>;
}
