// English text of the area `common` (part 03.09; one file per area since part 166.4, D-682).
export default {
  loading: 'Loading', 'loading.what': 'Loading {what}', tryAgain: 'Try again', cancel: 'Cancel', save: 'Save', close: 'Close', open: 'Open', previous: 'Previous', next: 'Next', clear: 'Clear', search: 'Search', confirm: 'Confirm', working: 'Working...',
  'noPermission.title': 'You do not have access to {what}', 'noPermission.body': 'This needs {need}. Ask {ask} to grant it.', 'noPermission.need': 'the {permission} permission', 'query.notFound': 'Could not find {what}', 'query.loadFailed': 'Could not load {what}', 'ask.admin': 'a system administrator',
  'error.title': 'Something went wrong', 'error.body': 'The request failed. Try again.', 'error.correlation': 'Correlation ID: {id}',
  'theme.light': 'Light', 'theme.dark': 'Dark', 'theme.high-contrast': 'High contrast', 'empty.alt': 'Nothing here yet',
  'pager.summary': '{total} {noun}, page {page} of {pages}',
  // PACK-09: drafts of long forms (src/client/platform/forms/layout.jsx DraftBanner, longDraft.js)
  'draft.found': 'You have a draft saved {when}{auto}.',
  'draft.foundTitled': 'You have a draft "{title}" saved {when}{auto}.',
  'draft.auto': '(kept automatically)',
  'draft.resume': 'Resume the draft',
  'draft.discard': 'Discard it',
  'draft.kept': 'Draft kept {when}.',
  'draft.saving': 'Keeping a draft...',
  'draft.failed': 'The draft could not be kept; your changes are still on this page.',
  // PACK-10: the preview before a bulk action (src/client/platform/list/ListReport.jsx)
  'bulk.checking': 'Checking what you may do with the selected rows...',
  'bulk.canDo': '{action}: {n} of the {total} selected rows can be done.',
  'bulk.skipped': 'These will be left as they are:',
  'bulk.go': 'Do it for {n} row(s)',
  'bulk.none': 'None of them can be done',
  'bulk.cancel': 'Cancel',
};
