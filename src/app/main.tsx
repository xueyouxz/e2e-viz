import ReactDOM from 'react-dom/client'
import App from './App'
import '@/styles/index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Application root element was not found')
}

ReactDOM.createRoot(rootElement).render(<App />)
