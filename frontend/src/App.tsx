import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { GroupReportPage } from "./pages/GroupReportPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ReportPage } from "./pages/ReportPage";
import { ResourceReportPage } from "./pages/ResourceReportPage";
import { ResourcesPage } from "./pages/ResourcesPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/resources" replace />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/resources/report" element={<ResourceReportPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/report/groups" element={<GroupReportPage />} />
        <Route path="/report" element={<ReportPage />} />
      </Routes>
    </BrowserRouter>
  );
}
