import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "requests":
      return "status-requests";
    case "draft":
      return "status-draft";
    case "waiting":
      return "status-waiting";
    case "assigned":
      return "status-assigned";
    case "running":
      return "status-running";
    default:
      return "status-draft";
  }
}

export function formatHours(hours: number): string {
  return `${Math.round(hours * 10) / 10}h`;
}

export function formatDays(hours: number, hoursPerDay: number = 8): string {
  const days = hours / hoursPerDay;
  return `~${Math.round(days * 10) / 10} days`;
}

export function getOperatorInitials(name: string): string {
  return name
    .split(" ")
    .map(part => part.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function calculateCapacityPercentage(scheduled: number, available: number): number {
  return Math.round((scheduled / available) * 100);
}

export function getCapacityColor(percentage: number): string {
  if (percentage >= 90) return "bg-red-500";
  if (percentage >= 75) return "bg-yellow-500";
  if (percentage >= 50) return "bg-blue-500";
  return "bg-green-500";
}
