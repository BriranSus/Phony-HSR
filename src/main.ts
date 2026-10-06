import { bootstrap } from './app/bootstrap';

const host = document.getElementById('app');
if (!host) throw new Error('Missing #app container');
bootstrap(host);
