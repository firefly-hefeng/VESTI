import type { Platform } from "~lib/types";
import { PLATFORM_TONE } from "./platformTone";

interface PlatformTagProps {
  platform: Platform;
  className?: string;
}

export function PlatformTag({ platform, className = "" }: PlatformTagProps) {
  const style = PLATFORM_TONE[platform];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-vesti-xs font-semibold leading-none tracking-[0.02em] ${style.bg} ${style.text} ${style.border} ${className}`}
    >
      {platform}
    </span>
  );
}
