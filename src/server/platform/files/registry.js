// The file service of a database, so a module can ask it to do something with a stored file without owning the storage (part 05.04: copy an attachment of a message to the task made from it).
const services = new WeakMap();
export const bindFiles = (db, service) => services.set(db, service);
export const filesOf = (db) => services.get(db) ?? null;
