import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ComingSoonProps = {
  title: string;
  description: string;
};

export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">Coming soon.</p>
      </CardContent>
    </Card>
  );
}
