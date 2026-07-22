import { render } from 'solid-js/web';

import { App } from './app/App';
import './styles/global.css';
import './styles/mobile-shell.css';
import './styles/modules.css';
import './styles/clinical-ux.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

render(() => <App />, root);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
