/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Jost', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Primary - Forest Green (calming, natural)
        forest: {
          50: '#f4f7f4',
          100: '#e3ebe3',
          200: '#c7d7c7',
          300: '#9fb99f',
          400: '#6f9470',
          500: '#4d7650',
          600: '#3b5e3e',
          700: '#314c33',
          800: '#293d2b',
          900: '#233325',
          950: '#111c12',
        },
        // Secondary - Warm Sand/Tan
        sand: {
          50: '#faf8f5',
          100: '#f3efe7',
          200: '#e6ddcd',
          300: '#d5c5ab',
          400: '#c2a785',
          500: '#b4916a',
          600: '#a77d5c',
          700: '#8b654d',
          800: '#725443',
          900: '#5e4639',
          950: '#32241d',
        },
        // Accent - Terracotta (warm, earthy pop)
        terracotta: {
          50: '#fdf6f3',
          100: '#fbeae4',
          200: '#f8d6cb',
          300: '#f2b8a5',
          400: '#e99175',
          500: '#dd7050',
          600: '#c95638',
          700: '#a8452d',
          800: '#8b3c29',
          900: '#733627',
          950: '#3e1910',
        },
        // Warm neutrals (replaces slate with warmer tones)
        warm: {
          50: '#faf9f7',
          100: '#f4f2ee',
          200: '#e8e4dd',
          300: '#d6d0c4',
          400: '#b8af9f',
          500: '#9f9483',
          600: '#8a7d6d',
          700: '#73675a',
          800: '#60564c',
          900: '#514941',
          950: '#2a2622',
        },
      },
    },
  },
  plugins: [],
}
