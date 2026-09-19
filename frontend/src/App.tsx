import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Browser from "./pages/Browser";
import PublicShare from "./pages/PublicShare";
import { isLoggedIn } from "./lib/api";

function Protected({ children }: { children: JSX.Element }) {
  return isLoggedIn() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/share/:token" element={<PublicShare />} />
        <Route path="/" element={<Protected><Browser /></Protected>} />
      </Routes>
    </BrowserRouter>
  );
}
