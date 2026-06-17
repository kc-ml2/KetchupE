import { useContext, PropsWithChildren } from "react";
import { Agentation } from "agentation";
import {
  HashRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthProvider } from "@Contexts/AuthProvider";
import { ThemeProvider } from "@Contexts/ThemeProvider";
import { AuthContextType } from "@app-types/AuthContext.types";
import "./App.scss";
import LoginPage from "@Pages/LoginPage";
import ChatbotPage from "@Pages/ChatbotPage";
import TeamDetailPage from "@Pages/TeamDetailPage";

const Layout = ({ children }: PropsWithChildren) => {
  return (
    <div className="flex flex-col h-screen bg-white">
      <main className="flex-1 min-h-0 flex flex-col bg-white">{children}</main>
    </div>
  );
};

const ProtectedRoute = ({ children }: PropsWithChildren) => {
  const { isAuthenticated } = useContext(AuthContext) as AuthContextType;
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/chatbot"
        element={
          <ProtectedRoute>
            <ChatbotPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/team/:teamId"
        element={
          <ProtectedRoute>
            <TeamDetailPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/chatbot" replace />} />
    </Routes>
  );
};

const App = () => {
  const isElectron =
    typeof window !== "undefined" && window.location.protocol === "file:";
  // 웹/Electron 모두 HashRouter 사용.
  // 정적 서버(history fallback 미설정)에서 /login·/chatbot 직접 진입·새로고침 시
  // 발생하던 404를 방지한다. (URL은 .../#/login 형태)
  const Router = HashRouter;

  return (
    <Router>
      <ThemeProvider>
        <AuthProvider>
          <Layout>
            <AppRoutes />
          </Layout>
          <Toaster position="top-right" />
        </AuthProvider>
      </ThemeProvider>
      {process.env.NODE_ENV === "development" && !isElectron && (
        <Agentation
          endpoint="http://localhost:4747"
          onSessionCreated={(sessionId) => {
            console.log("Session started:", sessionId);
          }}
        />
      )}
    </Router>
  );
};

export default App;
