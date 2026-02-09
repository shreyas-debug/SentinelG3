"use client";

/**
 * Radar sweep animation for the empty-state Healing History section.
 * Circular with a sweeping gradient "arm" that rotates, plus
 * concentric pulsing rings.
 */
export function RadarAnimation() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      {/* Radar container */}
      <div className="relative w-32 h-32">
        {/* Concentric rings */}
        <div className="absolute inset-0 rounded-full border border-[var(--color-emerald)]/10" />
        <div className="absolute inset-4 rounded-full border border-[var(--color-emerald)]/15" />
        <div className="absolute inset-8 rounded-full border border-[var(--color-emerald)]/20" />
        <div className="absolute inset-12 rounded-full border border-[var(--color-emerald)]/30" />

        {/* Center dot */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-2 w-2 rounded-full bg-[var(--color-emerald)] shadow-[0_0_8px_var(--color-emerald)]" />
        </div>

        {/* Sweeping arm (conic gradient) */}
        <div
          className="absolute inset-0 rounded-full radar-sweep"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, transparent 330deg, rgba(16,185,129,0.25) 345deg, rgba(16,185,129,0.5) 360deg)",
            maskImage: "radial-gradient(circle, black 0%, black 50%, transparent 50%)",
            WebkitMaskImage: "radial-gradient(circle, transparent 0%, transparent 10%, black 10%, black 50%, transparent 50%)",
          }}
        />

        {/* Ping ring */}
        <div className="absolute inset-0 rounded-full border border-[var(--color-emerald)]/40 radar-ping" />
      </div>

      {/* Label */}
      <div className="text-center">
        <p className="text-[13px] font-semibold text-[var(--color-text-secondary)]">
          No Threats Detected
        </p>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
          Run a scan to start monitoring for vulnerabilities
        </p>
      </div>
    </div>
  );
}
