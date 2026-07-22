import { RegisterForm } from "./register-form";
import { normalizeAuthReturnPath } from "@/lib/auth-access";
import { isAuthEnabled } from "@/lib/auth";

interface RegisterPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await Promise.resolve(searchParams ?? {});
  const returnPath = normalizeAuthReturnPath(readParam(params.next));

  return <RegisterForm authEnabled={isAuthEnabled()} returnPath={returnPath} />;
}

function readParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : null;
}
