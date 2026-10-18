import { NavLink, Navigate, Outlet, RouterProvider, createHashRouter } from "react-router";
import { CupPage } from "./CupPage";
import { LedgerPage } from "./LedgerPage";
import { CompanyPage, MarketsPage } from "./MarketsPage";
import { TradeGame } from "./TradeGame";

export const CITY = "Lanternport";

function Shell() {
  return (
    <div className="site">
      <header className="site-bar">
        <NavLink to="/" className="site-brand" aria-label={`${CITY} home`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2 9 6h6l-3-4Z" className="lamp-top" />
            <rect x="8.5" y="6" width="7" height="8" rx="1.5" className="lamp-glow" />
            <path d="M9 14h6l1 8H8l1-8Z" className="lamp-base" />
          </svg>
          <span>{CITY}</span>
        </NavLink>
        <nav aria-label="Sections">
          <NavLink to="/" end>Ledger</NavLink>
          <NavLink to="/trade">Trade</NavLink>
          <NavLink to="/cup">Cup</NavLink>
          <NavLink to="/markets">Markets</NavLink>
        </nav>
      </header>
      <main className="site-main">
        <Outlet />
      </main>
    </div>
  );
}

// Hash URLs (#/markets) work on any static host, including GitHub Pages, without server rewrites.
const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <LedgerPage /> },
      { path: "/ledger/:date", element: <LedgerPage /> },
      { path: "/trade", element: <TradeGame /> },
      { path: "/cup", element: <CupPage /> },
      { path: "/markets", element: <MarketsPage /> },
      { path: "/company/:id", element: <CompanyPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
