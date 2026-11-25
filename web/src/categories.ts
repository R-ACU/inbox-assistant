import type { Category } from "../../src/shared/schemas";

/** Mail categories in display order. Kept here so the web bundle does not pull in zod for one list. */
export const CATEGORIES = ["invoice", "inquiry", "other", "suspicious"] as const satisfies readonly Category[];
