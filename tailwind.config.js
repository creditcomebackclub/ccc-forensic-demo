/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1B2A4A',
          dark: '#131F36',
          light: '#2A3C5F',
        },
        gold: {
          DEFAULT: '#C9A84C',
          dark: '#A88A37',
        },
        ink: {
          DEFAULT: '#1A1A1A',
          muted: '#6B6B66',
          faint: '#9B9B95',
        },
        bg: '#FAFAF7',
        card: '#FFFFFF',
        border: '#E8E6DF',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
