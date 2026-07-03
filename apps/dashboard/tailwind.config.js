/** @type {import('tailwindcss').Config} */
export default {
  // Scan only source files — keeps the CSS bundle minimal in production.
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],

  // Dark mode is class-based: toggled by adding `.dark` to <html>.
  // The entire UI is dark-first; light mode may be added as a theme later.
  // Default to light mode for Apple theme
  darkMode: 'media',

  theme: {
    extend: {
      // ── Color palette ────────────────────────────────────────────────────
      // Nebula Scheduler uses slate as the neutral surface, indigo as the
      // brand/interactive accent, and emerald for success/health signals.
      colors: {
        // Base surfaces (Warm Glass Mode)
        surface: {
          DEFAULT: '#FDFBF7',   // app background — soft warm cream
          raised:  '#FFFCF9',   // cards, panels — lighter warm cream
          overlay: 'rgba(255, 252, 249, 0.6)', // modals, dropdowns — topmost layer (glass)
          border:  '#EBE5DC',   // dividers and border colors
        },

        // Brand accent — Vibrant Orange
        brand: {
          50:  '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#F97316',   // primary interactive (orange-500)
          600: '#EA580C',   // hover / active (orange-600)
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
          950: '#431407',
        },

        // Success / healthy signal
        success: {
          DEFAULT: '#34C759',
          muted:   '#d1fae5',   // light emerald background
          text:    '#065f46',   // dark emerald text
        },

        // Warning signal
        warning: {
          DEFAULT: '#FF9500',
          muted:   '#fef3c7',
          text:    '#92400e',
        },

        // Danger / failure signal
        danger: {
          DEFAULT: '#FF3B30',
          muted:   '#fee2e2',
          text:    '#991b1b',
        },

        // Neutral muted signal
        muted: {
          DEFAULT: '#5C4F45',   // secondary text
          subtle:  '#8A7C72',   // tertiary text
        },

        // Semantic text colors (Warm Dark Browns)
        text: {
          primary: '#2D241E',
          secondary: '#5C4F45',
          tertiary: '#8A7C72',
        }
      },

      // ── Typography ────────────────────────────────────────────────────────
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },

      // ── Custom shadow tokens ───────────────────────────────────────────────
      boxShadow: {
        // Subtle glow used on focused/active interactive elements
        'glow-brand':   '0 0 0 3px rgba(249, 115, 22, 0.25)',
        'glow-success': '0 0 0 3px rgba(52, 199, 89, 0.25)',
        'glow-danger':  '0 0 0 3px rgba(255, 59, 48, 0.25)',
        // Card elevation shadows for light surfaces (Apple style)
        'card':         '0 2px 8px rgba(0,0,0,0.04)',
        'card-lg':      '0 4px 14px rgba(0,0,0,0.05)',
      },

      // ── Animations ────────────────────────────────────────────────────────
      keyframes: {
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-left': {
          '0%':   { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
      },
      animation: {
        'fade-in':       'fade-in 0.2s ease-out both',
        'slide-in-left': 'slide-in-left 0.2s ease-out both',
        'pulse-slow':    'pulse-slow 2s ease-in-out infinite',
        'shimmer':       'shimmer 1.5s infinite linear',
      },

      // ── Border radius ─────────────────────────────────────────────────────
      borderRadius: {
        'xl':  '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },

      // ── Background sizes (for shimmer gradient) ────────────────────────────
      backgroundSize: {
        '200%': '200%',
      },
    },
  },

  plugins: [],
};
