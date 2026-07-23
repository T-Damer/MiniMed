import { render } from 'solid-js/web';

import { App } from './app/App';
import './styles/global.css';
import './styles/mobile-shell.css';
import './styles/modules.css';
import './styles/clinical-ux.css';
import './styles/clinical-results.css';
import './styles/models.css';
import './styles/doctor-ux.css';
import './styles/dataset-ux.css';
import './styles/search-doctor-ux.css';
import './styles/grounded-assistant.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

render(() => <App />, root);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
