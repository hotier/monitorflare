/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"PingFang SC"', '"Microsoft YaHei"', 'monospace'],
      },
      colors: {
        surface: 'rgba(15,23,42,0.55)',
        'surface-2': 'rgba(15,23,42,0.7)',
      },
    },
  },
  plugins: [],
};
