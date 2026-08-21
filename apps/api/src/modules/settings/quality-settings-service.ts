import { AppError } from "@follow115/contracts";

export type DefaultTargetQuality = "2160p" | "1080p";

export interface QualitySettingsStore {
  saveDefaultTargetQuality(value: DefaultTargetQuality): Promise<void>;
}

export function defaultTargetQuality(value: unknown): DefaultTargetQuality {
  if (value !== "2160p" && value !== "1080p") {
    throw new AppError("VALIDATION_ERROR", "defaultTargetQuality must be 2160p or 1080p.");
  }
  return value;
}

export class QualitySettingsService {
  constructor(private readonly store: QualitySettingsStore) {}
  async save(value: unknown): Promise<{ defaultTargetQuality: DefaultTargetQuality }> {
    const quality = defaultTargetQuality(value);
    await this.store.saveDefaultTargetQuality(quality);
    return { defaultTargetQuality: quality };
  }
}

export class InMemoryQualitySettingsStore implements QualitySettingsStore {
  value: DefaultTargetQuality = "1080p";
  async saveDefaultTargetQuality(value: DefaultTargetQuality): Promise<void> { this.value = value; }
}
