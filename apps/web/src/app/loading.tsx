export default function Loading() {
  return (
    <>
      <div className="page-header">
        <div className="page-header-main">
          <div className="loading-bar" />
        </div>
      </div>
      <div className="intelligence-feed">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    </>
  );
}
