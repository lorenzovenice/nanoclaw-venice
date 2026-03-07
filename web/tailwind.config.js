/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'venice-blue': '#0A1E3F',
        'venice-blue-light': '#112d5a',
        'venice-gold': '#D4AF37',
        'venice-marble': '#F8F8F8',
        'venice-chrome': '#C0C0C0',
        'venice-lantern': '#FFA726',
        'venice-success': '#4CAF50',
        'venice-error': '#EF5350',
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'serif'],
        body: ['Inter', 'sans-serif'],
      },
      borderColor: {
        'venice-gold': '#D4AF37',
      },
    },
  },
  plugins: [],
};
