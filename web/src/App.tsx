import { Routes, Route, Navigate } from 'react-router-dom';
import { SetupProvider } from './hooks/useSetupState';
import SetupPage from './pages/setup/SetupPage';

export default function App() {
  return (
    <SetupProvider>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/" element={<Navigate to="/setup" replace />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </SetupProvider>
  );
}
