/**
 * Deactivation blockers of a person (part 02.03, BR-02): later modules (tasks, workflow inbox, site attendance, stores) say which
 * open items a person still holds. A blocker is a function `(db, {companyId, userId, username}) => [{ type, count, hint }]`;
 * deactivation is refused, with every blocker listed, while any returns a count above zero. The built-in ones (approval requests and
 * organisation roles) are handled by the user service itself and can be handed to a successor; a registered one is not reassignable
 * until its module also registers a `reassign` function.
 */
const blockers = new Map();

export const userBlockers = {
  /** @param {string} name  @param {(db: any, ctx: {companyId: number, userId: number, username: string}) => {type: string, count: number, hint?: string}[]} fn  @param {((db: any, ctx: {companyId: number, from: number, to: number, actor: string}) => number) | null} reassign */
  register(name, fn, reassign = null) {
    blockers.set(name, { fn, reassign });
  },
  unregister(name) {
    blockers.delete(name);
  },
  collect(db, ctx) {
    const found = [];
    for (const [name, { fn, reassign }] of blockers) {
      for (const b of fn(db, ctx) ?? []) if (b.count > 0) found.push({ source: name, reassignable: Boolean(reassign), ...b });
    }
    return found;
  },
  /** Hand every item of the registered modules over to the successor; returns what each module moved. */
  reassign(db, ctx) {
    const moved = {};
    for (const [name, { reassign }] of blockers) if (reassign) moved[name] = reassign(db, ctx);
    return moved;
  },
};
