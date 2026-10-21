import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import { useAuth } from './lib/auth.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { JobView } from './pages/JobView.jsx';
import { Landing } from './pages/Landing.jsx';
import { Login, Register } from './pages/Auth.jsx';
import { NewProject } from './pages/NewProject.jsx';
import { NotFound } from './pages/NotFound.jsx';
import { ProjectDetail } from './pages/ProjectDetail.jsx';
import { Projects } from './pages/Projects.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading" />;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GuestOnly><Landing /></GuestOnly>} />
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/new" element={<NewProject />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/jobs/:id" element={<JobView />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
