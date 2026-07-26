import { Routes, Route } from 'react-router-dom'
import { AppProvider } from './contexts/AppContext'
import Layout from './components/Layout'
import SwapPage from './pages/SwapPage'
import PoolPage from './pages/PoolPage'
import PortfolioPage from './pages/PortfolioPage'
import LaunchTokenPage from './pages/LaunchTokenPage'
import DocsPage from './pages/DocsPage'
import AdminPage from './pages/AdminPage'

function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<SwapPage />} />
          <Route path="/dashboard" element={<PortfolioPage />} />
          <Route path="/pool/*" element={<PoolPage />} />
          <Route path="/launch" element={<LaunchTokenPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </AppProvider>
  )
}

export default App

