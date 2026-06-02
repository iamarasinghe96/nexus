/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0d2240',
        teal: '#1D9E75',
        'light-teal': '#5dcaa5',
        amber: '#fac775',
        red: '#E24B4A',
        blue: '#378ADD',
        green: '#97C459',
      },
    },
  },
  plugins: [],
}
