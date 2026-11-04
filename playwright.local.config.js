import base from './playwright.config.js';
export default { ...base, use: { ...base.use, channel: undefined, launchOptions: { ...base.use.launchOptions, executablePath: process.env.PW_EXE, args: [...base.use.launchOptions.args, '--no-sandbox'] } } };
