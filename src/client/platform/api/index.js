import { createApiClient } from './client.js';
import { authHeaders } from './identity.js';

export { ApiError } from './client.js';
export { authHeaders, loadIdentity, saveIdentity } from './identity.js';

/** The application's API client: auth headers from the identity adapter, everything else per client.js. */
export const api = createApiClient({ getAuthHeaders: authHeaders });
