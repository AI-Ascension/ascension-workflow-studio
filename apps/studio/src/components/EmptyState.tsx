interface EmptyStateProps {
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ title, detail, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">⌁</div>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action ? <button className="button button-primary" onClick={action.onClick}>{action.label}</button> : null}
    </div>
  );
}
