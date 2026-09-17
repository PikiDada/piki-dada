import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        // A soft halo on focus rather than a hard 2px black ring -- same affordance,
        // far less jarring, and it keeps the field feeling part of the surface.
        "flex h-11 w-full rounded-xl border border-neutral-300 bg-white px-4 text-sm text-neutral-900 transition-all duration-150 placeholder:text-neutral-500 focus:border-neutral-900 focus:outline-none focus:ring-4 focus:ring-neutral-900/10 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
