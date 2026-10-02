import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        surface: 'var(--surface)',
        'surface-elevated': 'var(--surface-elevated)',
        'surface-hover': 'var(--surface-hover)',
        foreground: 'var(--foreground)',
        'muted-foreground': 'var(--muted-foreground)',
        'subtle-foreground': 'var(--subtle-foreground)',
        border: 'var(--border)',
        primary: 'var(--primary)',
        'primary-foreground': 'var(--primary-foreground)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        destructive: 'var(--destructive)',
        muted: 'var(--muted)',
        card: 'var(--card)',
        popover: 'var(--popover)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        accent: 'var(--accent)',
        'accent-foreground': 'var(--accent-foreground)',
        secondary: 'var(--secondary)',
        'secondary-foreground': 'var(--secondary-foreground)',
        sidebar: {
          DEFAULT: 'var(--sidebar-background)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
        },
        channel: {
          whatsapp: 'var(--channel-whatsapp)',
          instagram: 'var(--channel-instagram)',
          email: 'var(--channel-email)',
          webchat: 'var(--channel-webchat)',
          telegram: 'var(--channel-telegram)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Open Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'Menlo', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        'tight-2': '-0.02em',
      },
      boxShadow: {
        glow: 'var(--shadow-glow)',
        elevated: 'var(--shadow-elevated)',
      },
      backgroundImage: {
        'gradient-primary': 'var(--gradient-primary)',
        'gradient-glow': 'var(--gradient-glow)',
      },
      transitionTimingFunction: {
        snappy: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        150: '150ms',
        200: '200ms',
      },
    },
  },
};

export default config;
