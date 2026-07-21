/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
import type { ReactNode } from "react";
import { KeyRound } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AuthCardProps {
  children: ReactNode;
  description: string;
  footer: ReactNode;
  title: string;
}

export function AuthCard({
  children,
  description,
  footer,
  title,
}: AuthCardProps) {
  return (
    <section
      aria-labelledby="auth-page-title"
      className="flex min-h-[calc(100svh-8rem)] w-full items-center justify-center py-4 sm:py-8"
    >
      <Card className="w-full max-w-sm overflow-hidden" variant="work">
        <CardHeader className="gap-3">
          <div className="grid size-11 place-items-center rounded-full bg-secondary text-secondary-foreground">
            <KeyRound aria-hidden="true" size={20} />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <CardTitle>
              <h1
                className="text-2xl font-medium leading-tight [overflow-wrap:anywhere]"
                id="auth-page-title"
              >
                {title}
              </h1>
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              {description}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {children}
          <div className="border-t border-border pt-4">{footer}</div>
        </CardContent>
      </Card>
    </section>
  );
}
