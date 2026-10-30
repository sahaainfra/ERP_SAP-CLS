// Child process for the concurrency test: opens the same database file as its siblings and takes gap-free
// numbers, each inside its own write transaction, exactly as a document module would. Prints the numbers as JSON.
import { openDatabase, transaction } from '../../src/server/platform/db/index.js';
import { issueNumber } from '../../src/server/modules/core/numbering/service.js';

const [file, company, count, worker] = process.argv.slice(2);
const db = openDatabase(file);
const issued = [];
for (let i = 0; i < Number(count); i++) {
  issued.push(
    transaction(db, () =>
      issueNumber(db, { companyId: Number(company), docType: 'SAMPLE_DOC', date: '2026-10-15', refType: 'worker', refId: `${worker}-${i}`, actor: `worker${worker}` }),
    ).number,
  );
}
console.log(JSON.stringify(issued));
db.close();
