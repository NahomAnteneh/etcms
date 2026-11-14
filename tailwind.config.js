/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: '#06090e',
          900: '#090d16',
          850: '#0d131f',
          800: '#111827',
          750: '#172033',
          700: '#1f2937',
          600: '#374151',
          500: '#4b5563',
          400: '#9ca3af',
          300: '#d1d5db',
          100: '#f3f4f6',
        },
        criticality: {
          tier0: '#ef4444',
          tier1: '#f59e0b',
          tier2: '#3b82f6',
          tier3: '#9ca3af',
        },
        lifecycle: {
          inservice: '#10b981',
          planned: '#8b5cf6',
          deprecated: '#f59e0b',
          retired: '#6b7280',
        },
        handshake: {
          confirmed: '#10b981',
          pending: '#f59e0b',
          flagged: '#ef4444',
          rejected: '#6b7280',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': '0.6875rem', // 11px
      },
    },
  },
  plugins: [],
};
