export function getProjectManagementActions(status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DEREGISTERED") {
  if (status === "ARCHIVED") return ["De-register Project"] as const;
  if (status === "PAUSED") return ["Resume Project", "Archive Project", "De-register Project"] as const;
  if (status === "ACTIVE") return ["Pause Project", "Archive Project", "De-register Project"] as const;
  return [] as const;
}
