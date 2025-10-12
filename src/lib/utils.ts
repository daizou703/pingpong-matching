// src/lib/utils.ts
import { type ClassValue } from "clsx";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind のクラスを安全に結合 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
