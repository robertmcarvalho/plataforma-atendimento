import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

export function EmptyState({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('border-dashed bg-muted/30', className)}>
      <CardContent className="p-10 text-center text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}
