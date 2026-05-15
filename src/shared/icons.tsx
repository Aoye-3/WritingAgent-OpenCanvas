export function BrandIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img">
      <path d="M6 4h12v16H6z" />
      <path d="M9 8h6M9 12h4M9 16h6" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4Z" />
    </svg>
  );
}

export function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9Z" />
    </svg>
  );
}

export function TaskIcon({ icon }: { icon: "pen" | "lines" | "mail" | "book" | "report" | "refresh" }) {
  const paths = {
    pen: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
    lines: <><path d="M4 6h16M4 12h10M4 18h13" /></>,
    mail: <><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></>,
    book: <><path d="M4 19.5V5a2 2 0 0 1 2-2h11v18H6a2 2 0 0 1-2-1.5Z" /><path d="M8 7h5M8 11h6" /></>,
    report: <><path d="M7 4h10l3 3v13H7z" /><path d="M17 4v4h4M10 12h7M10 16h5" /></>,
    refresh: <><path d="M3 12a9 9 0 0 1 15-6.7" /><path d="M18 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7" /><path d="M6 21v-5h5" /></>
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[icon]}</svg>;
}
