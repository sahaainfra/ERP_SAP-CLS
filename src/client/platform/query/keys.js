// Query-key conventions (FR-07). Every key starts with the module code, then the resource, then the variant,
// so invalidating ['core', 'flags'] refreshes every flag list and evaluation at once after a change.
export const queryKeys = {
  session: () => ['session'],
  core: {
    flags: {
      all: ['core', 'flags'],
      list: (params) => ['core', 'flags', 'list', params],
      evaluate: (keys) => ['core', 'flags', 'evaluate', [...keys].sort().join(',')],
    },
    about: () => ['core', 'about'],
    architecture: () => ['core', 'architecture'],
  },
};
