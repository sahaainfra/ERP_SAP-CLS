import { useEffect, useMemo, useState } from 'react';
import { DashboardGrid, FilterBar } from './Dashboard.jsx';
import { useCatalogue, useDashboard, useResetPersonal, useSavePersonal } from './api.js';
import { addWidget, sameLayout } from './layout.js';
import { datePresets } from '../list/state.js';
import { todayIst } from '../forms/dates.js';
import { useContextOptions } from '../shell/api.js';
import { Banner } from '../feedback/Feedback.jsx';
import { QueryState, errorInfo, navigateTo } from '../../modules/core/pages/ui.jsx';
import PageHeader from '../design/PageHeader.jsx';

/** The filters a dashboard opens with: what its layout saved, else this financial year, with the person's working project if they have one. */
const startFilters = (saved, selected) => ({ projectId: saved.projectId ?? selected?.projectId ?? null, siteId: saved.siteId ?? (saved.projectId ? null : selected?.siteId) ?? null, preset: saved.preset ?? 'this-fy', from: saved.from, to: saved.to });

/**
 * A dashboard of widgets for the signed-in person (part 03.07, FR-03/04/06): the filter bar, the grid, and "Customise" to arrange their own copy.
 * The copy is kept on the server, so it follows the person to any device (T-03); "Reset" gives it up for the default of their role.
 */
export default function DashboardView({ code, heading, crumb, intro }) {
  const dash = useDashboard(code);
  const cat = useCatalogue();
  const ctx = useContextOptions(true);
  const presets = useMemo(() => datePresets(todayIst()), []);
  const [filters, setFilters] = useState(null);
  const [draft, setDraft] = useState(null); // the layout being arranged; null when not customising
  const [message, setMessage] = useState(null);
  const save = useSavePersonal(code);
  const reset = useResetPersonal(code);

  useEffect(() => {
    if (dash.data && !ctx.isPending && !filters) setFilters(startFilters(dash.data.filters ?? {}, ctx.data?.selected));
  }, [dash.data, ctx.data, filters]);

  const pending = [dash, cat].find((q) => q.isPending || q.isError);
  if (pending) return <section aria-labelledby="page-title"><PageHeader id="page-title" title={heading} /><QueryState query={pending} what={heading} /></section>;
  if (!filters) return <section aria-labelledby="page-title"><PageHeader id="page-title" title={heading} /></section>;

  const view = dash.data;
  const layout = draft ?? view.layout;
  const dirty = draft !== null && !sameLayout(draft, view.layout);
  const incomplete = draft?.some((i) => i.widget === 'notice.text' && !i.params?.text?.trim());
  const drill = (to) => { navigateTo(to); };
  const doSave = async () => {
    setMessage(null);
    try {
      await save.mutateAsync({ layout: draft, filters: { ...(filters.projectId ? { projectId: filters.projectId } : {}), ...(filters.siteId ? { siteId: filters.siteId } : {}), preset: filters.preset, ...(filters.preset === 'custom' ? { from: filters.from, to: filters.to } : {}) }, ...(view.version ? { version: view.version } : {}) });
      setDraft(null);
      setMessage({ tone: 'success', text: 'Your layout is saved. It follows you to every device.' });
    } catch (err) {
      const info = errorInfo(err);
      setMessage({ tone: 'error', text: `${info.form}${info.correlationId ? ` (Correlation ID ${info.correlationId})` : ''}` });
    }
  };
  const doReset = async () => {
    if (!window.confirm('Go back to the default dashboard of your role? Your own arrangement will be removed.')) return;
    try { await reset.mutateAsync(); setDraft(null); setMessage({ tone: 'success', text: 'Your own layout is removed. You see the default of your role.' }); } catch (err) { setMessage({ tone: 'error', text: errorInfo(err).form }); }
  };
  const origin = { system: 'the standard layout', role: `the default of your role ${view.roleCode ?? ''}`.trim(), personal: 'your own layout' }[view.source];
  return (
    <section aria-labelledby="page-title" className="dash" data-testid="dashboard" data-source={view.source}>
      <PageHeader id="page-title" title={view.name ?? heading} crumb={crumb} subtitle={intro} actions={<>{draft === null ? (
          <>
            {view.hasPersonal && <button type="button" className="btn" onClick={doReset} disabled={reset.isPending}>Reset to default</button>}
            <button type="button" className="btn" onClick={() => { setDraft(view.layout); setMessage(null); }} data-testid="customise">Customise</button>
          </>
        ) : (
          <>
            <label className="dash-add">Add a widget
              <select value="" onChange={(e) => { const w = cat.data.find((c) => c.code === e.target.value); if (w) setDraft(addWidget(draft, w, w.paramsKey === 'notice.text' ? { text: '' } : w.paramsKey === 'requests.top' ? { limit: 5 } : {})); }} data-testid="add-widget">
                <option value="">Choose...</option>
                {cat.data.map((w) => <option key={w.code} value={w.code}>{w.title}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-primary" onClick={doSave} disabled={!dirty || incomplete || save.isPending} data-testid="save-layout">Save my layout</button>
            <button type="button" className="btn" onClick={() => { if (!dirty || window.confirm('Discard your changes to the layout?')) setDraft(null); }}>Cancel</button>
          </>
        )}</>} />
      {message && <Banner tone={message.tone === 'error' ? 'error' : 'success'} testId="dash-message" onClose={() => setMessage(null)}>{message.text}</Banner>}
      {view.omitted > 0 && <p className="muted small" data-testid="dash-omitted">{view.omitted} widget{view.omitted === 1 ? ' is' : 's are'} not shown because your role does not include what {view.omitted === 1 ? 'it needs' : 'they need'}.</p>}
      <p className="muted small" data-testid="dash-origin">Showing {origin}.{draft !== null ? ' Drag a widget by its title, or use the buttons on it, to arrange.' : ''}</p>
      <FilterBar filters={filters} onChange={setFilters} options={ctx.data} presets={presets} />
      {layout.length === 0
        ? <p className="muted" data-testid="dash-empty">This dashboard has no widgets. Choose Customise, then Add a widget.</p>
        : <DashboardGrid layout={layout} catalogue={cat.data} filters={filters} presets={presets} edit={draft !== null} onChange={setDraft} onDrill={drill} />}
    </section>
  );
}
