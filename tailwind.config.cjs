/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./components/**/*.{js,ts}"],
  theme: {
    extend: {},
  },
  plugins: [require("@tailwindcss/typography")],
};
