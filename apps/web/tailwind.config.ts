import type { Config } from 'tailwindcss';

/**
 * Tailwind is only a way to use the design tokens (src/styles/tokens.css) in
 * class names. There are no raw colours here: every colour is a CSS variable,
 * so dark mode and the one-accent-per-screen rule live in one place.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--ink)',
        paper: 'var(--paper)',
        'paper-2': 'var(--paper-2)',
        line: 'var(--line)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        crit: 'var(--crit)',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { DEFAULT: '2px', sm: '2px', md: '2px', lg: '2px' },
      spacing: { 18: '4.5rem', 30: '7.5rem', 40: '10rem' },
      transitionDuration: { DEFAULT: '240ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
  },
  plugins: [],
} satisfies Config;
