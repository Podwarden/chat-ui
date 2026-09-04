"use client";

import { forwardRef } from "react";
import { cn } from "./cn";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "default", size = "md", disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-chat-accent focus-visible:ring-offset-2 focus-visible:ring-offset-chat-surface disabled:pointer-events-none disabled:opacity-50",
        {
          "bg-chat-user text-chat-on-accent hover:bg-chat-accent-strong": variant === "default",
          "bg-chat-surface-2 text-chat-fg hover:bg-chat-dim": variant === "secondary",
          "border border-chat-rule bg-transparent hover:bg-chat-surface-2": variant === "outline",
          "hover:bg-chat-surface-2 hover:text-chat-fg": variant === "ghost",
          "bg-chat-negative text-chat-on-accent hover:opacity-90": variant === "destructive",
        },
        {
          "h-8 px-3 text-xs": size === "sm",
          "h-9 px-4 text-sm": size === "md",
          "h-10 px-6 text-sm": size === "lg",
        },
        className
      )}
      disabled={disabled}
      {...props}
    />
  );
});

Button.displayName = "Button";
