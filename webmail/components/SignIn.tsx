"use client";

export function SignIn({ error }: { error?: string }) {
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="l">
          <img src="/tjlogo.png" width={48} height={48} alt="TJHSST" />
          <h1>Sign in</h1>
          <p>to continue to TJ Mail</p>
          {error && <p className="signin-err">{error}</p>}
        </div>
        <div className="r">
          <p style={{ fontSize: 14, color: "#444746", marginBottom: 32, maxWidth: 380, lineHeight: "20px" }}>
            Use your Ion account. TJ Mail signs in to the TJHSST mail servers on your behalf; your password is never shared with this app.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <a className="btn text" href="https://ion.tjhsst.edu" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              Go to Ion
            </a>
            <a className="btn primary" href="/api/auth/login" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              Sign in with Ion
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
