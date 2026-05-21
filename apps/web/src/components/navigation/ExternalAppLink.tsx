'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

type ExternalAppLinkProps = ComponentProps<typeof Link> & {
  showIcon?: boolean;
};

export function ExternalAppLink({ className, children, showIcon = false, ...props }: ExternalAppLinkProps) {
  return (
    <Link
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(showIcon && 'inline-flex items-center gap-1', className)}
    >
      {children}
      {showIcon ? <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden /> : null}
    </Link>
  );
}
