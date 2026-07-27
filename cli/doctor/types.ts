export type DoctorStatus = "passed" | "failed" | "warning" | "skipped";

export interface DoctorResult {
  id: string;
  section: string;
  label: string;
  status: DoctorStatus;
  message?: string;
  help?: string[];
  required: boolean;
}
