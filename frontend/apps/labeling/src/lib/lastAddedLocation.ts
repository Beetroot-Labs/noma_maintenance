export type LastAddedLocation = {
  buildingId: string;
  locationId: string;
  floor: string | null;
  wing: string | null;
  room: string | null;
};

const storageKey = (userId: string) => `labeling:last-added-location:${userId}`;

export const getLastAddedLocation = (userId: string): LastAddedLocation | null => {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<LastAddedLocation>;
    if (
      typeof parsed.buildingId !== "string"
      || typeof parsed.locationId !== "string"
    ) {
      return null;
    }

    return {
      buildingId: parsed.buildingId,
      locationId: parsed.locationId,
      floor: typeof parsed.floor === "string" ? parsed.floor : null,
      wing: typeof parsed.wing === "string" ? parsed.wing : null,
      room: typeof parsed.room === "string" ? parsed.room : null,
    };
  } catch {
    return null;
  }
};

export const setLastAddedLocation = (userId: string, value: LastAddedLocation) => {
  window.localStorage.setItem(storageKey(userId), JSON.stringify(value));
};

export const clearLastAddedLocation = (userId: string) => {
  window.localStorage.removeItem(storageKey(userId));
};
