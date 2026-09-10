interface StatusBadgeProps {
  tone: "live" | "fixture" | "success" | "warning" | "danger" | "muted";
  children: string;
}

export function StatusBadge({ tone, children }: StatusBadgeProps): JSX.Element {
  return <span className={`status-badge status-${tone}`}><span aria-hidden="true" className="status-dot" />{children}</span>;
}
