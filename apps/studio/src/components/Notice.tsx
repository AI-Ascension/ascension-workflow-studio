interface NoticeProps {
  tone?: "info" | "warning" | "danger" | "success";
  title: string;
  children: string;
}

export function Notice({ tone = "info", title, children }: NoticeProps): JSX.Element {
  return <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : "status"}>
    <strong>{title}</strong>
    <span>{children}</span>
  </div>;
}
