const icons = import.meta.glob('../assets/icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

export default function Icon({ name, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`g3m-icon ${className}`}
      style={{ '--icon': `url("${icons[`../assets/icons/${name}.svg`]}")` }}
    />
  );
}
