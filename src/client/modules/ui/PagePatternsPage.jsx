import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile, KPI_KINDS } from '../../platform/design/Kpi.jsx';
import { Card, CardGrid, Section } from '../../platform/design/Card.jsx';
import StatusBadge, { BADGE_VARIANTS } from '../../platform/design/StatusBadge.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { usePageTitle } from '../core/pages/ui.jsx';
import { useFlagOn } from '../../platform/shell/api.js';

// The UI v3 component gallery (part 166.2, FR-01): the page header, key-figure tiles, overview cards, sections, status badge variants, the empty
// state and the chart theme, each in the light, dark and high-contrast themes. The figures are the worked example of the design standard (a
// ₹ 2.43 Cr contract), not records of the company: the gallery reads nothing from the database.
const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['high-contrast', 'High contrast']];
const KIND_EXAMPLE = {
  money: { label: 'Certified to date', value: '₹ 2,43,00,000.00', amount: 24300000, trend: { previous: 21000000, better: 'up' } },
  quantity: { label: 'Concrete poured', value: '1,240.500', unit: 'm³' },
  count: { label: 'Bills waiting', value: 7, tone: 'warning' },
  percent: { label: 'Margin', value: '8.4', unit: '%', trend: { previous: 9.1, better: 'up' } },
  time: { label: 'Average days to certify', value: 18, unit: 'days', trend: { previous: 22, better: 'down' } },
  safety: { label: 'Days without injury', value: 146, tone: 'success' },
  quality: { label: 'Open NCRs', value: 3, tone: 'warning' },
  people: { label: 'Labour on site today', value: 312 },
  risk: { label: 'Claims near time bar', value: 2, tone: 'error' },
  capacity: { label: 'Batching plant use', value: '76', unit: '%' },
};
const CHART = { categories: ['Apr', 'May', 'Jun', 'Jul'], unit: 'Rs lakh', series: [{ name: 'Planned', values: [120, 180, 240, 310] }, { name: 'Billed', values: [100, 170, 205, 290] }, { name: 'Certified', values: [90, 150, 196, 260] }] };

function ThemePanel({ theme, label }) {
  return (
    <div className="theme-preview" data-theme={theme} data-testid={`patterns-${theme}`}>
      <strong>{label}</strong>
      <KpiRow label={`${label}: key figures`}>
        <KpiTile kind="money" {...KIND_EXAMPLE.money} />
        <KpiTile kind="risk" {...KIND_EXAMPLE.risk} to="/admin/design-system/patterns#cards" />
      </KpiRow>
      <Card title="Bills waiting for certification" subtitle="Older than 30 days" count={{ shown: 2, total: 7 }} viewAll="/admin/design-system/patterns#cards" level={3}>
        <ul><li><strong>RA-07</strong> · Tower B · <StatusBadge status="SUBMITTED" size="sm" /></li><li><strong>RA-06</strong> · Tower A · <StatusBadge status="OVERDUE" size="sm" /></li></ul>
      </Card>
      <p>{BADGE_VARIANTS.map((v) => <StatusBadge key={v} status="APPROVED" label={v} variant={v} />)}</p>
    </div>
  );
}

export default function PagePatternsPage() {
  usePageTitle('Page Patterns');
  const on = useFlagOn('ff.ui.p16602');
  return (
    <section aria-labelledby="pp-h" data-testid="page-patterns">
      <PageHeader
        id="pp-h" title="Page Patterns" status={<StatusBadge status={on ? 'APPROVED' : 'DRAFT'} label={on ? 'UI v3 on' : 'UI v3 off'} variant="solid" />}
        subtitle="The shared building blocks of every page (part 166.2): use them instead of writing a heading, a tile or a card of your own."
        facts={[{ label: 'Patterns', value: 'List report, object page, form, overview page' }, { label: 'Feature flag', value: <code>ff.ui.p16602</code> }, { label: 'Lint rules', value: <><code>erp/page-header-required</code>, <code>erp/kpi-in-form-grid</code></> }]}
        actions={<a className="btn btn-primary" href="#kpi">Key figures</a>} secondary={<a className="btn" href="#cards">Cards</a>}
        menu={[{ label: 'Status badges', onClick: () => { window.location.hash = 'badges'; } }, { label: 'Charts', onClick: () => { window.location.hash = 'charts'; } }]}
      />

      <Section title="Page header" description="Title, status, subtitle, key facts, the primary and secondary actions and a … menu, as at the top of this page. The heading keeps the id the page gives it.">
        <pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><code>{'<PageHeader id="cb-h" title={t(\'cb.title\')} subtitle={t(\'cb.intro\')} status={<StatusBadge …/>}\n  facts={[{ label, value }]} actions={<button …/>} menu={[{ label, onClick }]} />'}</code></pre>
      </Section>

      <Section title="Key figures" testid="pp-kpi" description="One tile per figure: an icon for its kind, the label above the value, a unit, a trend against the previous period and a link to the list behind it. A rupee figure of a lakh or more is shortened (₹ 2.43 Cr); the exact amount is in the tooltip and read out by a screen reader.">
        <span id="kpi" />
        <KpiRow label="Every kind of key figure">{KPI_KINDS.map((k) => <KpiTile key={k} kind={k} {...KIND_EXAMPLE[k]} testid={`pp-kpi-${k}`} />)}</KpiRow>
      </Section>

      <span id="cards" />
      <h2>Overview cards</h2>
      <CardGrid testid="pp-cards">
        <Card title="Top bills by value" subtitle="This month" count={{ shown: 3, total: 12 }} viewAll="/bill/client-bills">
          <ol><li><strong>RA-07</strong> ₹ 1.20 Cr</li><li><strong>RA-06</strong> ₹ 84.10 L</li><li><strong>RA-05</strong> ₹ 62.00 L</li></ol>
        </Card>
        <Card title="Billing against plan" subtitle="₹ lakh, cumulative"><Chart type="line" data={CHART} title="Billing against plan" exportName="billing-against-plan" /></Card>
        <Card title="Nothing to show" subtitle="An empty card"><EmptyState compact title="No bills waiting" message="Bills that wait for certification appear here." /></Card>
      </CardGrid>

      <Section title="Status badges" description="Soft is the default; solid for the main status of a header, outline in a dense table, dot on a phone card." testid="pp-badges">
        <span id="badges" />
        {['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'].map((s) => <p key={s}>{BADGE_VARIANTS.map((v) => <span key={v}><StatusBadge status={s} variant={v} /> </span>)}<StatusBadge status={s} size="sm" /></p>)}
      </Section>

      <Section title="Chart theme" description="Eight series colours (--ui-c1 … --ui-c8, from the design tokens), the legend below the chart, numbers the Indian way, and an empty state when there is nothing to draw." testid="pp-charts">
        <span id="charts" />
        <Chart type="bar" data={CHART} title="Billing by month" exportName="billing-by-month" />
        <Chart type="bar" data={{ categories: [], series: [] }} title="Billing by month" />
      </Section>

      <h2>Themes</h2>
      <div className="theme-previews">{THEMES.map(([v, l]) => <ThemePanel key={v} theme={v} label={l} />)}</div>
    </section>
  );
}
