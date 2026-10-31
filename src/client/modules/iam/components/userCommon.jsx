export const USER_STATUS = {
  INVITED: ['Invited', 'chip-not_applicable'],
  ONBOARDING: ['Onboarding', 'chip-not_applicable'],
  ACTIVE: ['Active', 'chip-pass'],
  SUSPENDED: ['Suspended', 'chip-fail'],
  DEACTIVATED: ['Deactivated', 'chip-never'],
};
export const USER_TYPES = [['INTERNAL', 'Internal'], ['EXTERNAL_PORTAL', 'External portal'], ['SERVICE_ACCOUNT', 'Service account']];
export const LANGUAGES = [['en', 'English'], ['hi', 'Hindi']];
export const CHANNELS = [['email', 'Email'], ['sms', 'Text message'], ['whatsapp', 'WhatsApp']];
export const ROLE_LABEL = {
  SYSADM: 'System administrator', ITADM: 'IT administrator', PM: 'Project manager', ACCMGR: 'Accounts manager', CFO: 'Chief financial officer', PCMGR: 'Project controls manager', HRMGR: 'HR manager', PD: 'Project director', DIR: 'Director',
};

export const UserStatusChip = ({ status }) => {
  const [label, cls] = USER_STATUS[status] ?? [status, 'chip-not_applicable'];
  return <span className={`chip ${cls}`} data-testid="user-status">{label}</span>;
};
export const typeLabel = (v) => USER_TYPES.find(([k]) => k === v)?.[1] ?? v;
export const roleLabel = (code) => ROLE_LABEL[code] ?? code;

/** The fields of the create and edit forms, in the description FieldInput and readForm understand. */
export const USER_FIELDS = [
  { name: 'displayName', label: 'Full name', type: 'text', required: true, max: 120 },
  { name: 'email', label: 'Email', type: 'text', max: 200, hint: 'Where the invitation goes. Give an email or a mobile number.' },
  { name: 'mobile', label: 'Mobile', type: 'text', max: 30, hint: '10 digits, or with a country code' },
  { name: 'username', label: 'Username', type: 'text', max: 60, createOnly: true, hint: 'Optional: made from the email if left empty' },
  { name: 'language', label: 'Preferred language', type: 'select', options: LANGUAGES, required: true, default: 'en' },
  { name: 'userType', label: 'Type', type: 'select', options: USER_TYPES, required: true, default: 'INTERNAL' },
  { name: 'employeeCode', label: 'Employee code', type: 'text', max: 40, hint: 'Links the account to the employee record' },
  { name: 'departmentId', label: 'Department', type: 'ref', ref: 'departments' },
  { name: 'projectId', label: 'Home project', type: 'ref', ref: 'projects' },
];
