export type LayerId = "skeleton" | "organs" | "muscle" | "skin" | "suit";
export type ScenarioId =
  "nominal" | "cardiac" | "respiratory" | "thermal" | "radiation";
export type OrganId = "heart" | "lungs" | "brain" | "digestive" | "suit";
export interface Vitals {
  bpm: number;
  spo2: number;
  systolic: number;
  diastolic: number;
  temperature: number;
  radiation: number;
  respiratoryRate: number;
}
export interface SimulationFrame {
  vitals: Vitals;
  alert: null | {
    organ: OrganId;
    title: string;
    message: string;
    recommendation: string;
  };
  source: "simulated";
}
export interface TwinSceneProps {
  layers: Record<LayerId, number>;
  vitals: Vitals;
  alertOrgan: OrganId | null;
  paused: boolean;
  reducedMotion: boolean;
  view: "front" | "back";
  resetKey: number;
  selectedOrgan: OrganId | null;
  onSelectOrgan: (id: OrganId) => void;
  onPerformance?: (fps: number) => void;
}
