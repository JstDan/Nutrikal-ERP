"use client";

export function PrintButton({ label, variant = "primary" }: { label: string; variant?: "primary" | "outline" }) {
  return (
    <button type="button" className={`btn btn-${variant}`} onClick={() => window.print()}>
      {label}
    </button>
  );
}
