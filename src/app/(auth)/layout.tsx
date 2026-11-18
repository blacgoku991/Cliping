import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { getUser } from "@/lib/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getUser()) redirect("/app");
  return (
    <div className="grid-glow grid min-h-dvh place-items-center px-5 pb-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center"><Logo /></Link>
        {children}
      </div>
    </div>
  );
}
