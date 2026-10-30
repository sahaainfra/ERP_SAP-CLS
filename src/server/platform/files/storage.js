import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const KEY = /^[A-Za-z0-9_][A-Za-z0-9_\-./]*$/;

/**
 * The storage adapter contract (FR-01). A key such as `c1/2026/10/<uuid>` names an object; the service never touches a
 * path. Implementations: this local-disk adapter (development, single server) and, later, an S3-compatible one with the
 * same methods (defect D-033). Objects are never served from a web-visible folder.
 *
 *   put(key, sourcePath)       move a finished temporary file into storage
 *   putBuffer(key, buffer)     store bytes (thumbnails)
 *   createReadStream(key, { start, end })
 *   size(key)                  bytes, or null if missing
 *   move(from, to)             used to quarantine
 *   remove(key)
 */
export function createLocalStorage({ root }) {
  const base = resolve(root);
  const pathOf = (key) => {
    if (!KEY.test(key) || key.split('/').some((part) => part === '..' || part === '')) throw new Error(`Invalid storage key "${key}"`);
    const full = resolve(join(base, key));
    if (full !== base && !full.startsWith(base + sep)) throw new Error(`Invalid storage key "${key}"`);
    return full;
  };
  const ensureDir = (file) => mkdir(dirname(file), { recursive: true });
  return {
    name: 'local',
    root: base,
    async put(key, sourcePath) {
      const target = pathOf(key);
      await ensureDir(target);
      try {
        await rename(sourcePath, target);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        await copyFile(sourcePath, target);
        await rm(sourcePath, { force: true });
      }
    },
    async putBuffer(key, buffer) {
      const target = pathOf(key);
      await ensureDir(target);
      await writeFile(target, buffer);
    },
    createReadStream: (key, range = {}) => createReadStream(pathOf(key), range),
    async size(key) {
      try {
        return (await stat(pathOf(key))).size;
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async move(from, to) {
      const target = pathOf(to);
      await ensureDir(target);
      await rename(pathOf(from), target);
    },
    remove: (key) => rm(pathOf(key), { force: true }),
  };
}
