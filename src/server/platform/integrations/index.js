import { createIntegrations } from './hub.js';
import { createProviderRegistry, registerBuiltinProviders } from './providers.js';
import { createSecretStore, createVault } from './vault.js';

export { IntegrationError } from './hub.js';
export { CFO_TYPES, CONNECTOR_TYPES, ENVIRONMENTS, ProviderError, TYPE_INTERFACES } from './providers.js';

const instances = new WeakMap();

/**
 * The integration service of a database: the vault, the provider registry and the call wrapper, created once. Other
 * modules call `integrationsOf(db).hub.call(...)` and register their own providers on `.providers`. `options` apply only
 * the first time (the application passes the vault key; tests pass a fake fetch, clock and sleep).
 */
export function integrationsOf(db, options = {}) {
  let i = instances.get(db);
  if (!i) {
    const providers = registerBuiltinProviders(createProviderRegistry());
    const vault = createVault({ secret: options.vaultKey ?? undefined });
    const secrets = createSecretStore({ db, vault, now: options.now });
    const hub = createIntegrations({ db, secrets, providers, fetchImpl: options.fetchImpl, now: options.now, sleep: options.sleep });
    i = { hub, secrets, providers, vault };
    instances.set(db, i);
  }
  return i;
}
