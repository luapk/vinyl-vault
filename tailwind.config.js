/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Instrument Serif'", "serif"],
        sans: ["'Hanken Grotesk'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      colors: {
        white: 'rgb(var(--color-white) / <alpha-value>)',
      },
      fontSize: {
        xs:   ['0.9375rem',  { lineHeight: '1.35rem'  }],
        sm:   ['1.09375rem', { lineHeight: '1.625rem' }],
        base: ['1.25rem',    { lineHeight: '1.875rem' }],
        lg:   ['1.40625rem', { lineHeight: '2rem'     }],
        xl:   ['1.5625rem',  { lineHeight: '2.125rem' }],
        '2xl':['1.875rem',   { lineHeight: '2.375rem' }],
        '3xl':['2.34375rem', { lineHeight: '2.75rem'  }],
        '4xl':['2.8125rem',  { lineHeight: '3.25rem'  }],
        '5xl':['3.75rem',    { lineHeight: '1'        }],
        '6xl':['4.6875rem',  { lineHeight: '1'        }],
        '7xl':['5.625rem',   { lineHeight: '1'        }],
        '8xl':['7.5rem',     { lineHeight: '1'        }],
        '9xl':['10rem',      { lineHeight: '1'        }],
      },
    },
  },
  plugins: [],
};
