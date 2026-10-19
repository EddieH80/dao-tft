"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Guided" },
  { href: "/quick", label: "Quick" },
  { href: "/about", label: "About" },
] as const;

export function NavLinks() {
  const path = usePathname();
  return (
    <div className="flex gap-5 text-sm text-muted">
      {LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={path === href ? "page" : undefined}
          className={path === href ? "text-gold-bright" : "hover:text-gold-bright"}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
