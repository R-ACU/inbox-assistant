/** The tenant of a deployment, picked by its language (APP_LOCALE). */
import type { Locale } from "../shared/locale";
import { TENANT, type TenantProfile } from "./profile";
import { TENANT_EN } from "./profile-en";

export type { TenantProfile };

export function tenantFor(locale: Locale): TenantProfile {
  return locale === "en" ? TENANT_EN : TENANT;
}
