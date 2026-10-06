import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/archivo/wdth.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/atlas.css';
import { App } from './App';
import { createHttpApiClient } from './api/apiClient';

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    <App api={createHttpApiClient()} />
  </StrictMode>
);
