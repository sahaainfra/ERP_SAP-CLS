import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { ROLE_TEMPLATES } from '../../platform/authz/templates.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport, zip } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { filesOf } from '../../platform/files/registry.js';
import { fileEntities } from '../../platform/files/entities.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { workflowTypes } from '../../platform/workflow/registry.js';
import { FIELD_ROLES } from '../../../shared/device/breakpoints.js';
import { toDocx, toPdf } from './docwriter.js';
import { CLIENT_MODULES, OWNER, pageCode, registeredPages } from './pageaudit.js';
import { PACKS } from './sandbox.js';

/**
 * Part 30.09: user manuals and the documentation package, made from the build itself.
 *
 *  - FR-01 BR-01 What a manual says comes from what the build has: the pages the client registers (route, label, Hindi label, permission,
 *    flag), the role templates (which pages a role can open, its responsibilities and authority), the workflow types (who approves what, in
 *    which order, within how many hours), the description of each page in the migration tracker, and what each screen shows (its title,
 *    tabs, actions and fields, read by Playwright from the running build). A page that is not registered cannot appear in a manual.
 *  - FR-01 Screens: `e2e/tst-manual-screens.spec.js` opens every registered page (desktop; field-role pages also at phone size), uploads
 *    a JPEG of it to the document service on the capture and posts the screen's signature; the manuals embed the captured images.
 *  - FR-03 Drift: a capture is compared with the accepted baseline; a screen whose signature changed (an action, tab, field or title added or
 *    removed) is CHANGED, a new page NEW, a page gone REMOVED, and every current manual that covers such a route becomes STALE until the
 *    package is generated again. The writer accepts the capture as the new baseline.
 *  - FR-02 FR-04 Guides (administrator, installation and start-up, API, import, reports, security, recovery), quick reference cards for the
 *    field roles (English and Hindi), and exercises on the simulation sandbox (30.04).
 *  - AC-01 A package is every manual as PDF and DOCX in one ZIP with a manifest (SHA-256 of each file and the build). Each manual is approved
 *    by its owner (the module's owner role, ADR-770) through the approval engine; a manual whose content did not change since its approved
 *    version keeps that approval. The package is APPROVED when all its manuals are.
 */
export const MAN_FLAG = 'ff.qa.p3009';
const APPROVAL_TYPE = 'man_manual_approval';
const PACKAGE_JOB = 'man.package.generate';
export const KINDS = ['ROLE', 'MODULE', 'GUIDE', 'QUICKREF', 'EXERCISES'];
export const GUIDES = ['admin', 'install', 'api', 'import', 'reports', 'security', 'recovery'];
const iso = (d = new Date()) => d.toISOString();
const sha = (b) => createHash('sha256').update(b).digest('hex');
/** @returns {any} */
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

integrityRegistry.register({ statuses: { man_captures: ['OPEN', 'COMPARED', 'ACCEPTED', 'SUPERSEDED'], man_packages: ['QUEUED', 'GENERATING', 'READY', 'FAILED', 'APPROVED', 'SUPERSEDED'], man_manuals: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'STALE', 'SUPERSEDED'] } });
for (const [type, description] of [
  ['man.capture.compared', 'A capture of the screens was compared with the accepted baseline (part 30.09 FR-03): data { captureId, changed, added, removed, staleManuals }.'],
  ['man.package.generated', 'A documentation package was generated (part 30.09): data { packageId, packageNo, buildId, manuals, files, status }.'],
  ['man.manual.approved', 'A manual was approved by its owner (part 30.09): data { manualId, code, versionNo, packageId }.'],
  ['man.package.approved', 'Every manual of a documentation package is approved (part 30.09 AC-01): data { packageId, packageNo, buildId }.'],
]) if (!eventTypes.get(type)) eventTypes.define({ type, version: 1, schema: { type: 'object' }, owner: 'tst', description });

if (!fileEntities.get('man_captures')) {
  // the screenshots of a capture are files of the document service, linked to the capture: the writer adds them while it is open
  fileEntities.register({ entity: 'man_captures', label: 'Documentation screen capture', resolve(db, actor, id) {
    const c = db.prepare('SELECT company_id, status FROM man_captures WHERE id = ? AND deleted_at IS NULL').get(Number(id));
    if (!c || c.company_id !== actor.companyId) return null;
    return { companyId: c.company_id, projectId: null, siteId: null, canView: hasPermissionAnywhere(actor, 'man.manual.view_all'), canEdit: c.status === 'OPEN' && hasPermissionAnywhere(actor, 'man.manual.generate'), locked: c.status !== 'OPEN' };
  } });
}

export const MODULE_NAMES = {
  core: ['Platform', 'प्लेटफ़ॉर्म'], iam: ['Users and access', 'उपयोगकर्ता और पहुँच'], ui: ['Workspace', 'कार्यक्षेत्र'], eng: ['Workflow and documents', 'वर्कफ़्लो और दस्तावेज़'], msg: ['Messages', 'संदेश'], pol: ['Policies', 'नीतियाँ'],
  mdm: ['Master data', 'मास्टर डेटा'], fin: ['Finance', 'वित्त'], hr: ['People', 'कर्मचारी'], bd: ['Business development', 'व्यवसाय विकास'], est: ['Estimation and tenders', 'अनुमान और निविदा'], proj: ['Projects', 'परियोजनाएँ'],
  engg: ['Engineering', 'इंजीनियरिंग'], bud: ['Budgets', 'बजट'], plan: ['Planning', 'योजना'], site: ['Site execution', 'साइट कार्य'], proc: ['Procurement', 'खरीद'], inv: ['Stores and inventory', 'भंडार और इन्वेंटरी'],
  plant: ['Plant and machinery', 'प्लांट और मशीनरी'], qa: ['Quality', 'गुणवत्ता'], hse: ['Health, safety and environment', 'स्वास्थ्य, सुरक्षा और पर्यावरण'], rmc: ['Ready-mix concrete', 'रेडी-मिक्स कंक्रीट'], ctr: ['Contracts and subcontracts', 'अनुबंध और उप-अनुबंध'],
  bill: ['Billing', 'बिलिंग'], pay: ['Payroll', 'पेरोल'], portal: ['Partner portal', 'भागीदार पोर्टल'], bi: ['Reports and analytics', 'रिपोर्ट और विश्लेषण'], ai: ['Intelligence', 'इंटेलिजेंस'], admin: ['Administration', 'प्रशासन'], tst: ['Quality assurance and go-live', 'गुणवत्ता आश्वासन और गो-लाइव'],
};
const GUIDE_TITLES = {
  admin: 'Administrator guide', install: 'Installation and start-up guide', api: 'API guide', import: 'Data import guide', reports: 'Reports and exports guide', security: 'Security guide', recovery: 'Backup, restore and recovery guide',
};
/** ADR-770 who approves the manual of a role, by the role's department: the department's head, or the one above for the head. */
const HEAD_OF = { 'IT and administration': ['SYSADM', 'DIR'], Management: ['SYSADM'], Finance: ['CFO', 'DIR'], Procurement: ['PROCMGR', 'DIR'], Commercial: ['COMMGR', 'DIR'], 'Human resources': ['HRMGR', 'DIR'], Quality: ['QCMGR', 'PD'], 'Project controls': ['PCMGR', 'PD'], Projects: ['PD', 'DIR'], 'Plant and machinery': ['PLANTMGR', 'PD'], Stores: ['STOREMGR', 'PROCMGR'], 'Health, safety and environment': ['HSEE', 'PD'], Platform: ['SYSADM'], Audit: ['DIR'], 'Business development': ['DIR'], Estimation: ['COMMGR', 'DIR'], Security: ['SECMGR', 'HRMGR'], All: ['HRMGR'], Portal: ['SYSADM'] };
const GUIDE_OWNER = { admin: 'SYSADM', install: 'SYSADM', api: 'SYSADM', import: 'SYSADM', reports: 'SYSADM', security: 'SYSADM', recovery: 'SYSADM' };

// the fixed words of a manual, in English and Hindi (field roles get both)
const T = {
  en: {
    roleManual: (n) => `User manual — ${n}`, moduleManual: (n) => `Module guide — ${n}`, quickref: (n) => `Quick reference card — ${n}`, exercises: 'Training exercises on the simulation sandbox',
    build: 'Build', version: 'Version', generated: 'Generated', language: 'Language', owner: 'Approved by', langName: 'English',
    yourRole: 'Your role', department: 'Department', scope: 'Scope', responsibilities: 'Responsibilities', authority: 'Authority',
    start: 'Signing in and finding your way', pages: 'Your pages and what you do on them', approvals: 'Approvals you take part in', screens: 'Screens', faq: 'Frequently asked questions',
    startSteps: (field) => [field ? 'Open the ERP on your phone and sign in with your user name and password, or your PIN in field mode.' : 'Open the ERP in your browser and sign in with your user name and password.', 'The menu shows only the pages your role may open; use the search at the top to jump to a page by name.', 'Change the language (English, Hindi, Telugu), the text size and the theme from your profile.', 'Your approvals and notifications are in the bell at the top; Help & Support raises a ticket.'],
    open: (g, l) => `Open ${g} › ${l} from the menu (or search for “${l}”).`, tabs: (x) => `Switch views with the tabs: ${x}.`, filters: (x) => `Narrow what you see with: ${x}.`, actions: (x) => `What you can do here: ${x}.`, fields: (x) => `Fields you fill in: ${x}.`,
    pageCol: 'Page', moduleCol: 'Module', whatCol: 'What it is for', docCol: 'Document', stepCol: 'Step', whoCol: 'Who decides', slaCol: 'Within (hours)', roleCol: 'Your part',
    submit: 'You submit', decide: 'You decide', owner2: 'You own the process', noApprovals: 'Your role takes no step in an approval workflow.',
    caption: (l, v) => `${l} (${v === 'MOBILE' ? 'phone, 360 px' : 'desktop, 1280 px'})`,
    faqs: (o) => [
      ['A menu item a colleague has is missing for me.', 'The menu shows what your role may open and the projects and sites you are assigned to. Ask your administrator if your work needs more.'],
      ['Why can I not approve a document I created?', 'The person who creates a record can never approve it; another person with the approving role must decide.'],
      ...(o.delegation ? [['I will be on leave; who approves for me?', 'Set a delegation for the dates you are away; approvals then go to your delegate, and both of you are named in the history.']] : []),
      ...(o.field ? [['There is no network on site.', 'Keep working: what you enter is kept on the phone and sent when the network returns. The banner at the top shows what is waiting to be sent.']] : []),
      ['Where can I practise without touching real data?', 'Use the simulation sandbox exercises in the training material; the sandbox is a separate installation with synthetic data.'],
      ['Whom do I contact when something does not work?', 'Raise a ticket in Help & Support. The help desk answers urgent tickets first (see the support model).'],
    ],
    everyone: 'Pages every signed-in person can open', moreScreens: 'More pages are listed in the table above; their screens are in the module guides.',
    quickTop: 'Your daily tasks', quickOffline: 'Working without network', quickOfflineText: 'Entries are saved on the phone and sent automatically when the network returns; do not reinstall the app while entries are waiting.', quickHelp: 'Help', quickHelpText: 'Help & Support → Raise a ticket. Urgent site issues: call your L1 help desk.',
    exIntro: 'Each exercise loads a scenario pack into the sandbox (Admin › Test Coverage & Results › Sandbox) and asks you to find what the pack shows.', exSteps: (p) => [`Open the sandbox and load the pack “${p.label}”.`, `Open the project it creates and its dashboard.`, `Find the figure the exercise is about: ${p.check}.`, 'Reset the sandbox when you are done.'],
    modPages: 'Pages of this module', who: 'Roles that can open it', workflows: 'Approval workflows of this module', none: 'None',
  },
  hi: {
    roleManual: (n) => `उपयोगकर्ता पुस्तिका — ${n}`, moduleManual: (n) => `मॉड्यूल मार्गदर्शिका — ${n}`, quickref: (n) => `त्वरित संदर्भ कार्ड — ${n}`, exercises: 'सिमुलेशन सैंडबॉक्स पर प्रशिक्षण अभ्यास',
    build: 'बिल्ड', version: 'संस्करण', generated: 'बनाया गया', language: 'भाषा', owner: 'अनुमोदनकर्ता', langName: 'हिन्दी',
    yourRole: 'आपकी भूमिका', department: 'विभाग', scope: 'दायरा', responsibilities: 'ज़िम्मेदारियाँ', authority: 'अधिकार',
    start: 'साइन इन करना और रास्ता खोजना', pages: 'आपके पेज और उन पर आपका काम', approvals: 'अनुमोदन जिनमें आप शामिल हैं', screens: 'स्क्रीन', faq: 'अक्सर पूछे जाने वाले प्रश्न',
    startSteps: (field) => [field ? 'अपने फ़ोन पर ERP खोलें और यूज़र नाम व पासवर्ड से, या फ़ील्ड मोड में अपने PIN से साइन इन करें।' : 'ब्राउज़र में ERP खोलें और यूज़र नाम व पासवर्ड से साइन इन करें।', 'मेनू में केवल वही पेज दिखते हैं जो आपकी भूमिका खोल सकती है; ऊपर की खोज से नाम लिखकर पेज पर जाएँ।', 'प्रोफ़ाइल से भाषा (अंग्रेज़ी, हिन्दी, तेलुगु), अक्षर का आकार और थीम बदलें।', 'आपके अनुमोदन और सूचनाएँ ऊपर घंटी में हैं; सहायता और समर्थन से टिकट दर्ज करें।'],
    open: (g, l) => `मेनू में ${g} › ${l} खोलें (या “${l}” खोजें)।`, tabs: (x) => `टैब से दृश्य बदलें: ${x}।`, filters: (x) => `इनसे सूची छोटी करें: ${x}।`, actions: (x) => `यहाँ आप ये कर सकते हैं: ${x}।`, fields: (x) => `भरने वाले फ़ील्ड: ${x}।`,
    pageCol: 'पेज', moduleCol: 'मॉड्यूल', whatCol: 'किस लिए', docCol: 'दस्तावेज़', stepCol: 'चरण', whoCol: 'कौन तय करता है', slaCol: 'समय सीमा (घंटे)', roleCol: 'आपकी भूमिका',
    submit: 'आप जमा करते हैं', decide: 'आप निर्णय लेते हैं', owner2: 'प्रक्रिया के स्वामी', noApprovals: 'आपकी भूमिका किसी अनुमोदन वर्कफ़्लो में चरण नहीं लेती।',
    caption: (l, v) => `${l} (${v === 'MOBILE' ? 'फ़ोन, 360 px' : 'डेस्कटॉप, 1280 px'})`,
    faqs: (o) => [
      ['सहकर्मी के मेनू का कोई आइटम मुझे नहीं दिखता।', 'मेनू में वही दिखता है जो आपकी भूमिका खोल सकती है और जिन परियोजनाओं व साइटों पर आप नियुक्त हैं। अधिक की ज़रूरत हो तो प्रशासक से पूछें।'],
      ['मैं अपना बनाया दस्तावेज़ अनुमोदित क्यों नहीं कर सकता?', 'रिकॉर्ड बनाने वाला व्यक्ति उसे कभी अनुमोदित नहीं कर सकता; अनुमोदन भूमिका वाला कोई दूसरा व्यक्ति निर्णय लेगा।'],
      ...(o.delegation ? [['मैं छुट्टी पर रहूँगा; मेरे स्थान पर कौन अनुमोदन करेगा?', 'अनुपस्थिति की तिथियों के लिए प्रतिनिधि नियुक्त करें; अनुमोदन उन्हें जाएगा और इतिहास में दोनों के नाम रहेंगे।']] : []),
      ...(o.field ? [['साइट पर नेटवर्क नहीं है।', 'काम जारी रखें: आपकी प्रविष्टियाँ फ़ोन में रहती हैं और नेटवर्क लौटने पर भेज दी जाती हैं। ऊपर की पट्टी दिखाती है कि क्या भेजना बाकी है।']] : []),
      ['असली डेटा छुए बिना अभ्यास कहाँ करूँ?', 'प्रशिक्षण सामग्री के सिमुलेशन सैंडबॉक्स अभ्यास करें; सैंडबॉक्स कृत्रिम डेटा वाली अलग स्थापना है।'],
      ['कुछ काम न करे तो किससे संपर्क करूँ?', 'सहायता और समर्थन में टिकट दर्ज करें। हेल्प डेस्क पहले अत्यावश्यक टिकटों का उत्तर देता है।'],
    ],
    everyone: 'हर साइन-इन व्यक्ति के लिए पेज', moreScreens: 'अन्य पेज ऊपर की तालिका में हैं; उनकी स्क्रीन मॉड्यूल मार्गदर्शिकाओं में हैं।',
    quickTop: 'आपके दैनिक काम', quickOffline: 'नेटवर्क के बिना काम', quickOfflineText: 'प्रविष्टियाँ फ़ोन में सहेजी जाती हैं और नेटवर्क लौटते ही अपने-आप भेजी जाती हैं; प्रविष्टियाँ बाकी हों तो ऐप दोबारा इंस्टॉल न करें।', quickHelp: 'सहायता', quickHelpText: 'सहायता और समर्थन → टिकट दर्ज करें। साइट की अत्यावश्यक समस्या: अपने L1 हेल्प डेस्क को फ़ोन करें।',
    exIntro: 'हर अभ्यास सैंडबॉक्स में एक परिदृश्य पैक लोड करता है और पूछता है कि पैक क्या दिखाता है।', exSteps: (p) => [`सैंडबॉक्स खोलें और पैक “${p.label}” लोड करें।`, 'बनी हुई परियोजना और उसका डैशबोर्ड खोलें।', `अभ्यास का आंकड़ा खोजें: ${p.check}।`, 'काम पूरा होने पर सैंडबॉक्स रीसेट करें।'],
    modPages: 'इस मॉड्यूल के पेज', who: 'कौन-सी भूमिकाएँ खोल सकती हैं', workflows: 'इस मॉड्यूल के अनुमोदन वर्कफ़्लो', none: 'कोई नहीं',
  },
};

/** The Hindi label of each registered page (the label the menu shows in Hindi). */
function hindiLabels(root) {
  const out = new Map();
  for (const module of CLIENT_MODULES) {
    const file = join(root, 'src', 'client', 'modules', module, 'index.js');
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/\{ path: '([^']+)', label: '[^']+', labelHi: '([^']+)'/g)) out.set(m[1], m[2]);
  }
  return out;
}

/** The signature of a screen as the capture spec reads it, normalised: what a manual says about the screen and what the drift check compares. */
export function normaliseSignature(s) {
  // the order of items does not count (a re-ordered toolbar is not a changed screen)
  const list = (a, n = 40) => [...new Set((Array.isArray(a) ? a : []).map((x) => String(x).replace(/\s+/g, ' ').trim()).filter((x) => x && x.length <= 80 && !/^\d[\d,.\s%₹-]*$/.test(x)))].slice(0, n).sort((a, b) => a.localeCompare(b, 'en'));
  return { title: String(s?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 160), tabs: list(s?.tabs, 20), actions: list(s?.actions), fields: list(s?.fields), headings: list(s?.headings, 20), columns: list(s?.columns, 30) };
}
export const signatureHash = (s) => sha(JSON.stringify(normaliseSignature(s)));
/** What changed between two signatures, item by item. */
export function signatureDiff(a, b) {
  const A = normaliseSignature(a); const B = normaliseSignature(b); const out = {};
  if (A.title !== B.title) out.title = { from: A.title, to: B.title };
  for (const k of ['tabs', 'actions', 'fields', 'headings', 'columns']) {
    const added = B[k].filter((x) => !A[k].includes(x)); const removed = A[k].filter((x) => !B[k].includes(x));
    if (added.length || removed.length) out[k] = { added, removed };
  }
  return out;
}

/** Markdown (the runbooks and the security documents) as manual sections. */
export function markdownSections(text, { skipTitle = true } = {}) {
  const sections = []; let cur = null; let code = null; let table = null;
  const push = (b) => { if (!cur) { cur = { h: 'Overview', blocks: [] }; sections.push(cur); } cur.blocks.push(b); };
  const flushTable = () => { if (table) { push({ table }); table = null; } };
  const clean = (s) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  for (const line of String(text).split('\n')) {
    if (line.startsWith('```')) { if (code) { push({ note: code.join('\n') }); code = null; } else { flushTable(); code = []; } continue; }
    if (code) { code.push(line); continue; }
    if (/^\|/.test(line)) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => clean(c));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!table) table = { head: cells, rows: [] }; else table.rows.push(cells);
      continue;
    }
    flushTable();
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) { if (h[1].length === 1 && skipTitle) continue; cur = { h: clean(h[2]), blocks: [] }; sections.push(cur); continue; }
    const li = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (li) { const last = cur?.blocks.at(-1); if (last?.list && /^\s*[-*]/.test(line)) last.list.push(clean(li[1])); else if (last?.steps && /^\s*\d+\./.test(line)) last.steps.push(clean(li[1])); else push(/^\s*\d+\./.test(line) ? { steps: [clean(li[1])] } : { list: [clean(li[1])] }); continue; }
    if (line.trim()) { const last = cur?.blocks.at(-1); if (last?.p !== undefined && !/[.:;!?]$/.test(last.p)) last.p = `${last.p} ${clean(line)}`; else push({ p: clean(line) }); }
  }
  flushTable(); if (code) push({ note: code.join('\n') });
  return sections.filter((s) => s.blocks.length);
}

/** The paths of an OpenAPI file (method, path, summary), read without a YAML library: the files are written in one consistent layout. */
export function openApiPaths(text) {
  const out = []; let path = null;
  for (const line of String(text).split('\n')) {
    const p = /^ {2}(\/[^:]*):\s*$/.exec(line); if (p) { path = p[1]; continue; }
    if (/^\S/.test(line)) path = null;
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line); if (m && path) { out.push({ method: m[1].toUpperCase(), path, summary: '' }); continue; }
    const s = /^ {6}summary:\s*(.+)$/.exec(line); if (s && out.length && !out.at(-1).summary && path === out.at(-1).path) out.at(-1).summary = s[1].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/** @param {any} context @param {{ root?: string, storagePath?: string, buildInfo?: any, jobs?: any }} [options] */
export function createManualsService(context, { root = process.cwd(), storagePath = join(process.cwd(), 'data'), buildInfo = null, jobs } = {}) {
  const { db } = context;
  const dir = join(storagePath, 'manuals');
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, MAN_FLAG)) throw notFound('The documentation library is not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };
  const buildId = () => buildInfo?.buildId ?? (existsSync(join(root, 'build-info.json')) ? parse(readFileSync(join(root, 'build-info.json'), 'utf8'), {}).buildId : null) ?? 'development';
  const versionLabel = () => buildInfo?.version ?? parse(readFileSync(join(root, 'package.json'), 'utf8'), {}).version ?? null;
  let inventory = null;
  /** BR-01 the pages of the build: registered in the client, with their Hindi label and the tracker's description. */
  const pages = () => {
    if (!inventory) {
      const hi = hindiLabels(root);
      inventory = registeredPages(root).filter((p) => !p.onboardingOnly && !p.route.includes(':')).map((p) => ({ ...p, labelHi: hi.get(p.route) ?? p.label, code: pageCode(p.route) }));
    }
    return inventory;
  };
  const notes = () => new Map(db.prepare("SELECT page_code, notes FROM ui_page_migration WHERE notes IS NOT NULL AND notes <> '' AND deleted_at IS NULL").all().map((r) => [r.page_code, r.notes]));
  const template = (code) => ROLE_TEMPLATES.find((r) => r.code === code);
  const roleCan = (role, p) => Boolean(p.permission) && role.permissions.includes(p.permission);
  const moduleOfRoute = (route) => { if (!route) return null; const path = route.split('?')[0]; return pages().filter((p) => path === p.route || path.startsWith(`${p.route}/`)).sort((a, b) => b.route.length - a.route.length)[0]?.module ?? null; };
  /** The approval workflows of the build: each type's default chain of steps and the module its documents open in. */
  const workflows = () => workflowTypes.list().map((w) => {
    let route; try { route = w.route?.(1) ?? null; } catch { route = null; }
    const steps = (w.defaultDefinition?.steps ?? []).filter((s) => s.type !== 'system').map((s) => ({ name: s.name, roles: (s.approvers ?? []).map((a) => (a.kind === 'role' ? a.role : a.kind === 'resolver' ? `(${a.resolver.replace(/_/g, ' ')})` : a.kind)), sla: s.slaHours ?? null }));
    return { docType: w.docType, label: w.label ?? w.docType, owner: w.processOwner ?? 'SYSADM', module: moduleOfRoute(route), steps };
  });

  // ---------------------------------------------------------------- FR-03 captures of the screens and the drift check
  const captureView = (c) => c && ({ id: c.id, captureNo: c.capture_no, buildId: c.build_id, status: c.status, baselineId: c.baseline_id, screens: c.screens_count, same: c.same_count, changed: c.changed_count, added: c.new_count, removed: c.removed_count, removedRoutes: parse(c.removed_json, []), comparedAt: c.compared_at, acceptedBy: c.accepted_by, acceptedAt: c.accepted_at, createdAt: c.created_at, createdBy: c.created_by });
  const baseline = (companyId) => db.prepare("SELECT * FROM man_captures WHERE company_id = ? AND status = 'ACCEPTED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(companyId);
  const captureRow = (actor, id) => { const c = db.prepare('SELECT * FROM man_captures WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!c) throw notFound('That capture does not exist.'); return c; };
  function startCapture(actor, { buildId: b } = /** @type {{ buildId?: string }} */ ({})) {
    guard(actor, 'man.manual.generate');
    return transaction(db, () => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM man_captures WHERE company_id = ?').get(actor.companyId).n + 1;
      const id = Number(db.prepare("INSERT INTO man_captures (company_id, capture_no, build_id, status, created_by, source_type) VALUES (?, ?, ?, 'OPEN', ?, 'playwright')").run(actor.companyId, `CAP-${String(n).padStart(5, '0')}`, b ?? buildId(), actor.user).lastInsertRowid);
      writeAudit(db, { companyId: actor.companyId, entity: 'man_captures', entityId: id, action: 'create', newValues: { buildId: b ?? buildId() }, actor: actor.user });
      return captureView(db.prepare('SELECT * FROM man_captures WHERE id = ?').get(id));
    });
  }
  /** A batch of screens: route, viewport, signature and optionally the image, uploaded to the document service (04.10) on this capture. BR-01 a route the build does not register is refused. */
  function addScreens(actor, captureId, screens) {
    guard(actor, 'man.manual.generate');
    const c = captureRow(actor, captureId);
    if (c.status !== 'OPEN') throw conflict(`Capture ${c.capture_no} is ${c.status.toLowerCase()}; screens are added to an open capture.`);
    const known = new Set(pages().map((p) => p.route));
    const unknown = screens.filter((s) => !known.has(s.route)).map((s) => s.route);
    if (unknown.length) throw unprocessable(`Not pages of this build: ${unknown.slice(0, 5).join(', ')} (BR-01).`);
    for (const s of screens) {
      if (!s.fileId) continue;
      const f = db.prepare("SELECT extension FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = 'man_captures' AND linked_id = ? AND deleted_at IS NULL").get(s.fileId, actor.companyId, String(c.id));
      if (!f) throw unprocessable(`File ${s.fileId} is not an image uploaded to capture ${c.capture_no}.`);
      if (!['jpg', 'jpeg', 'png'].includes(String(f.extension).toLowerCase())) throw badRequest(`File ${s.fileId} is not a JPEG or PNG image.`, [{ field: 'fileId', message: 'JPEG or PNG expected' }]);
    }
    transaction(db, () => {
      for (const s of screens) {
        const sig = normaliseSignature(s.signature);
        db.prepare(`INSERT INTO man_screens (company_id, capture_id, route, viewport, role_code, title, signature_hash, signature_json, image_file_id, drift, captured_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, 'playwright')
          ON CONFLICT(capture_id, route, viewport) DO UPDATE SET signature_hash = excluded.signature_hash, signature_json = excluded.signature_json, title = excluded.title, image_file_id = COALESCE(excluded.image_file_id, image_file_id), captured_at = excluded.captured_at, updated_at = excluded.captured_at, version = version + 1`)
          .run(actor.companyId, c.id, s.route, s.viewport, s.role ?? null, sig.title || null, signatureHash(sig), JSON.stringify(sig), s.fileId ?? null, iso(), actor.user);
      }
      db.prepare('UPDATE man_captures SET screens_count = (SELECT COUNT(*) FROM man_screens WHERE capture_id = ?), updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(c.id, iso(), actor.user, c.id);
    });
    return { captureId: c.id, stored: screens.length, screens: db.prepare('SELECT screens_count FROM man_captures WHERE id = ?').get(c.id).screens_count };
  }
  /** T-01 compare a capture with the accepted baseline: CHANGED, NEW and REMOVED screens; current manuals covering them become STALE. */
  function compareCapture(actor, captureId) {
    guard(actor, 'man.manual.generate');
    const c = captureRow(actor, captureId);
    if (!['OPEN', 'COMPARED'].includes(c.status)) throw conflict(`Capture ${c.capture_no} is ${c.status.toLowerCase()}.`);
    if (!c.screens_count) throw unprocessable('The capture has no screens yet.');
    const base = baseline(actor.companyId);
    return transaction(db, () => {
      const before = new Map(base ? db.prepare('SELECT * FROM man_screens WHERE capture_id = ?').all(base.id).map((s) => [`${s.route}|${s.viewport}`, s]) : []);
      const now = db.prepare('SELECT * FROM man_screens WHERE capture_id = ?').all(c.id);
      const counts = { SAME: 0, CHANGED: 0, NEW: 0 }; const touched = new Set();
      for (const s of now) {
        const b = before.get(`${s.route}|${s.viewport}`);
        const drift = !base ? 'NEW' : !b ? 'NEW' : b.signature_hash === s.signature_hash ? 'SAME' : 'CHANGED';
        counts[drift] += 1; if (base && drift !== 'SAME') touched.add(s.route);
        db.prepare('UPDATE man_screens SET drift = ?, diff_json = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(drift, drift === 'CHANGED' ? JSON.stringify(signatureDiff(parse(b.signature_json, {}), parse(s.signature_json, {}))) : null, iso(), s.id);
      }
      const seen = new Set(now.map((s) => `${s.route}|${s.viewport}`));
      const removed = [...before.values()].filter((s) => !seen.has(`${s.route}|${s.viewport}`)).map((s) => ({ route: s.route, viewport: s.viewport }));
      for (const r of removed) touched.add(r.route);
      db.prepare("UPDATE man_captures SET status = 'COMPARED', baseline_id = ?, same_count = ?, changed_count = ?, new_count = ?, removed_count = ?, removed_json = ?, compared_at = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?")
        .run(base?.id ?? null, counts.SAME, counts.CHANGED, counts.NEW, removed.length, JSON.stringify(removed), iso(), iso(), actor.user, c.id);
      // FR-03 the current manuals that describe a changed, new-in-their-module or removed screen are stale until regenerated
      let stale = 0;
      if (touched.size) {
        const touchedModules = new Set([...touched].map((r) => pages().find((p) => p.route === r)?.module ?? moduleOfRoute(r)).filter(Boolean));
        for (const m of currentManuals(actor.companyId)) {
          if (['STALE', 'SUPERSEDED'].includes(m.status)) continue;
          const routes = parse(m.routes_json, []);
          const hit = [...touched].filter((r) => routes.includes(r));
          const newInModule = m.kind === 'MODULE' && touchedModules.has(m.role_or_module) && !hit.length && now.some((s) => touched.has(s.route) && pages().find((p) => p.route === s.route)?.module === m.role_or_module);
          if (!hit.length && !newInModule) continue;
          const why = hit.length ? `Screens changed since this version: ${hit.slice(0, 5).join(', ')}${hit.length > 5 ? ` and ${hit.length - 5} more` : ''} (capture ${c.capture_no}).` : `New screens in the module (capture ${c.capture_no}).`;
          db.prepare("UPDATE man_manuals SET status = 'STALE', stale_reason = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?").run(why, iso(), actor.user, m.id);
          stale += 1;
        }
      }
      writeAudit(db, { companyId: actor.companyId, entity: 'man_captures', entityId: c.id, action: 'compare', newValues: { baseline: base?.capture_no ?? null, ...counts, removed: removed.length, stale }, actor: actor.user });
      publishEvent(db, { type: 'man.capture.compared', entity: 'man_captures', entityId: c.id, actorId: actor.user, companyId: actor.companyId, data: { captureId: c.id, changed: counts.CHANGED, added: counts.NEW, removed: removed.length, staleManuals: stale } });
      if (base && (counts.CHANGED || removed.length || stale)) {
        try { notificationsOf(db)?.notify({ companyId: actor.companyId, templateCode: 'man.drift.flagged', recipients: ['permission:man.manual.generate'], channels: ['IN_APP'], priority: 'NORMAL', data: { captureNo: c.capture_no, changed: counts.CHANGED, added: counts.NEW, removed: removed.length, stale }, link: '/help/documentation?tab=drift', sourceType: 'man_captures', sourceId: String(c.id) }); } catch { /* no notification service in a bare test */ }
      }
      return { ...captureView(db.prepare('SELECT * FROM man_captures WHERE id = ?').get(c.id)), staleManuals: stale };
    });
  }
  function acceptCapture(actor, captureId) {
    guard(actor, 'man.manual.generate');
    const c = captureRow(actor, captureId);
    if (c.status !== 'COMPARED') throw conflict('Compare the capture before accepting it as the baseline.');
    return transaction(db, () => {
      db.prepare("UPDATE man_captures SET status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE company_id = ? AND status = 'ACCEPTED'").run(iso(), actor.companyId);
      db.prepare("UPDATE man_captures SET status = 'ACCEPTED', accepted_by = ?, accepted_at = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), iso(), actor.user, c.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'man_captures', entityId: c.id, action: 'accept', newValues: { captureNo: c.capture_no }, actor: actor.user });
      return captureView(db.prepare('SELECT * FROM man_captures WHERE id = ?').get(c.id));
    });
  }
  function capture(actor, captureId, { drift } = /** @type {{ drift?: string }} */ ({})) {
    guard(actor, 'man.manual.view_all');
    const c = captureRow(actor, captureId);
    const rows = db.prepare(`SELECT id, route, viewport, title, drift, diff_json, image_file_id FROM man_screens WHERE capture_id = ? ${drift ? 'AND drift = ?' : ''} ORDER BY CASE drift WHEN 'CHANGED' THEN 0 WHEN 'NEW' THEN 1 ELSE 2 END, route LIMIT 500`).all(...[c.id, ...(drift ? [drift] : [])]);
    return { ...captureView(c), screens: rows.map((s) => ({ id: s.id, route: s.route, viewport: s.viewport, title: s.title, drift: s.drift, diff: parse(s.diff_json, null), fileId: s.image_file_id ?? null })) };
  }

  // ---------------------------------------------------------------- FR-01 FR-02 FR-04 the manuals
  const imageCache = new Map();
  /** A captured screen, read from the document service and shrunk for the manual (900 px wide JPEG; a phone screen 360 px). A file not cleared by the virus scan is left out. */
  async function screenImage(s) {
    if (!s?.image_file_id) return null;
    if (!imageCache.has(s.image_file_id)) {
      let bytes;
      try { bytes = (await filesOf(db)?.bytesOf(s.image_file_id))?.buffer; } catch { bytes = null; }
      if (!bytes) return null;
      const out = await sharp(bytes).resize({ width: s.viewport === 'MOBILE' ? 360 : 900, withoutEnlargement: true }).jpeg({ quality: 60, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      if (imageCache.size > 400) imageCache.clear();
      imageCache.set(s.image_file_id, { data: out.data, width: out.info.width, height: out.info.height });
    }
    return imageCache.get(s.image_file_id);
  }
  const screensOf = (captureId) => new Map(captureId ? db.prepare('SELECT * FROM man_screens WHERE capture_id = ?').all(captureId).map((s) => [`${s.route}|${s.viewport}`, s]) : []);
  /** The steps for one page: from what its screen shows when captured, otherwise how to reach it. */
  function stepsFor(p, lang, screens) {
    const t = T[lang]; const g = MODULE_NAMES[p.module]?.[lang === 'hi' ? 1 : 0] ?? p.module; const label = lang === 'hi' ? p.labelHi : p.label;
    const sig = parse(screens.get(`${p.route}|DESKTOP`)?.signature_json ?? screens.get(`${p.route}|MOBILE`)?.signature_json, null);
    const steps = [t.open(g, label)];
    if (sig?.tabs?.length) steps.push(t.tabs(sig.tabs.slice(0, 6).join(', ')));
    const actions = (sig?.actions ?? []).filter((a) => !/^(menu|close|open menu|search|notifications|help|profile|skip to content|back)$/i.test(a));
    if (actions.length) steps.push(t.actions(actions.slice(0, 8).join(', ')));
    if (sig?.fields?.length) steps.push(t.fields(sig.fields.slice(0, 8).join(', ')));
    return steps;
  }
  const meta = (lang, owner, version) => [[T[lang].build, buildId()], [T[lang].version, String(version)], [T[lang].generated, iso().slice(0, 10)], [T[lang].language, T[lang].langName], [T[lang].owner, owner]];
  const faqBlocks = (lang, o) => T[lang].faqs(o).flatMap(([q, a]) => [{ p: `Q. ${q}` }, { p: a }]);

  async function roleManual(code, lang, screens, version) {
    const role = template(code); const t = T[lang]; const field = FIELD_ROLES.includes(code); const desc = notes();
    const mine = pages().filter((p) => roleCan(role, p));
    const flows = workflows().map((w) => {
      const parts = [];
      w.steps.forEach((s, i) => { if (s.roles.includes(code)) parts.push(`${t.decide} (${t.stepCol} ${i + 1}: ${s.name})`); });
      if (w.owner === code) parts.push(t.owner2);
      return parts.length ? [w.label, w.steps.map((s) => s.roles.join(' / ')).join(' → '), parts.join('; '), w.steps.map((s) => s.sla ?? '—').join(' / ')] : null;
    }).filter(Boolean);
    // ADR-770 the owner of a role's manual is the head of the role's department (the head's own manual goes to the one above)
    const owner = HEAD_OF[role.department]?.find((r) => r !== code) ?? 'SYSADM';
    const sections = /** @type {any[]} */ ([
      { h: t.yourRole, blocks: [{ table: { head: [t.yourRole, ''], rows: [[t.department, role.department ?? '—'], [t.scope, role.scope ?? '—'], [t.responsibilities, role.responsibilities ?? '—'], [t.authority, role.authority ?? '—']] } }] },
      { h: t.start, blocks: [{ steps: t.startSteps(field) }] },
    ]);
    const routes = [];
    for (const [m, list] of CLIENT_MODULES.map((x) => [x, mine.filter((p) => p.module === x)]).filter(([, l]) => l.length)) {
      const blocks = /** @type {any[]} */ ([{ table: { head: [t.pageCol, t.whatCol], rows: list.map((p) => [lang === 'hi' ? p.labelHi : p.label, desc.get(p.code) ?? '—']) } }]);
      for (const p of list) { blocks.push({ sub: lang === 'hi' ? p.labelHi : p.label }, { steps: stepsFor(p, lang, screens) }); routes.push(p.route); }
      sections.push({ h: `${t.pages}: ${MODULE_NAMES[m]?.[lang === 'hi' ? 1 : 0] ?? m}`, blocks });
    }
    sections.push({ h: t.approvals, blocks: flows.length ? [{ table: { head: [t.docCol, t.whoCol, t.roleCol, t.slaCol], rows: flows } }] : [{ p: t.noApprovals }] });
    // the screens of the role's first pages (phone size for a field role when captured)
    const shots = [];
    for (const p of mine) {
      if (shots.length >= 4) break;
      const s = (field ? screens.get(`${p.route}|MOBILE`) : null) ?? screens.get(`${p.route}|DESKTOP`);
      const img = await screenImage(s); if (img) shots.push({ img: { ...img, type: 'jpeg', caption: t.caption(lang === 'hi' ? p.labelHi : p.label, s.viewport), maxWidthPt: s.viewport === 'MOBILE' ? 200 : 480 } });
    }
    if (shots.length) sections.push({ h: t.screens, blocks: [...shots, { p: t.moreScreens }] });
    sections.push({ h: t.faq, blocks: faqBlocks(lang, { field, delegation: role.permissions.includes('eng.delegation.use') }) });
    return { doc: { title: t.roleManual(lang === 'hi' ? role.name : role.name), subtitle: `${role.code} · ${role.department ?? ''}`, lang, meta: meta(lang, owner, version), sections }, owner, routes, screens: shots.length };
  }

  async function moduleManual(m, screens, version) {
    const t = T.en; const desc = notes(); const list = pages().filter((p) => p.module === m);
    const owner = OWNER[m] ?? 'SYSADM';
    const rows = list.map((p) => [p.label, desc.get(p.code) ?? '—', ROLE_TEMPLATES.filter((r) => roleCan(r, p)).map((r) => r.code).slice(0, 12).join(', ') + (ROLE_TEMPLATES.filter((r) => roleCan(r, p)).length > 12 ? ' …' : '') || t.none]);
    const sections = /** @type {any[]} */ ([{ h: t.modPages, blocks: [{ table: { head: [t.pageCol, t.whatCol, t.who], rows } }] }]);
    let shots = 0;
    for (const p of list) {
      const blocks = /** @type {any[]} */ ([{ steps: stepsFor(p, 'en', screens) }]);
      const s = screens.get(`${p.route}|DESKTOP`);
      if (shots < 8) { const img = await screenImage(s); if (img) { blocks.push({ img: { ...img, type: 'jpeg', caption: t.caption(p.label, 'DESKTOP') } }); shots += 1; } }
      sections.push({ h: p.label, blocks });
    }
    const flows = workflows().filter((w) => w.module === m);
    sections.push({ h: t.workflows, blocks: flows.length ? [{ table: { head: [t.docCol, t.stepCol, t.whoCol, t.slaCol], rows: flows.flatMap((w) => w.steps.map((s, i) => [i ? '' : w.label, `${i + 1}. ${s.name}`, s.roles.join(' / '), String(s.sla ?? '—')])) } }] : [{ p: t.none }] });
    sections.push({ h: t.faq, blocks: faqBlocks('en', { field: false, delegation: true }) });
    return { doc: { title: t.moduleManual(MODULE_NAMES[m]?.[0] ?? m), subtitle: `${list.length} pages`, lang: 'en', meta: meta('en', owner, version), sections }, owner, routes: list.map((p) => p.route), screens: shots };
  }

  const readDoc = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '');
  function guideManual(g, version) {
    const t = T.en; const owner = GUIDE_OWNER[g]; let sections = []; let routes = [];
    const pageTable = (list) => ({ table: { head: [t.pageCol, t.moduleCol, 'Permission'], rows: list.map((p) => [p.label, MODULE_NAMES[p.module]?.[0] ?? p.module, p.permission ?? '—']) } });
    if (g === 'admin') {
      const admin = pages().filter((p) => ['admin', 'core', 'iam', 'ui', 'eng', 'tst'].includes(p.module) && (roleCan(template('SYSADM'), p) || roleCan(template('ITADM'), p)));
      routes = admin.map((p) => p.route);
      const flags = db.prepare('SELECT COUNT(*) AS n FROM core_feature_flags').get().n;
      sections = [
        { h: 'What the administrators look after', blocks: [{ list: [`${admin.length} administration pages, listed below with the permission each needs.`, `${flags} feature flags: each part of the ERP is switched on per company from Admin › Feature flags; a change is approved by a second administrator.`, `${workflows().length} approval workflow types, each with a default chain that the workflow editor can change (activation approved by SYSADM, the process owner and ITADM).`, 'Users, roles and access reviews; segregation-of-duties rules refuse a person both creating and approving a record.', 'Backups, restore tests and disaster-recovery drills; the operations runbooks (deploy, rollback, restore, scale, secrets, certificates, incidents).'] }] },
        { h: 'Administration pages', blocks: [pageTable(admin)] },
        { h: 'Roles of the ERP', blocks: [{ table: { head: ['Code', 'Role', 'Department', 'Authority'], rows: ROLE_TEMPLATES.map((r) => [r.code, r.name, r.department ?? '—', r.authority ?? '—']) } }] },
        { h: 'Operations runbooks', blocks: [{ list: (existsSync(join(root, 'docs/erp/runbooks')) ? readdirSync(join(root, 'docs/erp/runbooks')).filter((f) => f.endsWith('.md')).sort() : []).map((f) => `${(/^#\s+(.+)$/m.exec(readDoc(`docs/erp/runbooks/${f}`))?.[1] ?? f)} (docs/erp/runbooks/${f})`) }] },
      ];
    } else if (g === 'install') {
      sections = [...markdownSections(readDoc('docs/erp/runbooks/environments.md')), ...markdownSections(readDoc('docs/erp/runbooks/deploy.md')).map((s) => ({ ...s, h: `Deploy: ${s.h}` }))];
      const keys = Object.keys(parse(JSON.stringify(Object.fromEntries(readDoc('infra/environments/production.env').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')))), {}));
      sections.push({ h: 'Settings of an environment', blocks: [{ p: `Each environment is a file in infra/environments; production sets ${keys.length} settings: ${keys.join(', ')}. Secrets are never in these files: the vault provides AUTH_SECRET, VAULT_KEY, FILE_URL_SECRET, HEALTH_TOKEN and BACKUP_KEY.` }] });
      sections.push({ h: 'Starting the application', blocks: [{ steps: ['Install Docker and Docker Compose on the host (infra/ansible/site.yml does this with the firewall, users and log rotation).', 'Provide the secrets from the vault as environment variables.', 'Start the blue slot and the proxy: docker compose up -d erp-blue nginx.', 'Check health: the container health check calls /api/health; the about page shows the build.', 'Deploy later builds with scripts/deploy.mjs --blue-green (zero downtime, rollback with scripts/rollback.mjs).'] }] });
    } else if (g === 'api') {
      const files = (existsSync(join(root, 'docs/erp')) ? readdirSync(join(root, 'docs/erp')) : []).filter((f) => f.endsWith('openapi.yaml')).sort();
      sections = [{ h: 'Using the API', blocks: [{ list: ['Every call goes to /api/v1/<module>/… with a bearer token (OAuth client credentials for integrations, from Admin › API platform).', 'Answers are JSON { data } or { error: { code, message, correlationId } }; quote the correlation ID to the help desk.', 'Submits, posts and payments need an Idempotency-Key header: a retried call with the same key returns the first answer.', 'Lists take page and pageSize (at most 200); exports take format=xlsx|csv|pdf.', 'Rate limits and the scopes of each client are set on the API platform page; webhooks are signed with HMAC-SHA256.'] }] }];
      for (const f of files) { const paths = openApiPaths(readDoc(`docs/erp/${f}`)); if (paths.length) sections.push({ h: `${f.replace('-openapi.yaml', '').replace('openapi.yaml', 'core and business modules')} (${paths.length} operations)`, blocks: [{ table: { head: ['Method', 'Path', 'Summary'], rows: paths.slice(0, 400).map((p) => [p.method, p.path, p.summary || '—']) } }] }); }
    } else if (g === 'import') {
      const list = pages().filter((p) => /import|upload|bulk|migration|excel/i.test(`${p.route} ${p.label}`)); routes = list.map((p) => p.route);
      sections = [{ h: 'How imports work', blocks: [{ steps: ['Download the template of the data you load from the import page; it lists every column, which are required and the allowed values.', 'Fill it in Excel; keep the header row as it is.', 'Upload it: every row is checked first (types, masters, duplicates, permissions) and nothing is saved while a row has an error.', 'Correct the rows the check report lists and upload again; when it passes, confirm the import.', 'Large files run as a background job with progress; you are notified when it finishes.'] }] }, { h: 'Import pages', blocks: [pageTable(list)] }];
    } else if (g === 'reports') {
      const list = pages().filter((p) => p.module === 'bi' || /report|register|dashboard|analytics|ledger|statement/i.test(`${p.route} ${p.label}`)); routes = list.map((p) => p.route);
      sections = [{ h: 'Reports and exports', blocks: [{ list: ['Every list and report exports to XLSX, CSV and PDF with the filters you set; masked fields stay masked in the file.', 'Numbers use Indian grouping (lakh, crore) and dates DD-MMM-YYYY; tiles abbreviate amounts and show the exact value on hover.', 'Every figure on a dashboard drills down to the records behind it.', 'Saved views keep your filters and columns; a report can be scheduled by e-mail where the page offers it.'] }] }, { h: 'Report pages', blocks: [pageTable(list)] }];
    } else if (g === 'security') {
      sections = [...markdownSections(readDoc('docs/erp/SECRETS.md')).map((s) => ({ ...s, h: `Secrets: ${s.h}` })), ...markdownSections(readDoc('docs/erp/runbooks/rotate-secrets.md')).map((s) => ({ ...s, h: `Rotating secrets: ${s.h}` })), ...markdownSections(readDoc('docs/erp/runbooks/certificate-renewal.md')).map((s) => ({ ...s, h: `Certificates: ${s.h}` }))];
      sections.unshift({ h: 'Security in daily use', blocks: [{ list: ['Sign-in with password and a second factor for administrators; sessions expire after inactivity.', 'Access is by role and by assignment to company, project and site; sensitive fields (rates, salaries, bank and identity numbers) are masked for other roles.', 'Every change of a business record is in the audit trail with old and new values; the trail is hash-chained.', 'Exports neutralise spreadsheet formulas; attachments are virus-scanned and served through signed links.'] }] });
    } else if (g === 'recovery') {
      sections = [...markdownSections(readDoc('docs/erp/runbooks/restore.md')).map((s) => ({ ...s, h: `Restore: ${s.h}` })), ...markdownSections(readDoc('docs/erp/runbooks/rollback.md')).map((s) => ({ ...s, h: `Rollback: ${s.h}` })), ...markdownSections(readDoc('docs/erp/runbooks/incident-response.md')).map((s) => ({ ...s, h: `Incidents: ${s.h}` }))];
    }
    if (!sections.length) sections = [{ h: GUIDE_TITLES[g], blocks: [{ p: 'The source documents of this guide are not in this build.' }] }];
    return { doc: { title: GUIDE_TITLES[g], subtitle: 'Administrators and IT', lang: 'en', meta: meta('en', owner, version), sections }, owner, routes, screens: 0 };
  }

  async function quickRef(code, lang, screens, version) {
    const role = template(code); const t = T[lang];
    const mine = pages().filter((p) => roleCan(role, p)).slice(0, 8);
    const sections = [{ h: t.quickTop, blocks: mine.map((p) => ({ steps: stepsFor(p, lang, screens).slice(0, 2) })) }, { h: t.quickOffline, blocks: [{ p: t.quickOfflineText }] }, { h: t.quickHelp, blocks: [{ p: t.quickHelpText }] }];
    const first = mine.map((p) => screens.get(`${p.route}|MOBILE`)).find(Boolean); const img = await screenImage(first);
    if (img) sections.splice(1, 0, { h: t.screens, blocks: [{ img: { ...img, type: 'jpeg', caption: t.caption(lang === 'hi' ? mine.find((p) => p.route === first.route)?.labelHi : first.title, 'MOBILE'), maxWidthPt: 180 } }] });
    return { doc: { title: t.quickref(role.name), subtitle: role.code, lang, meta: meta(lang, 'HRMGR', version), sections }, owner: 'HRMGR', routes: mine.map((p) => p.route), screens: img ? 1 : 0 };
  }
  function exercisesManual(lang, version) {
    const t = T[lang];
    const sections = [{ h: t.exercises, blocks: [{ p: t.exIntro }] }, ...Object.entries(PACKS).map(([k, p], i) => ({ h: `${i + 1}. ${p.label}`, blocks: [{ steps: t.exSteps(p) }, { p: `Pack ${k}` }] }))];
    return { doc: { title: t.exercises, subtitle: 'Simulation sandbox (30.04)', lang, meta: meta(lang, 'HRMGR', version), sections }, owner: 'HRMGR', routes: [], screens: 0 };
  }

  /** Every manual of a package: code, kind, subject, language. Field roles have Hindi too (FR-01). */
  function specs() {
    const out = [];
    for (const r of ROLE_TEMPLATES) for (const lang of FIELD_ROLES.includes(r.code) ? ['en', 'hi'] : ['en']) out.push({ code: `role.${r.code}.${lang}`, kind: 'ROLE', subject: r.code, lang, title: T[lang].roleManual(r.name) });
    for (const m of CLIENT_MODULES) if (pages().some((p) => p.module === m)) out.push({ code: `module.${m}.en`, kind: 'MODULE', subject: m, lang: 'en', title: T.en.moduleManual(MODULE_NAMES[m]?.[0] ?? m) });
    for (const g of GUIDES) out.push({ code: `guide.${g}.en`, kind: 'GUIDE', subject: g, lang: 'en', title: GUIDE_TITLES[g] });
    for (const r of FIELD_ROLES) for (const lang of ['en', 'hi']) if (template(r)) out.push({ code: `quickref.${r}.${lang}`, kind: 'QUICKREF', subject: r, lang, title: T[lang].quickref(template(r).name) });
    for (const lang of ['en', 'hi']) out.push({ code: `exercises.sandbox.${lang}`, kind: 'EXERCISES', subject: 'sandbox', lang, title: T[lang].exercises });
    return out;
  }
  async function buildOne(spec, screens, version) {
    if (spec.kind === 'ROLE') return roleManual(spec.subject, spec.lang, screens, version);
    if (spec.kind === 'MODULE') return moduleManual(spec.subject, screens, version);
    if (spec.kind === 'GUIDE') return guideManual(spec.subject, version);
    if (spec.kind === 'QUICKREF') return quickRef(spec.subject, spec.lang, screens, version);
    return exercisesManual(spec.lang, version);
  }

  // ---------------------------------------------------------------- AC-01 the package
  const packageView = (p) => p && ({ id: p.id, packageNo: p.package_no, buildId: p.build_id, version: p.version_label, captureId: p.capture_id, status: p.status, zipBytes: p.zip_bytes, zipSha256: p.zip_sha256, manuals: p.manuals_count, files: p.files_count, progress: p.progress_pct, error: p.error, requestedBy: p.requested_by, startedAt: p.started_at, finishedAt: p.finished_at, approvedAt: p.approved_at, createdAt: p.created_at });
  const currentPackage = (companyId) => db.prepare("SELECT * FROM man_packages WHERE company_id = ? AND status IN ('READY', 'APPROVED') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(companyId);
  const currentManuals = (companyId) => { const p = currentPackage(companyId); return p ? db.prepare('SELECT * FROM man_manuals WHERE package_id = ? AND deleted_at IS NULL').all(p.id) : []; };
  /** Queue a package (a background job when the job runner is present). `only` limits it to some manual codes (a partial package is for tests and previews and is never approved as the release package). */
  function generate(actor, { captureId = null, only = null } = {}) {
    guard(actor, 'man.manual.generate');
    if (db.prepare("SELECT 1 FROM man_packages WHERE company_id = ? AND status IN ('QUEUED', 'GENERATING') AND deleted_at IS NULL").get(actor.companyId)) throw conflict('A package is being generated; wait for it to finish.');
    const cap = captureId ? captureRow(actor, captureId) : (baseline(actor.companyId) ?? db.prepare("SELECT * FROM man_captures WHERE company_id = ? AND status = 'COMPARED' ORDER BY id DESC LIMIT 1").get(actor.companyId));
    if (only?.length) { const known = new Set(specs().map((s) => s.code)); const bad = only.filter((c) => !known.has(c)); if (bad.length) throw badRequest(`Unknown manual: ${bad.join(', ')}`, [{ field: 'only', message: 'unknown code' }]); }
    const id = transaction(db, () => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM man_packages WHERE company_id = ?').get(actor.companyId).n + 1;
      const pid = Number(db.prepare("INSERT INTO man_packages (company_id, package_no, build_id, version_label, capture_id, status, requested_by, remarks, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, 'manuals')")
        .run(actor.companyId, `DOC-${String(n).padStart(5, '0')}`, buildId(), versionLabel(), cap?.id ?? null, actor.user, only?.length ? JSON.stringify({ only }) : null, actor.user).lastInsertRowid);
      writeAudit(db, { companyId: actor.companyId, entity: 'man_packages', entityId: pid, action: 'generate', newValues: { buildId: buildId(), captureId: cap?.id ?? null, only: only ?? null }, actor: actor.user });
      return pid;
    });
    if (jobs) { jobs.enqueue(PACKAGE_JOB, { packageId: id }, { createdBy: actor.user, companyId: actor.companyId }); return packageView(db.prepare('SELECT * FROM man_packages WHERE id = ?').get(id)); }
    return run(id).then(() => packageView(db.prepare('SELECT * FROM man_packages WHERE id = ?').get(id)));
  }
  /** @param {number} packageId @param {(pct: number, msg: string) => void} [progress] */
  async function run(packageId, progress = () => {}) {
    const p = db.prepare('SELECT * FROM man_packages WHERE id = ?').get(packageId);
    if (!p || !['QUEUED', 'FAILED'].includes(p.status)) return { skipped: true };
    db.prepare("UPDATE man_packages SET status = 'GENERATING', started_at = ?, progress_pct = 0, error = NULL, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), iso(), p.id);
    const out = join(dir, `c${p.company_id}`, p.package_no); rmSync(out, { recursive: true, force: true }); mkdirSync(join(out, 'pdf'), { recursive: true }); mkdirSync(join(out, 'docx'), { recursive: true });
    try {
      const only = parse(p.remarks, {})?.only ?? null;
      const list = specs().filter((s) => !only || only.includes(s.code));
      const screens = screensOf(p.capture_id);
      const made = []; const files = [];
      for (const [i, s] of list.entries()) {
        const prev = db.prepare('SELECT * FROM man_manuals WHERE company_id = ? AND code = ? AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1').get(p.company_id, s.code);
        const approved = db.prepare("SELECT * FROM man_manuals WHERE company_id = ? AND code = ? AND status IN ('APPROVED', 'SUPERSEDED') AND approved_at IS NOT NULL AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(p.company_id, s.code);
        const version = (prev?.version_no ?? 0) + 1;
        const m = await buildOne(s, screens, version);
        // the content without the version and date lines, so an unchanged manual keeps its approval
        const hash = sha(JSON.stringify({ ...m.doc, meta: m.doc.meta.filter(([k]) => ![T[s.lang].version, T[s.lang].generated, T[s.lang].build].includes(k)), sections: m.doc.sections.map((x) => ({ ...x, blocks: x.blocks.map((b) => (b.img ? { img: sha(b.img.data) } : b)) })) }));
        const footer = `${s.title} · ${p.package_no} · build ${p.build_id}`;
        const pdf = await toPdf({ ...m.doc, footer, created: iso() }); const docx = toDocx({ ...m.doc, footer, created: iso() });
        const base = s.code.replace(/\./g, '-');
        writeFileSync(join(out, 'pdf', `${base}.pdf`), pdf.buffer); writeFileSync(join(out, 'docx', `${base}.docx`), docx);
        const f = { pdf: { path: `pdf/${base}.pdf`, sha256: sha(pdf.buffer), bytes: pdf.buffer.length }, docx: { path: `docx/${base}.docx`, sha256: sha(docx), bytes: docx.length } };
        files.push(f.pdf, f.docx);
        made.push({ s, m, hash, version, pages: pdf.pages, files: f, carry: approved && approved.content_hash === hash ? approved : null });
        progress(Math.round(((i + 1) / list.length) * 90), s.code);
        db.prepare('UPDATE man_packages SET progress_pct = ?, updated_at = ? WHERE id = ?').run(Math.round(((i + 1) / list.length) * 90), iso(), p.id);
      }
      // the ZIP: README, manifest (build, each file and its SHA-256) and every PDF and DOCX
      const manifest = { package: p.package_no, buildId: p.build_id, version: p.version_label, generatedAt: iso(), capture: p.capture_id ? db.prepare('SELECT capture_no FROM man_captures WHERE id = ?').get(p.capture_id)?.capture_no : null, manuals: made.map((x) => ({ code: x.s.code, kind: x.s.kind, language: x.s.lang, title: x.s.title, owner: x.m.owner, version: x.version, pages: x.pages, files: x.files })) };
      const readme = [`ERP documentation package ${p.package_no}`, `Build ${p.build_id}${p.version_label ? ` (version ${p.version_label})` : ''}, generated ${manifest.generatedAt}.`, '', `${made.length} manuals, each as PDF (pdf/) and editable Word document (docx/).`, 'manifest.json lists every file with its SHA-256, the manual\'s owner and version.', '', ...made.map((x) => `- ${x.s.title} [${x.s.lang}] — pdf/${x.files.pdf.path.slice(4)}`)].join('\n');
      const entries = [{ name: 'README.txt', data: Buffer.from(readme, 'utf8') }, { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }, ...files.map((f) => ({ name: f.path, data: readFileSync(join(out, f.path)) }))];
      const zipped = zip(entries); const zipPath = join(out, `${p.package_no}.zip`); writeFileSync(zipPath, zipped);
      transaction(db, () => {
        for (const x of made) {
          db.prepare(`INSERT INTO man_manuals (company_id, package_id, code, kind, role_or_module, language, title, owner_role, build_id, version_no, content_hash, sections_count, pages_count, screens_count, routes_json, files_json, status, approved_by, approved_at, remarks, created_by, source_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manuals')`)
            .run(p.company_id, p.id, x.s.code, x.s.kind, x.s.subject, x.s.lang, x.s.title, x.m.owner, p.build_id, x.version, x.hash, x.m.doc.sections.length, x.pages, x.m.screens, JSON.stringify([...new Set(x.m.routes)]), JSON.stringify(x.files), x.carry ? 'APPROVED' : 'DRAFT', x.carry?.approved_by ?? null, x.carry?.approved_at ?? null, x.carry ? `Unchanged since version ${x.carry.version_no}, approval kept.` : null, p.requested_by);
          // the earlier versions of the same manual are superseded by this one
          db.prepare("UPDATE man_manuals SET status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE company_id = ? AND code = ? AND package_id <> ? AND status <> 'SUPERSEDED'").run(iso(), p.company_id, x.s.code, p.id);
        }
        const all = made.every((x) => x.carry);
        db.prepare(`UPDATE man_packages SET status = ?, zip_path = ?, zip_sha256 = ?, zip_bytes = ?, manuals_count = ?, files_count = ?, progress_pct = 100, finished_at = ?, approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
          .run(all && !parse(p.remarks, {})?.only ? 'APPROVED' : 'READY', join(`c${p.company_id}`, p.package_no, `${p.package_no}.zip`), sha(zipped), zipped.length, made.length, entries.length, iso(), all ? iso() : null, iso(), p.id);
        if (!parse(p.remarks, {})?.only) db.prepare("UPDATE man_packages SET status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE company_id = ? AND id <> ? AND status IN ('READY', 'APPROVED')").run(iso(), p.company_id, p.id);
        writeAudit(db, { companyId: p.company_id, entity: 'man_packages', entityId: p.id, action: 'generated', newValues: { manuals: made.length, files: entries.length, sha256: sha(zipped), keptApproval: made.filter((x) => x.carry).length }, actor: p.requested_by });
        publishEvent(db, { type: 'man.package.generated', entity: 'man_packages', entityId: p.id, actorId: p.requested_by, companyId: p.company_id, data: { packageId: p.id, packageNo: p.package_no, buildId: p.build_id, manuals: made.length, files: entries.length, status: 'READY' } });
      });
      try { notificationsOf(db)?.notify({ companyId: p.company_id, templateCode: 'man.package.ready', recipients: [`user:${p.requested_by}`], channels: ['IN_APP'], priority: 'LOW', data: { packageNo: p.package_no, manuals: made.length, build: p.build_id }, link: '/help/documentation', sourceType: 'man_packages', sourceId: String(p.id) }); } catch { /* none */ }
      return { packageId: p.id, manuals: made.length };
    } catch (err) {
      db.prepare("UPDATE man_packages SET status = 'FAILED', error = ?, finished_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(String(err?.message ?? err).slice(0, 500), iso(), iso(), p.id);
      throw err;
    }
  }
  if (jobs) jobs.register(PACKAGE_JOB, async (ctx) => run(Number(ctx.params?.packageId), (pct, msg) => ctx.setProgress?.(pct, msg)), { maxAttempts: 1, description: 'Documentation package (part 30.09): every manual as PDF and DOCX in one ZIP.' });

  // ---------------------------------------------------------------- approvals by the owners
  const engine = createApprovalEngine({ db, handlers: { [APPROVAL_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, actor) {
      const m = db.prepare('SELECT * FROM man_manuals WHERE id = ?').get(Number(request.targetId));
      db.prepare("UPDATE man_manuals SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), iso(), m.id);
      writeAudit(db, { companyId: m.company_id, entity: 'man_manuals', entityId: m.id, action: 'approve', newValues: { code: m.code, versionNo: m.version_no, hash: m.content_hash }, actor: actor.user });
      publishEvent(db, { type: 'man.manual.approved', entity: 'man_manuals', entityId: m.id, actorId: actor.user, companyId: m.company_id, data: { manualId: m.id, code: m.code, versionNo: m.version_no, packageId: m.package_id } });
      const left = db.prepare("SELECT COUNT(*) AS n FROM man_manuals WHERE package_id = ? AND status <> 'APPROVED' AND deleted_at IS NULL").get(m.package_id).n;
      const pkg = db.prepare('SELECT * FROM man_packages WHERE id = ?').get(m.package_id);
      if (!left && pkg.status === 'READY' && !parse(pkg.remarks, {})?.only) {
        db.prepare("UPDATE man_packages SET status = 'APPROVED', approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), iso(), pkg.id);
        publishEvent(db, { type: 'man.package.approved', entity: 'man_packages', entityId: pkg.id, actorId: actor.user, companyId: pkg.company_id, data: { packageId: pkg.id, packageNo: pkg.package_no, buildId: pkg.build_id } });
      }
    },
  } } });
  /** The writer sends the drafts of the current package (or the ones named) to their owners. */
  function submit(actor, { ids = null, reason }) {
    guard(actor, 'man.manual.generate');
    const p = db.prepare("SELECT * FROM man_packages WHERE company_id = ? AND status = 'READY' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(actor.companyId);
    if (!p) throw unprocessable('There is no generated package waiting for approval.');
    const rows = db.prepare("SELECT * FROM man_manuals WHERE package_id = ? AND status IN ('DRAFT', 'REJECTED') AND deleted_at IS NULL").all(p.id).filter((m) => !ids || ids.includes(m.id));
    if (!rows.length) throw unprocessable('No draft manual to submit.');
    return transaction(db, () => {
      let sent = 0; const owners = new Map();
      for (const m of rows) {
        const req = engine.submit(actor, { type: APPROVAL_TYPE, title: `${m.title} (${m.language}) version ${m.version_no}`, targetType: 'man_manuals', targetId: String(m.id), payload: { code: m.code, versionNo: m.version_no, hash: m.content_hash, buildId: m.build_id }, reason, chain: [m.owner_role] });
        db.prepare("UPDATE man_manuals SET status = 'SUBMITTED', request_id = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?").run(req.id, iso(), actor.user, m.id);
        sent += 1; owners.set(m.owner_role, (owners.get(m.owner_role) ?? 0) + 1);
      }
      for (const [role, n] of owners) {
        try { notificationsOf(db)?.notify({ companyId: actor.companyId, templateCode: 'man.manual.review', recipients: [`role:${role}`], channels: ['IN_APP'], priority: 'NORMAL', data: { title: `${n} manual(s)`, build: p.build_id }, link: '/help/documentation?status=SUBMITTED', sourceType: 'man_packages', sourceId: String(p.id) }); } catch { /* none */ }
      }
      return { submitted: sent, owners: Object.fromEntries(owners) };
    });
  }
  /** An owner decides one or many manuals waiting for them (the bulk action of the list). */
  function decide(actor, { ids, action, comment }) {
    guard(actor);
    const waiting = new Map(engine.awaiting(actor).filter((r) => r.type === APPROVAL_TYPE).map((r) => [Number(r.targetId), r]));
    const out = [];
    for (const id of ids) {
      const r = waiting.get(Number(id));
      if (!r) { out.push({ id, ok: false, error: 'Not waiting for your decision.' }); continue; }
      try {
        const res = engine.act(actor, r.id, { action, comment, version: undefined });
        if (res.status === 'REJECTED' || res.status === 'RETURNED') db.prepare("UPDATE man_manuals SET status = 'REJECTED', updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), Number(id));
        out.push({ id, ok: true, status: res.status });
      } catch (err) { out.push({ id, ok: false, error: err.message }); }
    }
    return { decided: out.filter((x) => x.ok).length, results: out };
  }

  // ---------------------------------------------------------------- the library
  const canAll = (actor) => hasPermissionAnywhere(actor, 'man.manual.view_all');
  /** Which manuals a person reads without view_all: their roles' manuals and cards, the modules they can open a page of, the exercises. */
  function visibleTo(actor, m) {
    if (canAll(actor)) return true;
    const roles = actor.roles ?? [];
    if (roles.includes(m.owner_role)) return true; // the owner reads what they approve
    if (m.kind === 'ROLE' || m.kind === 'QUICKREF') return roles.includes(m.role_or_module);
    if (m.kind === 'MODULE') return pages().some((p) => p.module === m.role_or_module && roles.some((r) => template(r) && roleCan(template(r), p)));
    if (m.kind === 'EXERCISES') return true;
    return false;
  }
  const manualView = (m, awaiting) => ({ id: m.id, code: m.code, kind: m.kind, subject: m.role_or_module, language: m.language, title: m.title, owner: m.owner_role, buildId: m.build_id, versionNo: m.version_no, sections: m.sections_count, pages: m.pages_count, screens: m.screens_count, status: m.status, staleReason: m.stale_reason, remarks: m.remarks, approvedBy: m.approved_by, approvedAt: m.approved_at, files: Object.fromEntries(Object.entries(parse(m.files_json, {})).map(([k, v]) => [k, { bytes: v.bytes, sha256: v.sha256 }])), awaitingMe: awaiting.has(m.id) });
  const SORTS = { title: 'title', kind: 'kind', status: 'status', pages: 'pages_count', owner: 'owner_role', language: 'language' };
  function filtered(actor, q) {
    const p = currentPackage(actor.companyId) ?? db.prepare("SELECT * FROM man_packages WHERE company_id = ? AND status = 'READY' ORDER BY id DESC LIMIT 1").get(actor.companyId);
    if (!p) return { p: null, rows: [] };
    const where = ['package_id = ?', 'deleted_at IS NULL']; const args = [p.id];
    if (q.kind) { where.push('kind = ?'); args.push(q.kind); }
    if (q.language) { where.push('language = ?'); args.push(q.language); }
    if (q.status) { where.push('status = ?'); args.push(q.status); }
    if (q.owner) { where.push('owner_role = ?'); args.push(q.owner); }
    if (q.q) { where.push('(title LIKE ? OR code LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
    const [col, dir2] = (q.sort ?? 'kind').split(':'); const order = `${SORTS[col] ?? 'kind'} ${dir2 === 'desc' ? 'DESC' : 'ASC'}, title`;
    return { p, rows: db.prepare(`SELECT * FROM man_manuals WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(...args).filter((m) => visibleTo(actor, m)) };
  }
  function library(actor, q) {
    guard(actor);
    const { p, rows } = filtered(actor, q);
    const awaiting = new Set(engine.awaiting(actor).filter((r) => r.type === APPROVAL_TYPE).map((r) => Number(r.targetId)));
    const page = q.page ?? 1; const pageSize = q.pageSize ?? 25;
    const all = p ? db.prepare('SELECT status, kind FROM man_manuals WHERE package_id = ? AND deleted_at IS NULL').all(p.id) : [];
    const lastCapture = db.prepare('SELECT * FROM man_captures WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(actor.companyId);
    const running = db.prepare("SELECT * FROM man_packages WHERE company_id = ? AND status IN ('QUEUED', 'GENERATING', 'FAILED') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(actor.companyId);
    return {
      package: packageView(p), running: running && (!p || running.id > p.id) ? packageView(running) : null, buildId: buildId(),
      counts: { total: all.length, byStatus: Object.fromEntries(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'STALE'].map((s) => [s, all.filter((x) => x.status === s).length])), byKind: Object.fromEntries(KINDS.map((k) => [k, all.filter((x) => x.kind === k).length])) },
      rows: rows.slice((page - 1) * pageSize, page * pageSize).map((m) => manualView(m, awaiting)), total: rows.length, page, pageSize,
      awaitingMe: awaiting.size,
      capture: canAll(actor) ? captureView(lastCapture) : null, baseline: canAll(actor) ? captureView(baseline(actor.companyId)) : null,
      can: { generate: hasPermissionAnywhere(actor, 'man.manual.generate'), viewAll: canAll(actor), package: canAll(actor) && Boolean(p) },
    };
  }
  function exportList(actor, q, format) {
    guard(actor);
    const { p, rows } = filtered(actor, q);
    const columns = [{ key: 'title', label: 'Manual' }, { key: 'kind', label: 'Kind' }, { key: 'language', label: 'Language' }, { key: 'owner', label: 'Owner' }, { key: 'version', label: 'Version', type: 'number' }, { key: 'pages', label: 'Pages', type: 'number' }, { key: 'status', label: 'Status' }, { key: 'approvedBy', label: 'Approved by' }];
    const buffer = writeExport(format, { columns, rows: rows.map((m) => ({ title: m.title, kind: m.kind, language: m.language, owner: m.owner_role, version: m.version_no, pages: m.pages_count, status: m.status, approvedBy: m.approved_by ?? '' })), title: 'Documentation library', sheetName: 'Manuals', footer: [`${rows.length} manuals · package ${p?.package_no ?? '—'} · build ${p?.build_id ?? buildId()}`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'man.library', action: 'export', newValues: { format, rows: rows.length }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `documentation-library.${format}` };
  }
  function download(actor, manualId, format) {
    guard(actor);
    const m = db.prepare('SELECT * FROM man_manuals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(manualId), actor.companyId);
    if (!m || !visibleTo(actor, m)) throw notFound('That manual does not exist.');
    const f = parse(m.files_json, {})[format]; const pkg = db.prepare('SELECT package_no FROM man_packages WHERE id = ?').get(m.package_id);
    const file = f && join(dir, `c${m.company_id}`, pkg.package_no, f.path);
    if (!file || !existsSync(file)) throw notFound('The file of that manual is no longer kept; generate the package again.');
    const buffer = readFileSync(file);
    if (sha(buffer) !== f.sha256) throw conflict('The stored file does not match its checksum.');
    writeAudit(db, { companyId: actor.companyId, entity: 'man_manuals', entityId: m.id, action: 'download', newValues: { format }, actor: actor.user });
    return { buffer, contentType: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: `${m.code.replace(/\./g, '-')}-v${m.version_no}.${format}` };
  }
  function downloadPackage(actor, packageId) {
    guard(actor, 'man.manual.view_all');
    const p = db.prepare('SELECT * FROM man_packages WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(packageId), actor.companyId);
    if (!p?.zip_path || !existsSync(join(dir, p.zip_path))) throw notFound('That package has no file.');
    const buffer = readFileSync(join(dir, p.zip_path));
    if (sha(buffer) !== p.zip_sha256) throw conflict('The stored package does not match its checksum.');
    writeAudit(db, { companyId: actor.companyId, entity: 'man_packages', entityId: p.id, action: 'download', newValues: { bytes: buffer.length }, actor: actor.user });
    return { buffer, contentType: 'application/zip', fileName: `${p.package_no}-${p.build_id}.zip` };
  }
  function packageStatus(actor, packageId) {
    guard(actor, 'man.manual.view_all');
    const p = db.prepare('SELECT * FROM man_packages WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(packageId), actor.companyId);
    if (!p) throw notFound('That package does not exist.');
    return packageView(p);
  }

  return { pages, specs, startCapture, addScreens, compareCapture, acceptCapture, capture, generate, run, submit, decide, library, exportList, download, downloadPackage, packageStatus, workflows };
}
