export default function Loading() {
  return (
    <>
      <div className="mb-1 border-b border-border pb-5">
        <div className="min-w-0">
          <div className="h-11 w-[min(360px,100%)] rounded-[16px] bg-muted animate-pulse" />
        </div>
      </div>
      <div className="grid gap-3.5">
        <div className="h-32 rounded-[24px] bg-card shadow-sm animate-pulse" />
        <div className="h-32 rounded-[24px] bg-card shadow-sm animate-pulse" />
        <div className="h-32 rounded-[24px] bg-card shadow-sm animate-pulse" />
      </div>
    </>
  );
}
