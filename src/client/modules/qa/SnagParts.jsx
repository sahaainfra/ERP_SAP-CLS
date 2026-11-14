import { useT } from '../../platform/i18n/index.js';

// The plan with pins (part 18.06, FR-01): the drawing (an image when the drawing has one) under a grid, with a marker for each snag; a tap places the pin for a new one. A pin is kept as a share of the plan's width and height.
export const PLAN_STYLE = { position: 'relative', width: '100%', maxWidth: 640, aspectRatio: '4 / 3', border: '1px solid var(--erp-color-border-subtle)', background: 'var(--erp-color-bg-surface)', touchAction: 'manipulation', overflow: 'hidden' };
export function PlanPins({ fileId, pins = [], draft = null, onPick = null, label }) {
  const t = useT('qa');
  const pick = (ev) => { if (!onPick) return; const r = ev.currentTarget.getBoundingClientRect(); onPick({ x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) }); };
  const dot = (p, key, tone) => <span key={key} data-testid={tone === 'draft' ? 'plan-draft' : 'plan-pin'} data-x={p.x.toFixed(3)} data-y={p.y.toFixed(3)} title={p.label} style={{ position: 'absolute', left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: 18, height: 18, marginLeft: -9, marginTop: -9, borderRadius: '50%', background: tone === 'draft' ? 'var(--erp-color-status-info-solid)' : 'var(--erp-color-status-error-solid)', border: '2px solid var(--erp-color-bg-surface)' }} />;
  return (
    <div className="mdm-panel" role="group" aria-label={label ?? t('snag.plan')}>
      <div role={onPick ? 'button' : 'img'} tabIndex={onPick ? 0 : undefined} aria-label={onPick ? t('snag.tapPlan') : t('snag.plan')} data-testid="snag-plan" style={{ ...PLAN_STYLE, cursor: onPick ? 'crosshair' : 'default', backgroundImage: 'linear-gradient(var(--erp-color-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--erp-color-border-subtle) 1px, transparent 1px)', backgroundSize: '12.5% 12.5%' }} onClick={pick} onKeyDown={(e) => { if (onPick && (e.key === 'Enter' || e.key === ' ')) onPick({ x: 0.5, y: 0.5 }); }}>
        {fileId && <img src={`/api/v1/core/files/${fileId}/download`} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
        {pins.map((p, i) => dot(p, `p${i}`, 'pin'))}{draft && dot(draft, 'draft', 'draft')}
      </div>
    </div>
  );
}
