import { DataManagementPanel } from "../components/DataManagementPanel";

export function DataPage() {
  return (
    <div className="vesti-shell data-page-shell">
      <header className="data-page-header">
        <h1 className="data-page-title">Data</h1>
      </header>

      <div className="data-page-scroll vesti-scroll">
        <DataManagementPanel />
      </div>
    </div>
  );
}
