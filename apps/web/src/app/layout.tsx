import type { Metadata } from 'next';
import Script from 'next/script';
import '@fontsource-variable/open-sans';
import './globals.css';
import { Providers } from './providers';
import { cn } from '@/lib/utils';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

export const metadata: Metadata = {
  title: {
    default: 'Aethera',
    template: '%s · Aethera',
  },
  description: 'Aethera — plataforma omnichannel de atendimento e suporte',
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={cn('dark antialiased font-sans')}
      data-scroll-behavior="smooth"
    >
      <body suppressHydrationWarning>
        <Script id="fluxfarma-theme-boot" strategy="beforeInteractive">
          {`(function(){try{var k='fluxfarma-theme',L='coopmob-theme';var stored=localStorage.getItem(k)||localStorage.getItem(L);var t=stored||'dark';function d(){return window.matchMedia('(prefers-color-scheme: dark)').matches}var uiLight=t==='light'||(t==='system'&&!d());document.documentElement.classList.toggle('dark',!uiLight);document.documentElement.classList.remove('theme-light');function favLight(){if(!stored)return!d();return t==='light'||(t==='system'&&!d());}function s(){var icon=favLight()?'/branding/aethera-favicon-light.svg':'/branding/aethera-favicon-dark.svg';document.querySelectorAll('link[rel="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]').forEach(function(el){el.setAttribute('href',icon);el.setAttribute('type','image/svg+xml');});}s();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',s);}catch(e){}})();`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
