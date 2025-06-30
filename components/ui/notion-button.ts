// File: ./components/ui/notion-button.ts
import { html, type TemplateResult, nothing } from "lit-html";
import { classMap } from "lit-html/directives/class-map.js";

// --- Props interface for the new functional button ---
interface NotionButtonProps {
  children: TemplateResult | string;
  loading?: boolean;
  href?: string;
  type?: "button" | "submit" | "reset";
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
}

/**
 * A functional, stateless button component that returns a lit-html template.
 * It's designed to be composed directly into other views.
 */
export const NotionButton = (props: NotionButtonProps): TemplateResult => {
  const {
    children,
    loading = false,
    href,
    type = "submit",
    onClick,
    disabled = false,
  } = props;

  const _handleClick = (e: MouseEvent) => {
    // Preserve the micro-interaction animation
    const button = e.currentTarget as HTMLElement;
    button.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(0.95)" },
        { transform: "scale(1)" },
      ],
      { duration: 0.2, easing: "ease-in-out" },
    );

    // Call the provided onClick handler if it exists
    onClick?.(e);
  };

  const classes = {
    "inline-flex": true,
    "items-center": true,
    "justify-center": true,
    "gap-2": true,
    "px-4": true,
    "py-2": true,
    "bg-zinc-800": true,
    "text-white": true,
    "rounded-md": true,
    "hover:bg-zinc-700": true,
    "font-semibold": true,
    "text-sm": true,
    "transition-colors": true,
    "duration-150": true,
    "focus-visible:outline-none": true,
    "focus-visible:ring-2": true,
    "focus-visible:ring-zinc-500": true,
    "focus-visible:ring-offset-2": true,
    "disabled:bg-zinc-600": true,
    "disabled:pointer-events-none": true,
  };

  const spinner = html`
    <span
      class="h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-white"
      aria-hidden="true"
    ></span>
  `;

  if (href) {
    return html` <a href=${href} class=${classMap(classes)}> ${children} </a> `;
  }

  return html`
    <button
      .type=${type}
      ?disabled=${loading || disabled}
      aria-busy=${loading}
      @click=${_handleClick}
      class=${classMap(classes)}
    >
      ${loading ? spinner : nothing} ${children}
    </button>
  `;
};
