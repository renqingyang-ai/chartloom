/**
 * Frozen chart presentation tokens.
 *
 * Shared chart components use this self-contained baseline.
 * Runtime theme selection is configured separately through the theme files.
 */

const FROZEN_COLORS = {
  "bg": {
    "primary": "#FFFFFF",
    "secondary": "#F8F7F5",
    "tertiary": "#F1EFEB",
    "dark": "#1D262D",
    "overlay": "rgba(29, 38, 45, 0.3)",
    "blur": "rgba(28, 37, 44, 0.6)"
  },
  "text": {
    "primary": "#1D262D",
    "secondary": "rgba(29, 38, 45, 0.8)",
    "white": "#FFFFFF",
    "accent": "#F2D593",
    "muted": "rgba(29, 38, 45, 0.6)",
    "white80": "rgba(255, 255, 255, 0.8)",
    "white60": "rgba(255, 255, 255, 0.6)",
    "dark80": "rgba(29, 38, 45, 0.8)",
    "dark60": "rgba(29, 38, 45, 0.6)",
    "dark50": "rgba(29, 38, 45, 0.5)"
  },
  "table": {
    "header": "#DECFBA",
    "row": "#D7DEE3",
    "highlight": "#232B32"
  },
  "border": {
    "primary": "#C5CBCE",
    "light": "#E8E8E8",
    "accent": "#F2D593"
  },
  "overlay": {
    "dark": "rgba(0, 0, 0, 0.3)",
    "light": "rgba(255, 255, 255, 0.2)",
    "glass": "rgba(2, 2, 2, 0.60)",
    "glassBorder": "rgba(255, 255, 255, 0.60)"
  },
  "grayscale": {
    "gray100": "#F3F4F6",
    "gray500": "#6B7280",
    "gray600": "#4B5563",
    "gray700": "#374151"
  }
} as const;
const FROZEN_TYPOGRAPHY = {
  "fonts": {
    "display": "'Kaisei Tokumin', serif",
    "heading": "'Kaisei Tokumin', serif",
    "body": "'Source Serif 4', serif",
    "data": "'Source Serif 4', serif",
    "ui": "'Inter', sans-serif",
    "sans": "'Source Sans 3', sans-serif",
    "comment": "'Source Sans 3', sans-serif"
  },
  "sizes": {
    "display": 88,
    "h1": 48,
    "h2": 32,
    "h3": 24,
    "h4": 20,
    "body": 20,
    "bodySmall": 16,
    "caption": 14,
    "finePrint": 12,
    "xxs": 12,
    "xs": 14,
    "sm": 16,
    "base": 20,
    "lg": 24,
    "xl": 32,
    "2xl": 48,
    "3xl": 88
  },
  "weights": {
    "regular": 400,
    "medium": 500,
    "semibold": 600,
    "bold": 700,
    "extrabold": 800
  },
  "lineHeights": {
    "tight": 1.2,
    "normal": 1.5,
    "relaxed": 1.8,
    "table": 1,
    "auto": "auto",
    "none": "normal"
  },
  "letterSpacing": {
    "normal": "0",
    "wide": "0.2em",
    "extraWide": "0.3em"
  }
} as const;
export const SPACING = {
  "xs": 4,
  "sm": 8,
  "md": 16,
  "lg": 24,
  "xl": 32,
  "2xl": 64
} as const;
export const OPACITY = {
  "30": 0.3,
  "60": 0.6,
  "80": 0.8
} as const;

export const COLORS = window.CHART_PLATFORM_THEME?.colors || FROZEN_COLORS;
export const TYPOGRAPHY = window.CHART_PLATFORM_THEME?.typography || FROZEN_TYPOGRAPHY;
