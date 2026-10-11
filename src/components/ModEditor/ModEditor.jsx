import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useNavigationGuard } from '../../navigation';
import {
  createEmptyModConfig,
  MOD_ALLOWED_TAGS,
  OPERATION_TYPES,
  RELATION_MODES,
  BUILTIN_PATHS,
  validateModConfig,
  localRelativePath,
  normalizeRelation,
} from '../../data/modConfig';
import {
  groupPaths,
  moveOperation,
  operationAt,
  operationList,
} from '../../data/operations';
import {
  downloadZip,
  emptyAssets,
  exportModArchive,
  fileBytes,
  hashPackagePath,
  listPackageZipMembers,
  validatePackage,
} from '../../utils/zipHandler';
import { buildG3MLink } from '../../utils/g3mProtocol';
import Icon from '../Icon';
import {
  assetsFromFiles,
  packageRoot,
  PACKAGE_PATH_TYPE,
  useFileDrop,
} from '../../utils/fileDrop';
import defaultIcon from '../../assets/icon.ico';
import './ModEditor.css';

const tabs = ['metadata', 'compatibility', 'files', 'placeholders', 'help'];
const helpSections = [
  'metadata',
  'placeholders',
  'custom_placeholders',
  'operations',
  'order',
  'compatibility',
];
const relationModeKey = (mode) =>
  `ui.mod_editor_relation_order_${mode ? mode.replaceAll('-', '_') : 'none'}`;
const operationIcon = (type = '') =>
  type.endsWith('overwrite')
    ? 'overwrite_type_icon'
    : type.endsWith('extract')
      ? 'extract_type_icon'
      : type === 'info'
        ? 'info_type_icon'
        : 'patch_type_icon';
const operationColor = (type = '') =>
  type.startsWith('soft-')
    ? 'operation-soft'
    : type.startsWith('hard-')
      ? 'operation-hard'
      : '';
const relationRow = (value) => {
  const text = normalizeRelation(value),
    index = text.lastIndexOf(':');
  return index > 0 && RELATION_MODES.includes(text.slice(index + 1))
    ? { id: text.slice(0, index), mode: text.slice(index + 1) }
    : { id: text, mode: '' };
};
const games = [
  'deltarune',
  'deltarunedemo',
  'undertale',
  'undertaleyellow',
  'pizzatower',
  'sugaryspire',
  'frickbears3',
];
const clean = (config) =>
  Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) =>
        [
          'config_version',
          'id',
          'name',
          'version',
          'authors',
          'game',
          'files',
        ].includes(key) ||
        (value !== '' &&
          value !== undefined &&
          (!Array.isArray(value) || value.length))
    )
  );
const FieldErrors = createContext({ errors: {}, onTouched: () => {} });
const samePath = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Field({
  label,
  value,
  onChange,
  multiline = false,
  hint,
  id,
  as,
  adornment,
  dropProps,
  children,
  ...props
}) {
  const { errors, onTouched } = useContext(FieldErrors);
  const error = errors[id];
  const Input = as || (multiline ? 'textarea' : 'input');
  return (
    <div className="g3m-field" {...dropProps}>
      <label htmlFor={id}>{label}</label>
      <div className="field-control">
        <Input
          id={id}
          type={Input === 'input' ? 'text' : undefined}
          value={value ?? ''}
          onChange={(event) => {
            onTouched(id);
            onChange(event.target.value);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? `${id}-error` : hint ? `${id}-hint` : undefined
          }
          {...props}
        >
          {children}
        </Input>
        {adornment}
      </div>
      <small
        id={error ? `${id}-error` : `${id}-hint`}
        className={`field-feedback ${error ? 'field-error' : ''}`}
      >
        {error || hint || '\u00a0'}
      </small>
    </div>
  );
}

function firstOperation(files, prefix = []) {
  for (let index = 0; index < files.length; index++) {
    const entry = files[index],
      path = [...prefix, index];
    if ('type' in entry || 'source' in entry) return path;
    const leaf = firstOperation(Object.values(entry)[0], path);
    if (leaf) return leaf;
  }
  return null;
}

function OperationTree({
  files,
  selected,
  select,
  move,
  invalidPaths,
  collapsed,
  toggleGroup,
  prefix = [],
}) {
  const { t } = useTranslation();
  let operationNumber = 0;
  const render = (entries, parent = []) => (
    <ol className="operation-tree">
      {entries.map((entry, index) => {
        const path = [...parent, index],
          group = !('type' in entry) && !('source' in entry);
        const number = group ? null : ++operationNumber;
        const name = group
          ? Object.keys(entry)[0]
          : entry.target || entry.source || '—';
        const drop = (event) => {
          if (
            ![...event.dataTransfer.types].includes('application/g3m-operation')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          try {
            const source = JSON.parse(
              event.dataTransfer.getData('application/g3m-operation')
            );
            move(source, group ? path : parent, group ? Infinity : index);
          } catch {
            /* Other dragged files do not describe an operation. */
          }
        };
        const button = (
          <button
            type="button"
            className={`tree-item ${samePath(selected, path) ? 'is-active' : ''} ${group ? 'tree-group' : ''} ${invalidPaths.some((invalid) => samePath(invalid, path)) ? 'is-invalid' : ''}`}
            title={
              group
                ? name
                : `${t('ui.mod_editor_type_' + entry.type?.replaceAll('-', '_'), { defaultValue: entry.type })}: ${name}`
            }
            aria-pressed={samePath(selected, path)}
            onClick={() => select(path)}
            onKeyDown={(event) => {
              if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
                return;
              event.preventDefault();
              const buttons = [
                ...event.currentTarget
                  .closest('.operations')
                  .querySelectorAll('.tree-item'),
              ].filter((button) => button.checkVisibility());
              const index = buttons.indexOf(event.currentTarget);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          buttons.length - 1,
                          index + (event.key === 'ArrowDown' ? 1 : -1)
                        )
                      );
              buttons[next].click();
              buttons[next].focus();
            }}
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.setData(
                'application/g3m-operation',
                JSON.stringify(path)
              );
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={drop}
          >
            {!group && (
              <>
                <span className="operation-number">{number}</span>
                <Icon
                  name={operationIcon(entry.type)}
                  className={operationColor(entry.type)}
                />
              </>
            )}
            <span className="operation-name">{name}</span>
          </button>
        );
        return (
          <li key={index}>
            {group ? (
              <details
                open={!collapsed.has(name)}
                onToggle={(event) => {
                  if (event.target === event.currentTarget)
                    toggleGroup(name, event.currentTarget.open);
                }}
              >
                <summary>{button}</summary>
                {render(Object.values(entry)[0], path)}
              </details>
            ) : (
              button
            )}
          </li>
        );
      })}
    </ol>
  );
  return render(files, prefix);
}

function ListPane({
  title,
  headers,
  rows,
  onAdd,
  onRemove,
  selected,
  setSelected,
  invalidRows,
  children,
}) {
  const { t } = useTranslation();
  const index = rows.length ? Math.min(selected, rows.length - 1) : -1;
  return (
    <section className="editor-pane list-pane" aria-label={title}>
      {title && <h2 className="pane-title">{title}</h2>}
      <div className="list-body">
        <div
          className="editor-list"
          role="group"
          aria-label={title || headers.join(' / ')}
        >
          <div className="list-columns">
            {headers.map((header) => (
              <span key={header}>{header}</span>
            ))}
          </div>
          <div className="list-rows">
            {rows.map((row, position) => (
              <button
                key={position}
                className={`list-columns tree-item ${index === position ? 'is-active' : ''} ${invalidRows.includes(position) ? 'is-invalid' : ''}`}
                aria-pressed={index === position}
                onClick={() => setSelected(position)}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowDown'
                      ? Math.min(position + 1, rows.length - 1)
                      : event.key === 'ArrowUp'
                        ? Math.max(position - 1, 0)
                        : null;
                  if (next !== null) {
                    event.preventDefault();
                    setSelected(next);
                    event.currentTarget.parentElement.children[next].focus();
                  }
                }}
              >
                {row.map((value, column) => (
                  <span key={column} title={value}>
                    {value || '—'}
                  </span>
                ))}
              </button>
            ))}
          </div>
        </div>
        <div className="button-row list-actions">
          <button
            onClick={() => {
              onAdd();
              setSelected(rows.length);
            }}
          >
            <Icon name="add_icon" />
            {t('ui.add')}
          </button>
          <button
            disabled={index < 0}
            onClick={() => {
              onRemove(index);
              setSelected(Math.max(0, index - 1));
            }}
          >
            <Icon name="delete_icon" />
            {t('buttons.delete')}
          </button>
        </div>
        <div className="list-form">{children(index)}</div>
      </div>
    </section>
  );
}

export default function ModEditor({
  isCreating = true,
  initialConfig,
  initialAssets,
}) {
  const { t } = useTranslation(),
    navigate = useNavigate();
  const [config, setConfig] = useState(() =>
    structuredClone(initialConfig || createEmptyModConfig())
  );
  const [authorsText, setAuthorsText] = useState(() =>
    (initialConfig?.authors || []).join('\n')
  );
  const [relations, setRelations] = useState(() =>
    Object.fromEntries(
      ['dependencies', 'conflicts'].map((key) => [
        key,
        (initialConfig?.[key] || []).map(relationRow),
      ])
    )
  );
  const [helpSection, setHelpSection] = useState('metadata');
  const [assets, setAssets] = useState(() => initialAssets || emptyAssets());
  const [aliases, setAliases] = useState(() =>
    Object.entries(initialConfig?.placeholders || {}).map(([name, path]) => ({
      name,
      path,
    }))
  );
  const [tab, setTab] = useState('metadata'),
    [selected, setSelected] = useState(() =>
      firstOperation(initialConfig?.files || [])
    );
  const [packageIssues, setPackageIssues] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState(() => new Set());
  const [listSelections, setListSelections] = useState({
    placeholders: 0,
    dependencies: 0,
    conflicts: 0,
  });
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const [handoff, setHandoff] = useState(null),
    [savedPath, setSavedPath] = useState(''),
    [handoffError, setHandoffError] = useState('');
  const [preview, setPreview] = useState('');
  const [zipMembers, setZipMembers] = useState([]);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const toggleGroup = (name, open) =>
    setCollapsedGroups((previous) => {
      if (previous.has(name) === !open) return previous;
      const next = new Set(previous);
      if (open) next.delete(name);
      else next.add(name);
      return next;
    });
  const [groupName, setGroupName] = useState('');
  const fileInput = useRef(),
    folderInput = useRef(),
    iconInput = useRef(),
    sourceInput = useRef(),
    targetHashInput = useRef(),
    dialog = useRef();
  const panel = useRef(),
    scrollPositions = useRef({}),
    tabHover = useRef();
  useEffect(() => {
    const clear = () => clearTimeout(tabHover.current);
    window.addEventListener('drop', clear, true);
    window.addEventListener('dragend', clear, true);
    return () => {
      clear();
      window.removeEventListener('drop', clear, true);
      window.removeEventListener('dragend', clear, true);
    };
  }, []);
  const selectTab = (next) => {
    clearTimeout(tabHover.current);
    if (next !== tab)
      scrollPositions.current[tab] = panel.current?.scrollTop || 0;
    setTab(next);
  };
  useLayoutEffect(() => {
    if (panel.current)
      panel.current.scrollTop = scrollPositions.current[tab] || 0;
  }, [tab]);
  const canonical = useMemo(() => {
    const result = clean(config);
    delete result.placeholders;
    if (aliases.length)
      result.placeholders = Object.fromEntries(
        aliases.map(({ name, path }) => [name, path])
      );
    return result;
  }, [config, aliases]);
  const entry = selected ? operationAt(config.files, selected) : null;
  const group = entry && !('type' in entry) && !('source' in entry);
  const allGroups = useMemo(() => groupPaths(config.files), [config.files]);
  useEffect(() => {
    setGroupName(group ? Object.keys(entry)[0] : '');
  }, [selected, entry]);
  useNavigationGuard(
    () => !busy && (!dirty || window.confirm(t('dialogs.unsaved_changes_lost')))
  );
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => {
    const relative = localRelativePath(config.icon, canonical.placeholders),
      file = relative && assets.files[relative];
    let url = '';
    if (file)
      url = URL.createObjectURL(file instanceof Blob ? file : new Blob([file]));
    setPreview(
      url || (/^https?:\/\//.test(config.icon || '') ? config.icon : '')
    );
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [config.icon, canonical.placeholders, assets.files]);
  useEffect(() => {
    if (handoff) dialog.current?.showModal();
  }, [handoff]);
  const changed = () => {
    setDirty(true);
    setStatus('');
  };
  const update = (key, value) => {
    setConfig((previous) => ({ ...previous, [key]: value }));
    changed();
  };
  const editEntry = (callback) => {
    const files = structuredClone(config.files),
      list = operationList(files, selected.slice(0, -1));
    list[selected.at(-1)] = callback(list[selected.at(-1)]);
    update('files', files);
  };
  const updateEntry = (key, value) =>
    editEntry((previous) => {
      const next = { ...previous };
      if (value === '' && key.endsWith('_hash')) delete next[key];
      else next[key] = value;
      return next;
    });
  const setPath = (key, value) =>
    editEntry((previous) => ({
      ...previous,
      [key]: value,
      ...(previous[key + '_hash'] !== undefined ? { [key + '_hash']: '' } : {}),
    }));
  const renameGroup = () => {
    if (['source', 'type'].includes(groupName)) {
      setGroupName(Object.keys(entry)[0]);
      setStatus({ key: 'mce.reservedGroup' });
      return;
    }
    if (groupName !== Object.keys(entry)[0])
      editEntry((previous) => ({ [groupName]: Object.values(previous)[0] }));
  };
  const move = (source, destination, index) => {
    try {
      update('files', moveOperation(config.files, source, destination, index));
      setSelected(null);
      return true;
    } catch (error) {
      setStatus(error.message);
      return false;
    }
  };
  const addEntry = (isGroup) => {
    const files = structuredClone(config.files),
      parent = group ? selected : [];
    const list = operationList(files, parent);
    let name = t('ui.mod_editor_group');
    if (isGroup) {
      let counter = 1;
      while (allGroups.some((item) => item.name === `${name} ${counter}`))
        counter++;
      name += ` ${counter}`;
    }
    list.push(
      isGroup
        ? { [name]: [] }
        : { source: '', target: '${game_path}/data.win', type: 'patch' }
    );
    update('files', files);
    setSelected([...parent, list.length - 1]);
  };
  const removeEntry = () => {
    if (
      group &&
      Object.values(entry)[0].length &&
      !window.confirm(t('mce.removeGroupConfirm'))
    )
      return;
    const files = structuredClone(config.files);
    operationList(files, selected.slice(0, -1)).splice(selected.at(-1), 1);
    update('files', files);
    setSelected(null);
  };
  const addAssets = async (picked) => {
    const paths = Object.keys(picked.files);
    if (!paths.length && !picked.directories.length) return;
    if (paths.some((path) => /^mod_config\.json$/i.test(path)))
      throw new Error(t('mce.configReserved'));
    if (paths.some((path) => Object.hasOwn(assets.files, path)))
      throw new Error(t('mce.duplicateFiles'));
    const next = {
      files: Object.assign(Object.create(null), assets.files, picked.files),
      directories: [...new Set([...assets.directories, ...picked.directories])],
    };
    await validatePackage({ files: [] }, next, false);
    setAssets(next);
    changed();
  };
  const singleRoot = (picked) => {
    const path = packageRoot(picked);
    if (!path) throw new Error(t('mce.singleSource'));
    return path;
  };
  const singleFile = (picked) => {
    const paths = Object.keys(picked.files);
    if (paths.length !== 1 || picked.directories.length)
      throw new Error(t('mce.singleFile'));
    return paths[0];
  };
  const checkImage = (file, path) => {
    if (
      !file.type?.startsWith('image/') &&
      !/\.(png|jpe?g|gif|bmp|ico|webp|svg|avif|tiff?)$/i.test(path)
    )
      throw new Error(t('mce.imageOnly'));
  };
  const setDroppedSource = async (picked) => {
    const path = singleRoot(picked);
    await addAssets(picked);
    setPath('source', '${mod_path}/' + path);
  };
  const setDroppedIcon = async (picked) => {
    const path = singleFile(picked);
    checkImage(picked.files[path], path);
    await addAssets(picked);
    update('icon', '${mod_path}/' + path);
  };
  const packagePath = (path) => {
    if (
      !Object.hasOwn(assets.files, path) &&
      !assets.directories.includes(path)
    )
      throw new Error(t('mce.singleSource'));
    return '${mod_path}/' + path;
  };
  const hashFile = async (file, key) => {
    const bytes = await fileBytes(file),
      digest = await crypto.subtle.digest('SHA-256', bytes);
    editEntry((previous) => ({
      ...previous,
      [key]:
        'sha256:' +
        [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join(''),
    }));
  };
  const dropOptions = {
    disabled: busy,
    onError: setStatus,
    onBusyChange: setBusy,
  };
  const filesDrop = useFileDrop({ ...dropOptions, onDrop: addAssets });
  const sourceDrop = useFileDrop({
    ...dropOptions,
    disabled: busy || !entry || group,
    onDrop: setDroppedSource,
    onPath: (path) => setPath('source', packagePath(path)),
  });
  const iconDrop = useFileDrop({
    ...dropOptions,
    onDrop: setDroppedIcon,
    onUrl: (url) => {
      const issue = validateModConfig({
        ...createEmptyModConfig(),
        id: 'preview',
        name: 'Preview',
        icon: url,
      }).find((issue) => issue.path === 'icon');
      if (issue) throw new Error(issue.message);
      update('icon', url);
    },
    onPath: (path) => {
      packagePath(path);
      checkImage(assets.files[path] || {}, path);
      update('icon', packagePath(path));
    },
  });
  const setDroppedHash = async (picked, key) => {
    const path = singleRoot(picked);
    const hash = await hashPackagePath('${mod_path}/' + path, picked);
    editEntry((previous) => ({ ...previous, [key]: hash }));
  };
  const setPackageHash = async (path, key) => {
    const hash = await hashPackagePath(packagePath(path), assets);
    editEntry((previous) => ({ ...previous, [key]: hash }));
  };
  const sourceHashDrop = useFileDrop({
    ...dropOptions,
    disabled: busy || !entry || group,
    onDrop: (picked) => setDroppedHash(picked, 'source_hash'),
    onPath: (path) => setPackageHash(path, 'source_hash'),
  });
  const targetHashDrop = useFileDrop({
    ...dropOptions,
    disabled: busy || !entry || group || entry.type === 'info',
    onDrop: (picked) => setDroppedHash(picked, 'target_hash'),
    onPath: (path) => setPackageHash(path, 'target_hash'),
  });
  const aliasDrop = useFileDrop({
    ...dropOptions,
    disabled: busy || !aliases.length,
    onDrop: async (picked) => {
      const path = singleRoot(picked);
      await addAssets(picked);
      aliasChange(
        Math.min(listSelections.placeholders, aliases.length - 1),
        'path',
        '${mod_path}/' + path
      );
    },
    onPath: (path) =>
      aliasChange(
        Math.min(listSelections.placeholders, aliases.length - 1),
        'path',
        packagePath(path)
      ),
  });
  const addFiles = async (event, icon = false, source = false) => {
    const picked = [...(event.target.files || [])];
    event.target.value = '';
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      const incoming = assetsFromFiles(picked);
      await (icon
        ? setDroppedIcon(incoming)
        : source
          ? setDroppedSource(incoming)
          : addAssets(incoming));
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };
  const removeFile = (path) => {
    // Empty folders can still be sources of operations and part of folder hashes.
    if (!window.confirm(t('mce.removeFileConfirm', { path }))) return;
    const files = { ...assets.files };
    delete files[path];
    setAssets({ ...assets, files });
    changed();
  };
  const aliasChange = (index, key, value) => {
    setAliases((previous) =>
      previous.map((row, position) =>
        position === index ? { ...row, [key]: value } : row
      )
    );
    changed();
  };
  const changeRelations = (key, rows) => {
    setRelations((previous) => ({ ...previous, [key]: rows }));
    update(
      key,
      rows.map(({ id, mode }) =>
        normalizeRelation(id + (mode ? ':' + mode : ''))
      )
    );
  };
  const schemaIssues = useMemo(() => {
    const errors = validateModConfig(canonical).filter(
      (issue) => !issue.path.startsWith('placeholders.')
    );
    aliases.forEach((row, index) => {
      const aliasErrors = validateModConfig({
        ...canonical,
        files: [],
        placeholders: { [row.name]: row.path },
      }).filter((issue) => issue.path.startsWith('placeholders.'));
      errors.push(...aliasErrors.map((issue) => ({ ...issue, index })));
      if (
        aliases.some(
          (other, position) =>
            position < index &&
            other.name.toLowerCase() === row.name.toLowerCase()
        )
      )
        errors.push({
          path: `placeholders.${row.name}`,
          message: t('ui.mod_editor_placeholder_name_taken'),
          field: 'name',
          index,
        });
    });
    return errors;
  }, [canonical, aliases, t]);
  const locateIssue = (issue) => {
    if (issue.path.startsWith('files')) {
      let match = { tab: 'files', id: 'package-files' };
      const visit = (files, prefix = 'files', parent = []) =>
        files.forEach((item, index) => {
          const key = `${prefix}[${index}]`,
            path = [...parent, index];
          const isGroup = !('source' in item) && !('type' in item);
          if (issue.path === key || issue.path.startsWith(key + '.'))
            match = {
              tab: 'files',
              operation: path,
              id: isGroup
                ? 'group-name'
                : { type: 'operation-type' }[
                    issue.path.slice(key.length + 1)
                  ] ||
                  issue.path.slice(key.length + 1) ||
                  'source',
            };
          if (isGroup) {
            const [name, children] = Object.entries(item)[0];
            visit(children, `${key}.${name}`, path);
          }
        });
      visit(config.files);
      return match;
    }
    if (issue.path.startsWith('placeholders')) {
      const index =
        issue.index ??
        Math.max(
          0,
          aliases.findIndex((row) => issue.path === `placeholders.${row.name}`)
        );
      return {
        tab: 'placeholders',
        list: 'placeholders',
        index,
        id: `alias-${issue.field === 'name' ? '' : 'path-'}${index}`,
      };
    }
    const relation = /^(dependencies|conflicts)(?:\[(\d+)\])?/.exec(issue.path);
    if (relation) {
      const key = relation[1];
      const index =
        relation[2] === undefined
          ? Math.max(
              0,
              relations[key].findIndex((row) =>
                issue.message.startsWith(row.id + ' ')
              )
            )
          : Number(relation[2]);
      return { tab: 'compatibility', list: key, index, id: key };
    }
    return {
      tab: 'metadata',
      id:
        issue.path === 'game' && !games.includes(config.game)
          ? 'custom-game'
          : issue.path.split('[')[0],
    };
  };
  const issues = [...schemaIssues, ...packageIssues];
  const locations = issues.map(locateIssue);
  const visibleIssues = submitted
    ? issues
    : issues.filter((issue, index) => touched.has(locations[index].id));
  const visibleLocations = visibleIssues.map(locateIssue);
  const fieldErrors = {};
  for (const issue of visibleIssues) {
    const location = locateIssue(issue);
    if (
      (!location.operation || samePath(location.operation, selected)) &&
      (!location.list ||
        location.index ===
          Math.min(
            listSelections[location.list],
            (location.list === 'placeholders'
              ? aliases
              : relations[location.list]
            ).length - 1
          ))
    )
      fieldErrors[location.id] = [fieldErrors[location.id], issue.message]
        .filter(Boolean)
        .join(' ');
  }
  const showIssue = (issue) => {
    const location = locateIssue(issue);
    selectTab(location.tab);
    if (location.operation) {
      setSelected(location.operation);
      for (let depth = 1; depth < location.operation.length; depth++) {
        const ancestor = operationAt(
          config.files,
          location.operation.slice(0, depth)
        );
        toggleGroup(Object.keys(ancestor)[0], true);
      }
    }
    if (location.list)
      setListSelections((previous) => ({
        ...previous,
        [location.list]: location.index,
      }));
    requestAnimationFrame(() => {
      const field =
        document.getElementById(location.id) ||
        document.getElementById(`panel-${location.tab}`);
      field?.focus();
      field?.scrollIntoView({ block: 'nearest' });
    });
  };
  useEffect(() => {
    setPackageIssues([]);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        await validatePackage(canonical, assets, false);
      } catch (error) {
        if (!cancelled)
          setPackageIssues(
            error.issues || [{ path: 'files', message: error.message }]
          );
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canonical, assets]);
  const save = async (direct) => {
    setSubmitted(true);
    if (schemaIssues.length) {
      showIssue(schemaIssues[0]);
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const blob = await exportModArchive({ config: canonical, assets });
      const filename = `${config.id}-${config.version.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 64)}.zip`;
      setPackageIssues([]);
      setSubmitted(false);
      downloadZip(blob, filename);
      setDirty(false);
      setStatus({ key: 'mce.exported' });
      if (direct) {
        setSavedPath('');
        setHandoffError('');
        setHandoff(filename);
      }
    } catch (error) {
      const errors = error.issues || [
        { path: 'files', message: error.message },
      ];
      setPackageIssues(errors);
      showIssue(errors[0]);
    } finally {
      setBusy(false);
    }
  };
  const sourceOptions = [
    ...Object.keys(assets.files),
    ...assets.directories,
  ].map((path) => '${mod_path}/' + path);
  const browseZip = async (path) => {
    setBusy(true);
    setZipMembers([]);
    try {
      setZipMembers(await listPackageZipMembers(path, assets));
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };
  const changeType = (value) =>
    editEntry((previous) => {
      const next = { ...previous, type: value };
      if (value === 'info') {
        delete next.target;
        delete next.target_hash;
      } else {
        next.target ||= '${game_path}/data.win';
        if (value.endsWith('extract') && !next.target.endsWith('/'))
          next.target = '${game_path}/';
        if (next.target !== previous.target && next.target_hash !== undefined)
          next.target_hash = '';
      }
      return next;
    });
  const calculateSource = async () => {
    setBusy(true);
    try {
      updateEntry(
        'source_hash',
        await hashPackagePath(entry.source, assets, canonical.placeholders)
      );
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };
  const targetHash = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await hashFile(file, 'target_hash');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="g3m-page-shell">
      <section className="g3m-panel editor" {...filesDrop}>
        <header className="editor-heading">
          <h1>{t(isCreating ? 'ui.create_mod' : 'ui.edit_mod')}</h1>
        </header>
        <div
          className="g3m-tabbar"
          role="tablist"
          aria-label={t('mce.editorTabs')}
        >
          {tabs.map((name, index) => (
            <button
              key={name}
              id={`tab-${name}`}
              role="tab"
              aria-selected={tab === name}
              aria-controls={`panel-${name}`}
              tabIndex={tab === name ? 0 : -1}
              className={`${tab === name ? 'is-active' : ''} ${visibleLocations.some((location) => location.tab === name) ? 'is-invalid' : ''}`}
              onDragEnter={(event) => {
                if (
                  name !== tab &&
                  [...event.dataTransfer.types].some(
                    (type) => type === 'Files' || type === PACKAGE_PATH_TYPE
                  )
                ) {
                  clearTimeout(tabHover.current);
                  tabHover.current = setTimeout(() => selectTab(name), 350);
                }
              }}
              onDragLeave={() => clearTimeout(tabHover.current)}
              onDragOver={(event) => {
                if (
                  [...event.dataTransfer.types].some(
                    (type) => type === 'Files' || type === PACKAGE_PATH_TYPE
                  )
                )
                  event.preventDefault();
              }}
              onClick={() => selectTab(name)}
              onKeyDown={(event) => {
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : null;
                if (next !== null) {
                  event.preventDefault();
                  selectTab(tabs[next]);
                  document.getElementById(`tab-${tabs[next]}`).focus();
                }
              }}
            >
              {t(`ui.mod_editor_tab_${name}`)}
            </button>
          ))}
        </div>
        <div
          id={`panel-${tab}`}
          tabIndex={-1}
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          className="editor-content"
          ref={panel}
        >
          {' '}
          {submitted && issues.length > 0 && (
            <div tabIndex={-1} className="g3m-inline-error" role="alert">
              <strong>{t('dialogs.validation_error')}</strong>
              <ul>
                {issues.map((issue, index) => (
                  <li key={index}>
                    <button onClick={() => showIssue(issue)}>
                      {issue.path}: {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <FieldErrors.Provider value={{ errors: fieldErrors, onTouched: (id) => setTouched((previous) => new Set(previous).add(id)) }}>
            <fieldset className="editor-fields" disabled={busy}>
              {tab === 'metadata' && (
                <div className="metadata-grid">
                  <div className="game-row">
                    <Field
                      id="game"
                      label={t('ui.mod_type_label')}
                      as="select"
                      value={
                        games.includes(config.game) ? config.game : '__custom__'
                      }
                      onChange={(value) =>
                        update('game', value === '__custom__' ? '' : value)
                      }
                    >
                      {games.map((game) => (
                        <option key={game} value={game}>
                          {t(`ui.${game}`)}
                        </option>
                      ))}
                      <option value="__custom__">{t('ui.custom_game')}</option>
                    </Field>
                    {!games.includes(config.game) && (
                      <Field
                        id="custom-game"
                        label={t('ui.custom_game')}
                        value={config.game}
                        onChange={(value) => update('game', value)}
                        hint={t('mce.gameHint')}
                      />
                    )}
                  </div>
                  <Field
                    id="name"
                    label={t('ui.mod_name_label')}
                    value={config.name}
                    onChange={(value) => update('name', value)}
                  />
                  <Field
                    id="id"
                    label={t('mce.modId')}
                    value={config.id}
                    onChange={(value) => update('id', value)}
                    hint={t('mce.idHint')}
                  />
                  <Field
                    id="authors"
                    label={t('ui.mod_editor_authors')}
                    value={authorsText}
                    onChange={(value) => {
                      setAuthorsText(value);
                      update('authors', value.split('\n').filter(Boolean));
                    }}
                    multiline
                    hint={t('mce.onePerLine')}
                  />
                  <Field
                    id="description"
                    label={t('ui.description')}
                    value={config.description}
                    onChange={(value) => update('description', value)}
                    multiline
                  />
                  <Field
                    id="homepage"
                    label={t('ui.homepage')}
                    value={config.homepage}
                    onChange={(value) => update('homepage', value)}
                  />
                  <div
                    className="icon-field"
                    {...iconDrop}
                    title={t('mce.dropIcon')}
                  >
                    <Field
                      id="icon"
                      label={t('files.icon_label')}
                      value={config.icon}
                      onChange={(value) => update('icon', value)}
                      list="package-sources"
                      hint={t('editor.iconHint')}
                      adornment={
                        <button
                          className="icon-button"
                          aria-label={t('ui.select_icon_file')}
                          title={t('ui.select_icon_file')}
                          onClick={() => iconInput.current.click()}
                        >
                          <Icon name="folder_icon" />
                        </button>
                      }
                    />
                    <div className="icon-preview">
                      <img
                        src={preview || defaultIcon}
                        alt={t('ui.icon_preview')}
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.style.visibility = 'hidden';
                        }}
                        onLoad={(event) => {
                          event.currentTarget.style.visibility = 'visible';
                        }}
                      />
                    </div>
                  </div>
                  <fieldset
                    id="tags"
                    tabIndex={-1}
                    aria-invalid={fieldErrors.tags ? true : undefined}
                    className="tags"
                  >
                    <legend>{t('ui.mod_tags_label')}</legend>
                    {MOD_ALLOWED_TAGS.map((tag) => (
                      <label key={tag}>
                        <input
                          type="checkbox"
                          checked={config.tags?.includes(tag) || false}
                          onChange={(event) =>
                            update(
                              'tags',
                              event.target.checked
                                ? [...(config.tags || []), tag]
                                : config.tags.filter((value) => value !== tag)
                            )
                          }
                        />
                        {tag === 'CYOP/AFOM'
                          ? tag
                          : t(`tags.${tag}_text`, { defaultValue: tag })}
                      </label>
                    ))}
                  </fieldset>

                  <Field
                    id="version"
                    label={t('ui.overall_mod_version')}
                    value={config.version}
                    onChange={(value) => update('version', value)}
                  />
                  <Field
                    id="game_version"
                    label={t('ui.game_version_label')}
                    value={config.game_version}
                    onChange={(value) => update('game_version', value)}
                  />
                </div>
              )}
              {tab === 'files' && (
                <>
                  <p className="editor-hint">{t('ui.mod_editor_files_hint')}</p>
                  <div className="button-row operation-actions">
                    <button onClick={() => addEntry(false)}>
                      <Icon name="add_icon" />
                      {t('mce.addOperation')}
                    </button>
                    <button onClick={() => addEntry(true)}>
                      <Icon name="folder_icon" />
                      {t('ui.mod_editor_add_group')}
                    </button>
                    <button onClick={removeEntry} disabled={!entry}>
                      <Icon name="delete_icon" />
                      {t('buttons.delete')}
                    </button>
                  </div>
                  <div className="file-workspace">
                    <section className="operations editor-pane">
                      <h2 className="pane-title">
                        {t('ui.mod_editor_processing_order')}
                      </h2>
                      <div id="files" tabIndex={-1}>
                        <OperationTree
                          files={config.files}
                          selected={selected}
                          select={setSelected}
                          move={move}
                          collapsed={collapsedGroups}
                          toggleGroup={toggleGroup}
                          invalidPaths={locations
                            .filter((location) => location.operation)
                            .map((location) => location.operation)}
                        />
                      </div>
                      {!config.files.length && <p>{t('mce.noOperations')}</p>}
                    </section>
                    <section className="editor-pane">
                      <h2 className="pane-title">
                        {t(
                          group
                            ? 'ui.mod_editor_group'
                            : 'ui.mod_editor_operation'
                        )}
                      </h2>
                      <div className="operation-form">
                        {!entry ? (
                          <p>{t('mce.selectOperation')}</p>
                        ) : (
                          <>
                            {group ? (
                              <Field
                                id="group-name"
                                label={t('ui.mod_editor_group_name')}
                                value={groupName}
                                onChange={(value) => {
                                  setGroupName(value);
                                  changed();
                                }}
                                onBlur={renameGroup}
                              />
                            ) : (
                              <>
                                <Field
                                  id="operation-type"
                                  label={t('ui.mod_editor_type')}
                                  as="select"
                                  value={entry.type}
                                  onChange={changeType}
                                  adornment={
                                    <Icon
                                      name={operationIcon(entry.type)}
                                      className={operationColor(entry.type)}
                                    />
                                  }
                                >
                                  {OPERATION_TYPES.map((type) => (
                                    <option key={type} value={type}>
                                      {t(
                                        'ui.mod_editor_type_' +
                                          type.replaceAll('-', '_')
                                      )}
                                    </option>
                                  ))}
                                </Field>
                                <label className="hash-toggle">
                                  <input
                                    type="checkbox"
                                    checked={entry.source_hash !== undefined}
                                    onChange={(event) =>
                                      event.target.checked
                                        ? editEntry((previous) => ({
                                            ...previous,
                                            source_hash: '',
                                          }))
                                        : updateEntry('source_hash', '')
                                    }
                                  />
                                  {t('ui.mod_editor_include_source_hash')}
                                </label>
                                <Field
                                  id="source"
                                  dropProps={sourceDrop}
                                  hint={t('mce.dropSource')}
                                  label={t('ui.mod_editor_source')}
                                  value={entry.source}
                                  list="package-sources"
                                  onChange={(value) => setPath('source', value)}
                                  adornment={
                                    <button
                                      className="icon-button"
                                      title={t('ui.mod_editor_source')}
                                      aria-label={`${t('ui.mod_editor_source')}: ${t('ui.add_files')}`}
                                      onClick={() =>
                                        sourceInput.current.click()
                                      }
                                    >
                                      <Icon name="folder_icon" />
                                    </button>
                                  }
                                />
                                {entry.source_hash !== undefined && (
                                  <>
                                    <Field
                                      id="source_hash"
                                      dropProps={sourceHashDrop}
                                      hint={t('mce.dropHash')}
                                      label={t('ui.mod_editor_source_hash')}
                                      value={entry.source_hash}
                                      onChange={(value) =>
                                        editEntry((previous) => ({
                                          ...previous,
                                          source_hash: value,
                                        }))
                                      }
                                    />
                                    <button
                                      onClick={calculateSource}
                                      disabled={busy}
                                    >
                                      {t('mce.calculateHash')}
                                    </button>
                                  </>
                                )}
                                {Object.keys(assets.files).some((path) =>
                                  /\.zip$/i.test(path)
                                ) && (
                                  <Field
                                    id="browse-zip"
                                    label={t('mce.browseZip')}
                                    as="select"
                                    value=""
                                    onChange={(value) => {
                                      if (value) browseZip(value);
                                    }}
                                  >
                                    <option value="">
                                      {t('mce.chooseZip')}
                                    </option>
                                    {Object.keys(assets.files)
                                      .filter((path) => /\.zip$/i.test(path))
                                      .map((path) => (
                                        <option key={path} value={path}>
                                          {path}
                                        </option>
                                      ))}
                                  </Field>
                                )}
                                {zipMembers.length > 0 && (
                                  <Field
                                    id="zip-member"
                                    label={t('mce.zipMember')}
                                    as="select"
                                    value=""
                                    onChange={(value) => {
                                      if (value) {
                                        setPath(
                                          'source',
                                          '${mod_path}/' + value
                                        );
                                        setZipMembers([]);
                                      }
                                    }}
                                  >
                                    <option value="">
                                      {t('mce.chooseMember')}
                                    </option>
                                    {zipMembers.map((path) => (
                                      <option key={path} value={path}>
                                        {path}
                                      </option>
                                    ))}
                                  </Field>
                                )}

                                {entry.type !== 'info' && (
                                  <>
                                    <label className="hash-toggle">
                                      <input
                                        type="checkbox"
                                        checked={
                                          entry.target_hash !== undefined
                                        }
                                        onChange={(event) =>
                                          event.target.checked
                                            ? editEntry((previous) => ({
                                                ...previous,
                                                target_hash: '',
                                              }))
                                            : updateEntry('target_hash', '')
                                        }
                                      />
                                      {t('ui.mod_editor_include_target_hash')}
                                    </label>
                                    <Field
                                      id="target"
                                      label={t('ui.mod_editor_target')}
                                      value={entry.target}
                                      onChange={(value) =>
                                        setPath('target', value)
                                      }
                                      hint={t('mce.targetHint')}
                                    />
                                    {entry.target_hash !== undefined && (
                                      <>
                                        <Field
                                          id="target_hash"
                                          dropProps={targetHashDrop}
                                          hint={t('mce.dropHash')}
                                          label={t('ui.mod_editor_target_hash')}
                                          value={entry.target_hash}
                                          onChange={(value) =>
                                            editEntry((previous) => ({
                                              ...previous,
                                              target_hash: value,
                                            }))
                                          }
                                        />
                                        <button
                                          onClick={() =>
                                            targetHashInput.current.click()
                                          }
                                          disabled={busy}
                                        >
                                          {t('mce.targetHashFile')}
                                        </button>
                                      </>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                            <Field
                              id="move-to-group"
                              label={t('mce.moveToGroup')}
                              as="select"
                              value=""
                              onChange={(value) => {
                                if (value) move(selected, JSON.parse(value));
                              }}
                            >
                              <option value="">{t('mce.selectGroup')}</option>
                              <option value="[]">{t('mce.root')}</option>
                              {allGroups
                                .filter(
                                  (item) =>
                                    !selected.every(
                                      (part, index) => item.path[index] === part
                                    )
                                )
                                .map((item) => (
                                  <option
                                    key={JSON.stringify(item.path)}
                                    value={JSON.stringify(item.path)}
                                  >
                                    {item.name}
                                  </option>
                                ))}
                            </Field>
                            <div className="button-row">
                              <button
                                aria-label={t('mce.moveUp')}
                                disabled={selected.at(-1) === 0}
                                onClick={() => {
                                  const index = selected.at(-1);
                                  if (
                                    move(
                                      selected,
                                      selected.slice(0, -1),
                                      index - 1
                                    )
                                  ) {
                                    setSelected([
                                      ...selected.slice(0, -1),
                                      index - 1,
                                    ]);
                                  }
                                }}
                              >
                                <Icon name="arrow_up" />
                              </button>
                              <button
                                aria-label={t('mce.moveDown')}
                                disabled={
                                  selected.at(-1) >=
                                  operationList(
                                    config.files,
                                    selected.slice(0, -1)
                                  ).length -
                                    1
                                }
                                onClick={() => {
                                  const index = selected.at(-1);
                                  if (
                                    move(
                                      selected,
                                      selected.slice(0, -1),
                                      index + 1
                                    )
                                  ) {
                                    setSelected([
                                      ...selected.slice(0, -1),
                                      index + 1,
                                    ]);
                                  }
                                }}
                              >
                                <Icon name="arrow_down" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </section>
                  </div>
                </>
              )}
              {tab === 'placeholders' && (
                <section id="placeholders" tabIndex={-1}>
                  <p className="editor-hint">
                    {t('ui.mod_editor_custom_placeholders_hint')}
                  </p>
                  <ListPane
                    invalidRows={locations
                      .filter((location) => location.list === 'placeholders')
                      .map((location) => location.index)}
                    selected={listSelections.placeholders}
                    setSelected={(index) =>
                      setListSelections((previous) => ({
                        ...previous,
                        placeholders: index,
                      }))
                    }
                    headers={[
                      t('ui.mod_editor_placeholder_name'),
                      t('ui.mod_editor_placeholder_path'),
                    ]}
                    rows={aliases.map(({ name, path }) => [name, path])}
                    onAdd={() => {
                      setAliases((previous) => [
                        ...previous,
                        { name: '', path: '${mod_path}/assets' },
                      ]);
                      changed();
                    }}
                    onRemove={(index) => {
                      setAliases((previous) =>
                        previous.filter((_, position) => position !== index)
                      );
                      changed();
                    }}
                  >
                    {(index) => (
                      <>
                        <Field
                          id={`alias-${index}`}
                          label={t('ui.mod_editor_placeholder_name')}
                          value={aliases[index]?.name}
                          disabled={index < 0}
                          onChange={(value) =>
                            aliasChange(index, 'name', value)
                          }
                        />
                        <Field
                          id={`alias-path-${index}`}
                          dropProps={aliasDrop}
                          hint={t('mce.dropSource')}
                          label={t('ui.mod_editor_placeholder_path')}
                          value={aliases[index]?.path}
                          disabled={index < 0}
                          onChange={(value) =>
                            aliasChange(index, 'path', value)
                          }
                        />
                      </>
                    )}
                  </ListPane>
                  <details className="builtin-help">
                    <summary>
                      {t('ui.mod_editor_help_placeholders_title')}
                    </summary>
                    <dl className="builtins">
                      {BUILTIN_PATHS.map((name) => (
                        <div key={name}>
                          <dt>
                            <code>{'${' + name + '}'}</code>
                          </dt>
                          <dd>{t(`mce.path_${name}`)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </section>
              )}
              {tab === 'compatibility' && (
                <section>
                  <p className="editor-hint">
                    {t('ui.mod_editor_compatibility_hint')}
                  </p>
                  <div className="compatibility-grid">
                    {['dependencies', 'conflicts'].map((key) => (
                      <ListPane
                        key={key}
                        invalidRows={locations
                          .filter((location) => location.list === key)
                          .map((location) => location.index)}
                        selected={listSelections[key]}
                        setSelected={(index) =>
                          setListSelections((previous) => ({
                            ...previous,
                            [key]: index,
                          }))
                        }
                        title={t(`ui.mod_editor_${key}`)}
                        headers={[
                          t('ui.mod_editor_relation_mod_id'),
                          t('ui.mod_editor_relation_order'),
                        ]}
                        rows={relations[key].map(({ id, mode }) => [
                          id,
                          t(relationModeKey(mode)),
                        ])}
                        onAdd={() =>
                          changeRelations(key, [
                            ...relations[key],
                            { id: '', mode: '' },
                          ])
                        }
                        onRemove={(index) =>
                          changeRelations(
                            key,
                            relations[key].filter(
                              (_, position) => position !== index
                            )
                          )
                        }
                      >
                        {(index) => (
                          <>
                            <Field
                              id={key}
                              label={t('ui.mod_editor_relation_mod_id')}
                              disabled={index < 0}
                              value={relations[key][index]?.id}
                              onChange={(value) =>
                                changeRelations(
                                  key,
                                  relations[key].map((row, position) =>
                                    position === index
                                      ? { ...row, id: value }
                                      : row
                                  )
                                )
                              }
                              onBlur={() => {
                                if (index >= 0)
                                  changeRelations(
                                    key,
                                    relations[key].map((row, position) =>
                                      position === index
                                        ? relationRow(
                                            normalizeRelation(row.id) +
                                              (row.mode ? ':' + row.mode : '')
                                          )
                                        : row
                                    )
                                  );
                              }}
                            />
                            <Field
                              id={`${key}-order`}
                              label={t('ui.mod_editor_relation_order')}
                              as="select"
                              disabled={index < 0}
                              value={relations[key][index]?.mode || ''}
                              onChange={(value) =>
                                changeRelations(
                                  key,
                                  relations[key].map((row, position) =>
                                    position === index
                                      ? { ...row, mode: value }
                                      : row
                                  )
                                )
                              }
                            >
                              {['', ...RELATION_MODES].map((mode) => (
                                <option key={mode} value={mode}>
                                  {t(relationModeKey(mode))}
                                </option>
                              ))}
                            </Field>
                          </>
                        )}
                      </ListPane>
                    ))}
                  </div>
                </section>
              )}
              {tab === 'help' && (
                <section className="editor-help">
                  <p>{t('mce.browserLimits')}</p>
                  <div
                    className="g3m-tabbar help-tabbar"
                    role="group"
                    aria-label={t('ui.mod_editor_tab_help')}
                  >
                    {helpSections.map((section) => (
                      <button
                        key={section}
                        aria-pressed={helpSection === section}
                        className={helpSection === section ? 'is-active' : ''}
                        onClick={() => setHelpSection(section)}
                      >
                        {t(`ui.mod_editor_help_${section}_title`)}
                      </button>
                    ))}
                  </div>
                  <div
                    className="help-body"
                    dangerouslySetInnerHTML={{
                      __html: t(`ui.mod_editor_help_${helpSection}_body`),
                    }}
                  />
                  <details>
                    <summary>{t('mce.configPreview')}</summary>
                    <pre>{JSON.stringify(canonical, null, 2)}</pre>
                  </details>
                </section>
              )}
              {/* Keep the dragged file mounted while hovering another tab. */}
              <section
                hidden={tab !== 'files'}
                id="package-files"
                tabIndex={-1}
                className={`package-files ${fieldErrors['package-files'] ? 'is-invalid' : ''}`}
              >
                <h2>{t('mce.bundledFiles')}</h2>
                <p>
                  {t('mce.bundleHint')} {t('mce.dropFiles')}
                </p>
                <div className="button-row">
                  <button
                    onClick={() => fileInput.current.click()}
                    disabled={busy}
                  >
                    <Icon name="add_icon" />
                    {t('ui.add_files')}
                  </button>
                  <button
                    onClick={() => folderInput.current.click()}
                    disabled={busy}
                  >
                    <Icon name="folder_icon" />
                    {t('editor.addFolder')}
                  </button>
                </div>
                <ul>
                  {Object.keys(assets.files).map((path) => (
                    <li
                      key={path}
                      draggable
                      title={t('mce.dragFile')}
                      onDragStart={(event) => {
                        event.stopPropagation();
                        event.dataTransfer.effectAllowed = 'copy';
                        event.dataTransfer.setData(PACKAGE_PATH_TYPE, path);
                      }}
                    >
                      <code>{path}</code>
                      <button
                        aria-label={`${t('buttons.delete')}: ${path}`}
                        onClick={() => removeFile(path)}
                        disabled={busy}
                      >
                        {t('buttons.delete')}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </fieldset>
          </FieldErrors.Provider>
        </div>
        <p
          className={"editor-status" + (status ? "" : " is-empty")}
          role="status"
        >
          {status ? (typeof status === "string" ? status : t(status.key)) : '\u00a0'}
        </p>
        <footer className="g3m-editor__footer-actions">
          <button onClick={() => navigate('/')} disabled={busy}>
            <Icon name="cross_icon" />
            {t('ui.cancel_button')}
          </button>
          <button onClick={() => save(false)} disabled={busy}>
            <Icon name="save_icon" />
            <span className="button-label">
              <span
                aria-hidden={busy}
                style={{ visibility: busy ? 'hidden' : 'visible' }}
              >
                {t('mce.saveZip')}
              </span>
              <span
                aria-hidden={!busy}
                style={{ visibility: busy ? 'visible' : 'hidden' }}
              >
                {t('status.loading')}
              </span>
            </span>
          </button>
          <button
            className="primary"
            onClick={() => save(true)}
            disabled={busy}
          >
            <Icon name="export_icon" />
            {t('mce.exportToG3M')}
          </button>
        </footer>
        <input
          ref={fileInput}
          className="file-picker"
          type="file"
          multiple
          onChange={addFiles}
          aria-label={t('ui.add_files')}
        />
        <input
          ref={folderInput}
          className="file-picker"
          type="file"
          multiple
          webkitdirectory=""
          onChange={addFiles}
          aria-label={t('editor.addFolder')}
        />
        <input
          ref={iconInput}
          className="file-picker"
          type="file"
          accept="image/*"
          onChange={(event) => addFiles(event, true)}
          aria-label={t('ui.select_icon_file')}
        />
        <input
          ref={sourceInput}
          className="file-picker"
          type="file"
          onChange={(event) => addFiles(event, false, true)}
          aria-label={`${t('ui.mod_editor_source')} (${t('ui.add_files')})`}
        />
        <input
          ref={targetHashInput}
          className="file-picker"
          type="file"
          onChange={targetHash}
          aria-label={t('mce.targetHashFile')}
        />
        <datalist id="package-sources">
          {sourceOptions.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
        <dialog
          ref={dialog}
          onClose={() => setHandoff(null)}
          aria-labelledby="handoff-title"
        >
          <h2 id="handoff-title">{t('mce.exportToG3M')}</h2>
          <p>{t('mce.handoffHint', { filename: handoff })}</p>
          <FieldErrors.Provider value={{ errors: { 'saved-path': handoffError }, onTouched: () => {} }}>
            <Field
              id="saved-path"
              label={t('mce.savedPath')}
              value={savedPath}
              onChange={(value) => {
                setSavedPath(value);
                setHandoffError('');
              }}
              placeholder={`C:/Users/Name/Downloads/${handoff}`}
            />
          </FieldErrors.Provider>
          {handoffError && (
            <p role="alert" className="g3m-inline-error">
              {handoffError}
            </p>
          )}
          <div className="button-row">
            <button onClick={() => dialog.current.close()}>
              {t('buttons.close')}
            </button>
            <button
              onClick={() => {
                try {
                  const url = buildG3MLink(savedPath);
                  window.location.href = url;
                } catch {
                  setHandoffError(t('mce.invalidSavedPath'));
                  requestAnimationFrame(() =>
                    document.getElementById('saved-path')?.focus()
                  );
                }
              }}
            >
              {t('mce.openG3M')}
            </button>
          </div>
        </dialog>
      </section>
    </main>
  );
}

