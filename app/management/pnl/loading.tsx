export default function Loading() {
  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 animate-pulse h-[280px]"
        />
      ))}
    </div>
  );
}
