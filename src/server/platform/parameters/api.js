import { createParameterStore, parameterRegistry } from './index.js';

export { createParameterStore, parameterRegistry };
/** A module declares its own parameter once, at load time; administrators then set values from System Parameters. */
export const defineParameter = (def) => parameterRegistry.define(def);
