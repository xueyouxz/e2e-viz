import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProviders } from './providers'
import '@/styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppProviders>
    <App />
  </AppProviders>
)
