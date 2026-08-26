import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { MembersPanel } from "@/pages/shared/MembersPanel";

export function Settings() {
  const { auth } = useAuth();
  const { activeCompany } = useCompany();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your PAKO account.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="settings-email">Email</Label>
            <Input id="settings-email" value={auth?.email ?? ""} readOnly />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
          <CardDescription>
            {activeCompany ? `Who has access to ${activeCompany.name}.` : "Select a company to see its members."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeCompany ? (
            <MembersPanel scope="company" scopeId={activeCompany.id} />
          ) : (
            <p className="text-sm text-muted-foreground">Select or create a company on the Companies page first.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
