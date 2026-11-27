import { useState } from 'react';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { hse } from './api.js';
import { ErrorLine, big, useRunner } from './HseParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Induction Content and Talk Topics (part 19.01): the library the inductions and toolbox talks draw on. Content carries the quiz (pass mark) and the days an induction stays valid; a used item is made inactive, not deleted.
const blankQ = { q: '', options: '', correct: 1 };
function ContentForm() {
  const t = useT('hse'); const { error, run, busy, note } = useRunner(); const [v, setV] = useState({ code: '', title: '', body: '', passPct: 70, validityDays: 365, quiz: [{ ...blankQ }] });
  const setQ = (i, k, val) => setV({ ...v, quiz: v.quiz.map((x, j) => (j === i ? { ...x, [k]: val } : x)) });
  const save = async () => { const quiz = v.quiz.filter((x) => x.q.trim()).map((x) => { const options = x.options.split('\n').map((s) => s.trim()).filter(Boolean); return { q: x.q, options, correct: Math.max(0, Number(x.correct) - 1) }; }); const r = await run(() => hse.make('/induction-content', { code: v.code, title: v.title, body: v.body, quiz, passPct: Number(v.passPct), validityDays: Number(v.validityDays) }), t('lib.contentSaved')); if (r) setV({ code: '', title: '', body: '', passPct: 70, validityDays: 365, quiz: [{ ...blankQ }] }); };
  return (
    <details className="mdm-panel no-print" data-testid="hse-content-form"><summary>{t('lib.newContent')}</summary><ErrorLine error={error} id="hse-lib-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-lib-note">{note}</p>}
      <div className="form-grid"><Field label={t('lib.code')} name="code" error={error}><input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} maxLength={40} style={big} data-testid="hse-ic-code" /></Field><Field label={t('lib.titleField')} name="title" error={error}><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={200} style={big} data-testid="hse-ic-title" /></Field>
        <Field label={t('lib.passPct')} name="passPct" error={error}><input type="number" min="0" max="100" value={v.passPct} onChange={(e) => setV({ ...v, passPct: e.target.value })} style={big} /></Field><Field label={t('lib.validity')} name="validityDays" error={error}><input type="number" min="1" max="3650" value={v.validityDays} onChange={(e) => setV({ ...v, validityDays: e.target.value })} style={big} /></Field></div>
      <Field label={t('lib.body')} name="body" error={error}><textarea rows={4} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} style={{ width: '100%' }} data-testid="hse-ic-body" /></Field>
      {v.quiz.map((x, i) => <div className="form-grid" key={i} data-testid="hse-ic-question"><Field label={t('lib.question', { n: i + 1 })} name={`q${i}`} error={error}><input value={x.q} onChange={(e) => setQ(i, 'q', e.target.value)} style={big} data-testid="hse-ic-q" /></Field><Field label={t('lib.options')} name={`o${i}`} error={error}><textarea rows={2} value={x.options} onChange={(e) => setQ(i, 'options', e.target.value)} data-testid="hse-ic-options" /></Field><Field label={t('lib.correct')} name={`k${i}`} error={error}><input type="number" min="1" max="6" value={x.correct} onChange={(e) => setQ(i, 'correct', e.target.value)} style={big} data-testid="hse-ic-correct" /></Field></div>)}
      <div className="actions-row"><button type="button" className="btn" onClick={() => setV({ ...v, quiz: [...v.quiz, { ...blankQ }] })} data-testid="hse-ic-add-q">{t('lib.addQuestion')}</button><button type="button" className="btn btn-primary" style={big} disabled={busy || v.code.trim().length < 2 || v.title.trim().length < 3 || v.body.trim().length < 3} onClick={save} data-testid="hse-ic-save">{t('save')}</button></div></details>
  );
}
function TopicForm() {
  const t = useT('hse'); const { error, run, busy, note } = useRunner(); const [v, setV] = useState({ code: '', title: '', category: '', frequency: 'WEEKLY', body: '' });
  return (
    <details className="mdm-panel no-print" data-testid="hse-topic-form"><summary>{t('lib.newTopic')}</summary><ErrorLine error={error} id="hse-topic-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-topic-note">{note}</p>}
      <div className="form-grid"><Field label={t('lib.code')} name="code" error={error}><input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} maxLength={40} style={big} data-testid="hse-tp-code" /></Field><Field label={t('lib.titleField')} name="title" error={error}><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={200} style={big} data-testid="hse-tp-title" /></Field>
        <Field label={t('lib.category')} name="category" error={error}><input value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} maxLength={60} style={big} /></Field>
        <Field label={t('lib.frequency')} name="frequency" error={error}><select value={v.frequency} onChange={(e) => setV({ ...v, frequency: e.target.value })} style={big}>{['DAILY', 'WEEKLY', 'AD_HOC'].map((f) => <option key={f} value={f}>{t(`freq.${f}`)}</option>)}</select></Field></div>
      <Field label={t('lib.body')} name="body" error={error}><textarea rows={3} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} style={{ width: '100%' }} data-testid="hse-tp-body" /></Field>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || v.code.trim().length < 2 || v.title.trim().length < 3} onClick={async () => { const r = await run(() => hse.make('/toolbox-topics', { code: v.code, title: v.title, category: v.category || null, frequency: v.frequency, body: v.body || null }), t('lib.topicSaved')); if (r) setV({ code: '', title: '', category: '', frequency: 'WEEKLY', body: '' }); }} data-testid="hse-tp-save">{t('save')}</button></div></details>
  );
}
export default function LibraryPage() {
  const t = useT('hse'); usePageTitle(t('lib.title')); const session = useSession();
  return (
    <section aria-labelledby="lib-h" data-testid="hse-library"><PageHeader id="lib-h" title={t('lib.title')} subtitle={<>{t('lib.intro')} <Link to="/hse/induction">{t('ind.title')}</Link> · <Link to="/hse/toolbox">{t('tbt.title')}</Link></>} />
      <h2>{t('lib.contentHeading')}</h2><ContentForm />
      <ListReport listCode="hse.induction_content" endpoint="/hse/induction-content" exportEndpoint="/ui/lists/hse.induction_content/export" title={t('lib.contentHeading')} session={session.data} cardFields={['code', 'title', 'passPct', 'status']} statusKey="status" empty={{ title: t('lib.emptyContentTitle'), text: t('lib.emptyContentBody') }} />
      <h2>{t('lib.topicHeading')}</h2><TopicForm />
      <ListReport listCode="hse.toolbox_topics" endpoint="/hse/toolbox-topics" exportEndpoint="/ui/lists/hse.toolbox_topics/export" title={t('lib.topicHeading')} session={session.data} cardFields={['code', 'title', 'frequency', 'status']} statusKey="status" empty={{ title: t('lib.emptyTopicTitle'), text: t('lib.emptyTopicBody') }} />
    </section>
  );
}
