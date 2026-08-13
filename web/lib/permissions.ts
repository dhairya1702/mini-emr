import type { UserRole } from "@/lib/types";

export function canManageUsers(role: UserRole | null | undefined) {
  return role === "admin";
}

export function canViewEarnings(role: UserRole | null | undefined) {
  return role === "admin";
}

export function canViewAudit(role: UserRole | null | undefined) {
  return role === "admin";
}

export function canManageClinicSettings(role: UserRole | null | undefined) {
  return role === "admin";
}

export function canUseClinicalTools(role: UserRole | null | undefined) {
  return role === "admin" || role === "doctor";
}

export function canUseBilling(role: UserRole | null | undefined) {
  return role === "admin" || role === "doctor" || role === "staff";
}

export function canUseInventory(role: UserRole | null | undefined) {
  return role === "admin" || role === "doctor" || role === "staff";
}
