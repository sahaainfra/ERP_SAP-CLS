// What the signed-in person may do (part 02.04, FR-10). `access` is the answer of GET /iam/me/access:
//   companyWide  permissions held for the whole company
//   anywhere     permissions held for the whole company or only for part of it
//   scopes       for a permission held only for part: the project and site IDs it covers
// Pure JavaScript, so it is unit-tested in Node. The server decides every request again; this only shapes what the page offers.

/** May the person do `permission`, optionally on a record carrying projectId and siteId? */
export function canWith(access, permission, record = null) {
  if (!access) return false;
  if (access.companyWide.includes(permission)) return true;
  if (!access.anywhere.includes(permission)) return false;
  if (!record) return true;
  const s = access.scopes?.[permission];
  if (!s) return false;
  return (record.projectId != null && s.projects.includes(record.projectId)) || (record.siteId != null && s.sites.includes(record.siteId));
}

/** Keep the menu entries the person may open (a permission held anywhere shows the entry; the page limits what it lists). */
export const menuFor = (access, routes) => routes.filter((r) => !r.permission || canWith(access, r.permission));
