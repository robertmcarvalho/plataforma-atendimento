import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Login',
  icons: {
    icon: [
      { url: '/branding/aethera-favicon.svg', type: 'image/svg+xml' },
      { url: '/branding/aethera-favicon-light.svg', media: '(prefers-color-scheme: light)', type: 'image/svg+xml' },
      { url: '/branding/aethera-favicon-dark.svg', media: '(prefers-color-scheme: dark)', type: 'image/svg+xml' },
    ],
    shortcut: '/branding/aethera-favicon.svg',
    apple: '/branding/aethera-favicon.svg',
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
