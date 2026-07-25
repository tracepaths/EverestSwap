import { Routes, Route } from 'react-router-dom'
import { AppProvider } from './contexts/AppContext'
import Layout from './components/Layout'
import SwapPage from './pages/SwapPage'
import LiquidityPage from './pages/LiquidityPage'
import PortfolioPage from './pages/PortfolioPage'
import PoolPage from './pages/PoolPage'
import LaunchTokenPage from './pages/LaunchTokenPage'
import DocsPage from './pages/DocsPage'
import AdminPage from './pages/AdminPage'
import MyPoolsPage from './pages/MyPoolsPage'

function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<SwapPage />} />
          <Route path="/liquidity" element={<LiquidityPage />} />
          <Route path="/dashboard" element={<PortfolioPage />} />
          <Route path="/pool" element={<PoolPage />} />
          <Route path="/my-pools" element={<MyPoolsPage />} />
          <Route path="/launch" element={<LaunchTokenPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </AppProvider>
  )
}

export default App

