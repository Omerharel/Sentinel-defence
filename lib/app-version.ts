import pkg from '../package.json';

const [major, minor = '0'] = pkg.version.split('.');
export const APP_VERSION = `${major}.${minor}`;
