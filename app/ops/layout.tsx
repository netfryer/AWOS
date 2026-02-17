import Link from "next/link";
import { opsStyles } from "./styles";

export default function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={opsStyles.page}>
      <header style={opsStyles.header}>
        <div style={opsStyles.headerInner}>
          <h1 style={opsStyles.headerTitle}>Ops Console</h1>
          <nav style={opsStyles.nav}>
            <Link href="/" style={opsStyles.navLink}>
              ← Chat
            </Link>
            <span style={{ color: "#cbd5e1", margin: "0 4px" }}>|</span>
            <Link href="/ops/run" style={opsStyles.navLink}>
              Run
            </Link>
            <Link href="/ops/runs" style={opsStyles.navLink}>
              Runs
            </Link>
            <Link href="/ops/tests" style={opsStyles.navLink}>
              Tests
            </Link>
            <Link href="/ops/kpis" style={opsStyles.navLink}>
              KPIs
            </Link>
            <Link href="/ops/governance" style={opsStyles.navLink}>
              Governance
            </Link>
            <Link href="/ops/model-hr" style={opsStyles.navLink}>
              Model HR
            </Link>
            <Link href="/ops/procurement" style={opsStyles.navLink}>
              Procurement
            </Link>
          </nav>
        </div>
      </header>
      <main style={opsStyles.main}>
        <div style={opsStyles.mainInner}>{children}</div>
      </main>
    </div>
  );
}
