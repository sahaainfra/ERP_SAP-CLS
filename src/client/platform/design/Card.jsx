import { useId } from 'react';
import { navigateTo } from '../../modules/core/pages/ui.jsx';

// Cards and sections (part 166.2, U-03; UI v3 standard §3, overview page; the Fiori overview cards of the references R07–R09, R14, R15, R19).
// A Card is one widget of a dashboard: a title, a subtitle, "n of N" when it shows the top of a longer list, a menu, the body and a footer
// "View all ›" that opens the full list with the dashboard's filters. A Section is a titled block of a form or an object page.

/**
 * `<Card title="Bills waiting" subtitle="Older than 30 days" count={{ shown: 5, total: 23 }} viewAll="/bill/client-bills?status=SENT">…</Card>`.
 * `menu` is a node (a small button row) shown at the top right; `footer` replaces the "View all" link; `level` is the heading level (2).
 */
export function Card({ title, subtitle, count, menu, footer, viewAll, viewAllLabel = 'View all', level = 2, testid, className = '', children, as: Tag = 'section', ...rest }) {
  const id = useId();
  const H = `h${level}`;
  const hasHead = title || subtitle || menu || count;
  return (
    <Tag className={`mdm-panel ui-card ${className}`.trim()} aria-labelledby={title ? id : undefined} data-testid={testid} {...rest}>
      {hasHead && (
        <div className="ui-card-head">
          <div className="ui-card-titles">
            {title && <H id={id} className="ui-card-title">{title}</H>}
            {subtitle && <p className="muted small ui-card-subtitle">{subtitle}</p>}
          </div>
          {count && <span className="ui-card-count muted small" data-testid={testid ? `${testid}-count` : undefined}>{count.shown} of {count.total}</span>}
          {menu && <div className="ui-card-menu">{menu}</div>}
        </div>
      )}
      <div className="ui-card-body">{children}</div>
      {(footer || viewAll) && (
        <div className="ui-card-foot">
          {footer ?? <a href={viewAll} onClick={(e) => { e.preventDefault(); navigateTo(viewAll); }}>{viewAllLabel} <span aria-hidden="true">›</span></a>}
        </div>
      )}
    </Tag>
  );
}

/** The grid of cards of an overview page: one column on a phone, two on a tablet, three on a wide screen. */
export function CardGrid({ children, testid, className = '' }) {
  return <div className={`ui-card-grid ${className}`.trim()} data-testid={testid}>{children}</div>;
}

/** A titled section of a form or a record: a card with a level-2 heading and an optional description and actions. */
export function Section({ title, description, actions, testid, className = '', children, level = 2 }) {
  const id = useId();
  const H = `h${level}`;
  return (
    <section className={`ui-section ${className}`.trim()} aria-labelledby={title ? id : undefined} data-testid={testid}>
      {(title || actions) && (
        <div className="ui-section-head">
          {title && <H id={id}>{title}</H>}
          {actions && <div className="ui-section-actions">{actions}</div>}
        </div>
      )}
      {description && <p className="muted ui-section-desc">{description}</p>}
      {children}
    </section>
  );
}
