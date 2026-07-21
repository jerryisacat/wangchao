import { RegisterForm } from "./register-form";
import { isAuthEnabled } from "@/lib/auth";

export default function RegisterPage() {
  return <RegisterForm authEnabled={isAuthEnabled()} />;
}
