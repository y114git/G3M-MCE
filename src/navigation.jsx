import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
const NavigationContext = createContext(null);
const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '');
function readPath() {
  return window.location.hash.slice(1) || '/';
}
export function NavigationProvider({ children }) {
  const [path, setPath] = useState(readPath),
    guard = useRef(null),
    currentPath = useRef(path);
  useEffect(() => {
    const changed = () => {
      const next = readPath();
      if (next === currentPath.current) return;
      if (guard.current && !guard.current()) {
        window.history.pushState(
          null,
          '',
          `${basePath}/#${currentPath.current}`
        );
        return;
      }
      currentPath.current = next;
      setPath(next);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const navigate = useCallback((next) => {
    if (guard.current && !guard.current()) return;
    const normalized = next.startsWith('/') ? next : `/${next}`;
    window.history.pushState(null, '', `${basePath}/#${normalized}`);
    currentPath.current = normalized;
    setPath(normalized);
  }, []);
  const value = useMemo(() => ({ path, navigate, guard }), [path, navigate]);
  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}
function useNavigation() {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('NavigationProvider is missing');
  return value;
}
export function useCurrentPath() {
  return useNavigation().path;
}
export function useNavigate() {
  return useNavigation().navigate;
}
export function useNavigationGuard(callback) {
  const { guard } = useNavigation();
  useEffect(() => {
    guard.current = callback;
    return () => {
      guard.current = null;
    };
  }, [guard, callback]);
}
