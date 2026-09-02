import { useEffect } from "react";

/* Maps whatever grade the learner is working in to an interface band, and
   stamps it on <html>. K-2 gets larger type and touch targets; 6-8 gets a
   denser layout. Falls back to the middle band so nothing is ever unstyled. */
export function bandFor(grade: string | null | undefined): "junior" | "middle" | "senior" {
  if (!grade) return "middle";
  const g = String(grade).replace(/^g/, "").toUpperCase();
  if (g === "K" || g === "1" || g === "2") return "junior";
  if (g === "3" || g === "4" || g === "5") return "middle";
  return "senior";
}

export function useAgeBand(grade: string | null | undefined) {
  useEffect(() => {
    document.documentElement.setAttribute("data-band", bandFor(grade));
  }, [grade]);
}
