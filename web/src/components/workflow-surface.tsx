import type { ComponentPropsWithoutRef, ReactNode } from "react";

type WorkflowSurfacePanelProps = ComponentPropsWithoutRef<"article">;
type WorkflowSectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
};

type WorkflowStatusRowProps = {
  label: string;
  value: ReactNode;
  testId?: string;
};

type WorkflowCalloutTone = "trust" | "degraded";

type WorkflowCalloutProps = {
  tone?: WorkflowCalloutTone;
  title?: string;
  children: ReactNode;
  testId?: string;
};

type WorkflowActionGroupProps = ComponentPropsWithoutRef<"div">;

type WorkflowFreshnessBannerProps = {
  title: string;
  body: string;
  detail?: string | null;
  testId?: string;
};

function joinClasses(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function WorkflowSurfacePanel({ className, children, ...rest }: WorkflowSurfacePanelProps) {
  return (
    <article className={joinClasses("panel stack-md workflow-surface-panel", className)} {...rest}>
      {children}
    </article>
  );
}

export function WorkflowSectionHeader({ eyebrow, title, description }: WorkflowSectionHeaderProps) {
  return (
    <header className="workflow-surface-header stack-sm">
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <h2>{title}</h2>
      {description ? <p className="status-text workflow-surface-description">{description}</p> : null}
    </header>
  );
}

export function WorkflowStatusRow({ label, value, testId }: WorkflowStatusRowProps) {
  return (
    <p className="status-text workflow-surface-status-row" data-testid={testId}>
      <span className="workflow-surface-status-label">{label}:</span>{" "}
      <span className="workflow-surface-status-value">{value}</span>
    </p>
  );
}

export function WorkflowCallout({ tone = "trust", title, children, testId }: WorkflowCalloutProps) {
  return (
    <section
      className={joinClasses("workflow-surface-callout stack-sm", `workflow-surface-callout--${tone}`)}
      data-testid={testId}
    >
      {title ? <h3 className="workflow-surface-callout-title">{title}</h3> : null}
      <div className="status-text">{children}</div>
    </section>
  );
}

export function WorkflowActionGroup({ className, children, ...rest }: WorkflowActionGroupProps) {
  return (
    <div className={joinClasses("stack-md workflow-surface-action-group", className)} {...rest}>
      {children}
    </div>
  );
}

export function WorkflowFreshnessBanner({
  title,
  body,
  detail,
  testId = "backend-freshness-banner",
}: WorkflowFreshnessBannerProps) {
  return (
    <article className="panel stack-sm" data-testid={testId}>
      <h2>{title}</h2>
      <p>{body}</p>
      {detail ? <p className="status-text">Backend detail: {detail}</p> : null}
    </article>
  );
}
