import type { Tone } from "@/components/ui";

export function projectTone(status: string): Tone {
  switch (status) {
    case "production":
    case "completed":
      return "green";
    case "order":
      return "amber";
    case "lost":
      return "red";
    default:
      return "neutral";
  }
}

export function clientTone(status: string): Tone {
  return status === "active" ? "green" : "neutral";
}

export function qcTone(status: string): Tone {
  return status === "released" ? "green" : status === "rejected" ? "red" : "neutral";
}

export function requestTone(status: string): Tone {
  return status === "approved" ? "green" : status === "rejected" ? "red" : "neutral";
}

/** Lifecycle stage index 0–7 (8 = all done) used by the stage tracker. */
export function projectStage(status: string, hasReservations: boolean): number {
  switch (status) {
    case "inquiry": return 0;
    case "formulation": return 1;
    case "offer": return 2;
    case "order": return hasReservations ? 4 : 3;
    case "production": return 5;
    case "completed": return 8;
    default: return 0;
  }
}

export function formulaTone(status: string): Tone {
  return status === "approved" ? "green" : status === "archived" ? "neutral" : "amber";
}
