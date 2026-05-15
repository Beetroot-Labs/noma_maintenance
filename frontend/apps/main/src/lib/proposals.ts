type ProposalLocationLike = {
  floor?: string | null;
  wing?: string | null;
  room?: string | null;
  location_description?: string | null;
};

type ProposalDeviceLike = {
  barcode?: string | null;
  source_device_code?: string | null;
  kind?: string;
  original_kind?: string | null;
  brand?: string | null;
  model?: string | null;
};

export const parseDecimalInput = (value: string) => value.trim().replaceAll(",", ".");

export const formatProposalLocation = (value: ProposalLocationLike) => {
  const parts = [value.floor?.trim(), value.wing?.trim(), value.room?.trim(), value.location_description?.trim()].filter(
    Boolean,
  );

  return parts.length > 0 ? parts.join(" / ") : "-";
};

export const formatBrandModel = (brand: string | null, model: string | null) => {
  const parts = [brand?.trim(), model?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
};

export const formatDeviceIdentifier = (value: ProposalDeviceLike) => {
  return value.barcode?.trim() || value.source_device_code?.trim() || "-";
};

export const formatMoney = (value: string, currency: string) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return `${value} ${currency}`;
  }

  return `${new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(numeric)} ${currency}`;
};

export const formatQuantity = (value: string) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }

  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 3 }).format(numeric);
};

export const formatProposalDeviceLabel = (device: ProposalDeviceLike) => {
  const brandModel = formatBrandModel(device.brand ?? null, device.model ?? null);
  const kindLabel = device.original_kind?.trim() || device.kind?.trim() || "-";

  if (brandModel === "-") {
    return kindLabel;
  }

  return `${kindLabel} · ${brandModel}`;
};
