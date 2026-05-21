'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';
import { brandingLogoSrc, brandingMarkSrc } from '@/lib/brandingAssets';
import { isLightTheme, useThemePreference } from '@/hooks/useThemePreference';

export type LogoVariant = 'full' | 'mark';

type LogoProps = {
  variant?: LogoVariant;
  className?: string;
  /** Largura em px (full usa logo horizontal; mark usa ícone quadrado) */
  width?: number;
  /** Marca acima da dobra (login, etc.) — evita aviso LCP do Next.js */
  priority?: boolean;
  /** `auto` segue preferência do usuário; use `dark` em telas com fundo escuro fixo (ex.: login). */
  appearance?: 'auto' | 'light' | 'dark';
};

function resolveLight(appearance: LogoProps['appearance'], preference: ReturnType<typeof useThemePreference>['preference']) {
  if (appearance === 'light') return true;
  if (appearance === 'dark') return false;
  return isLightTheme(preference);
}

export function Logo({
  variant = 'full',
  className,
  width,
  priority,
  appearance = 'auto',
}: LogoProps) {
  const { preference } = useThemePreference();
  const light = resolveLight(appearance, preference);

  if (variant === 'mark') {
    const w = width ?? 28;
    return (
      <Image
        src={brandingMarkSrc(light)}
        alt=""
        width={w}
        height={w}
        priority={priority}
        className={cn('shrink-0 object-contain', className)}
      />
    );
  }

  const w = width ?? 220;
  const h = Math.round((w * 48) / 260);
  return (
    <Image
      src={brandingLogoSrc(light)}
      alt="Aethera"
      width={w}
      height={h}
      priority
      className={cn('h-auto w-full max-w-[260px] object-contain object-left', className)}
    />
  );
}
