export default function Loading() {
  return (
    <>
      <div className="loading-bar" style={{ margin: "24px 0 16px" }} />
      <div className="intelligence-feed" style={{ marginTop: 16 }}>
        <div className="skeleton-card" style={{ height: 160 }} />
        <div className="skeleton-card" style={{ height: 160 }} />
        <div className="skeleton-card" style={{ height: 160 }} />
      </div>
    </>
  );
}
