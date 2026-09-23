import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { OverUtilizationNotice } from "../components/OverUtilizationNotice";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">PM</span>
          <div>
            <strong>PM Tool</strong>
            <span className="sidebar__tag">Workspace</span>
          </div>
        </div>
        <nav className="sidebar__nav">
          <NavLink
            to="/resources"
            className={({ isActive }) =>
              `nav-item${isActive ? " nav-item--active" : ""}`
            }
          >
            People
          </NavLink>
          <NavLink
            to="/projects"
            className={({ isActive }) =>
              `nav-item${isActive ? " nav-item--active" : ""}`
            }
          >
            Projects
          </NavLink>
        </nav>
        <a
          className="sidebar__link"
          href="http://localhost:8000/docs"
          target="_blank"
          rel="noreferrer"
        >
          API documentation →
        </a>
      </aside>
      <main className="main">
        <OverUtilizationNotice />
        {children}
      </main>
    </div>
  );
}
